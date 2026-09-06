# 158 · Comprar y pagarle al proveedor

**Issue:** [#237](https://github.com/gachetponzellini/RestaurantOS-app/issues/237) ·
**Milestone:** Post-demo · Growth & hardening ·
**Estado:** ✅ implementada (2026-09-04)

**Input:** la encargada de Golf, 2026-09-03 11:42, probando la pantalla de
proveedores en vivo: *"Acá entra algo que es proveedores y estoy viendo que **me
pide el número de factura, el importe y nada más**."*

**Fuente:** el relevamiento de MaxiRest que salió de ese audio —
[`compras-y-proveedores.md`](https://github.com/gachetponzellini/restaurantos-brain/blob/main/wiki/negocio/competencia/maxirest/compras-y-proveedores.md)
en el brain, hecho sobre el backup del Golf y la ayuda embebida del propio
sistema.

**Depende de**: [`012`](../../openspec/changes/12-proveedores/) (el módulo que
existe: `suppliers`, `supplier_invoices`, el bucket privado de fotos),
[`141`](../141-cuentas-corrientes/spec.md) (la cuenta corriente de **clientes**,
de donde sale el principio de saldo derivado),
[`070`](../070-caja-correccion-de-lineas-y-libro/spec.md) (anulación con motivo y
libro de movimientos de caja), [`139`](../139-el-cierre-en-papel/spec.md) (el
corte que estampa los movimientos).

---

## Por qué

**Lo que tenemos es la agenda; lo que el local usa es el circuito.**

`supplier_invoices` guarda número, fecha, total, foto y notas. Con eso se
responde "¿cuánto le compré a la verdulería en agosto?" y nada más. No se
responde ninguna de las tres preguntas que el encargado hace todos los días:

- **¿Cuánto le debo?** No hay saldo, no hay vencimiento, no hay impagos.
- **¿En qué se fue la plata?** No hay concepto de gasto: 400 comprobantes son 400
  filas sueltas, sin "Carnes" ni "Mantenimiento" que los agrupe.
- **¿Cuándo le pagué?** No existe el pago. Hoy la plata sale por una **sangría con
  motivo de texto libre** — literalmente, el ejemplo que da nuestra propia ayuda
  es *"pago proveedor verdulería"*
  ([`ayuda/contenido.ts:264`](../../src/lib/ayuda/contenido.ts)). El efectivo sale
  del cajón y la deuda con la verdulería sigue intacta, porque nunca estuvo
  anotada.

### Lo que hace MaxiRest, y por qué importa

Su ayuda lo dice sin rodeos: procesar un comprobante de compra pone en marcha
**cta. cte. + alta de stock + subdiario IVA + estadística de insumos + estadística
de gastos**. Y se salda con una **orden de pago** a la que se llega *desde la caja
Mayor o Adición*. El pago a proveedor no es un apéndice del módulo de compras: es
una operación de caja.

El Golf lo usa así desde 2018: **20.767 comprobantes, ~300 por mes, ~10 por día**.

### El dato que define el diseño

**Sólo 1 de cada 4 comprobantes es una factura fiscal** (2025-26):

| Tipo | Comprobantes | % | Importe |
|---|---|---|---|
| Compra diaria **sin factura** (`Z`) | 1.871 | 36% | $645 M |
| Liquidación de sueldos, proveedor virtual (`E`) | 1.703 | 33% | $260 M |
| **Factura fiscal A/B/C** | 1.301 | 25% | $571 M |
| Gasto sin proveedor (`G`) | 302 | 6% | $46 M |
| Notas de crédito/débito | 4 | 0,1% | −$0,5 M |

En el tipo `Z` **el número del comprobante es la fecha** y el IVA va en cero: es
*"hoy le pagué $482.100 a la verdulería"*. Cualquier pantalla que exija número de
factura y CUIT cubre un cuarto de la operación y estorba en los otros tres
cuartos. **El camino sin comprobante tiene que ser el camino corto**, no el caso
raro.

## Las decisiones

**D1 · El concepto de gasto es una tabla, no dos.** MaxiRest separa rubro
(`mxrga`, 8 filas) de concepto (`mxcga`, 67). Dos tablas para agrupar ocho valores
es sobre-modelar: `expense_concepts` lleva el `rubro` como columna. El proveedor
gana su **concepto por defecto** (el `cod_cga` de `mxpro`), así cargar la compra
de la verdulería no obliga a elegir "Verdulería" cada vez.

**D2 · El comprobante crece, no nace.** `supplier_invoices` ya existe con foto en
bucket privado y RLS puesta. Suma `expense_concept_id`, `document_type`,
`due_date` y las columnas de anulación. Nada de una tabla nueva paralela: eso
dejaría las facturas viejas en un lado y las nuevas en otro.

**D3 · El saldo se DERIVA.** Es el mismo principio que la spec 141, y por la misma
razón: *la única forma de que un saldo mienta es que tenga dos fuentes.*

    saldo = Σ comprobantes vivos − Σ pagos vivos

No hay libro de asientos ni columna `saldo` que mantener en sync. Un comprobante
anulado o un pago anulado desaparecen del saldo por no estar vivos, no porque
alguien recalculó.

**D4 · La nota de crédito es un comprobante con total negativo.** Es lo que hace
MaxiRest (`+`/`N` con importe negativo) y lo que hace que el saldo derivado de D3
funcione sin un caso especial. Cuesta relajar el `CHECK (total_cents >= 0)` que
hoy tiene la tabla — y ese es todo el costo.

**D5 · El pago a proveedor es un movimiento de caja — y es una `sangria`, no un
`kind` nuevo.** No se inventa una tesorería: el egreso se escribe en
`caja_movimientos` y con eso hereda gratis el arqueo, el estampado en el corte
(spec 139), la anulación con motivo (spec 070) y el `caja_audit_log`. Un egreso
que viviera en otra tabla sería un egreso que el arqueo no ve, y el arqueo que no
cuadra es exactamente el problema que este módulo viene a resolver.

> **Revisado antes de implementar.** La versión anterior de esta decisión agregaba
> `kind = 'pago_proveedor'`. Leyendo el arqueo, esa idea era un bug esperando:
> [`calculateExpectedCash`](../../src/lib/caja/expected-cash.ts) resta filtrando
> **`kind === 'sangria'` explícito**, así que el `kind` nuevo habría salido de la
> caja sin bajar el efectivo esperado — el turno cerrando con faltante todos los
> días. Y `kind` se discrimina como binario en otros ocho lugares (`queries.ts`,
> el board, el ticket de cierre, `CajaMovimientoKind`).
>
> El proyecto ya resolvió el caso simétrico: la **cobranza de cuenta corriente**
> de la spec 141 escribe `kind: "ingreso"` con
> `reason: "Cobro cuenta corriente · <cliente>"` y guarda el id en
> `caja_movimiento_id` — no inventó un kind propio. El pago a proveedor es su
> espejo: `kind: "sangria"`, `reason: "Pago a proveedor · <nombre>"`, id guardado
> en `supplier_payments.caja_movimiento_id`. Cero riesgo en el arqueo, cero
> archivos de caja tocados, y la trazabilidad la da el FK, no el `kind`.

**D6 · Lo que no sale de la caja igual se registra.** La transferencia bancaria no
toca el cajón pero sí la deuda. `supplier_payments` es la orden de pago —siempre—
y el movimiento de caja se escribe **sólo** cuando el medio es efectivo. Es el
mismo reparto que hace MaxiRest entre "caja adición/mayor" y "bancos", y en el
Golf los dos medios se usan (3.659 pagos por uno, 1.004 por el otro).

**D7 · Un comprobante con pagos vivos no se toca.** Regla textual de MaxiRest:
para editar o anular un comprobante pago hay que anular primero sus órdenes de
pago. Sin esa guarda, anular una factura ya pagada deja un pago imputado a un
comprobante que no existe, y el saldo derivado de D3 empieza a mentir.

**D8 · El proveedor virtual no es una feature, es un proveedor.** Los sueldos y
los gastos sin comprobante entran como compras a un proveedor común llamado
"Sueldos" o "Gastos varios", con su concepto de gasto. Es lo que hace el Golf con
un tercio de sus comprobantes y no necesita una sola línea de código propia.

## Alcance

**Datos** — una migración:
- `expense_concepts (id, business_id, name, rubro, is_active, …)`, unique
  `(business_id, name)`.
- `suppliers` += `default_expense_concept_id`, `payment_terms_days` (el
  `dias_venc` que calcula el vencimiento).
- `supplier_invoices` += `expense_concept_id`, `document_type`, `due_date`,
  `cancelled_at`/`cancelled_by`/`cancelled_reason`; `total_cents` deja de exigir
  ≥ 0 (D4).
- `supplier_payments (id, business_id, supplier_id, paid_at, amount_cents, method,
  caja_movimiento_id, notes, created_by, cancelled_*)`.
- `supplier_payment_allocations (payment_id, invoice_id, amount_cents)` — sin
  filas = **pago a cuenta**.
- RLS `members_*` + `platform_*` por `business_id` en las tablas nuevas.

**Dominio:**
- `src/lib/proveedores/cuenta-corriente.ts` — **lógica pura**: saldo, antigüedad
  de la deuda, impagos, imputación de un pago. Es lo que se testea primero.
- `actions.ts` — alta/edición/anulación de comprobante, registro y anulación de
  pago, ABM de conceptos.
- `queries.ts` — saldo por proveedor, comprobantes impagos, vencimientos del
  período, gasto por concepto y por rubro.

**UI:**
- El alta de comprobante pide **concepto** y **vencimiento** (precargados desde el
  proveedor), y el número deja de ser lo primero.
- Ficha del proveedor: saldo, impagos, libro de movimientos (comprobantes y pagos
  mezclados, lo anulado tachado — como el libro de caja).
- Pago: elegir proveedor → tildar impagos → medio de pago → confirmar.
- Vencimientos: qué vence y cuándo.
- Gasto por concepto/rubro en el período.

**Permisos:** `canManageProveedores` (admin + encargado) ya existe y alcanza para
comprobantes y conceptos. El **pago** además exige `canMakeSangria` cuando sale
efectivo de la caja: sacar plata del cajón no puede tener un techo más bajo por
entrar por otra pantalla.

## Qué NO entra

- **Órdenes de compra, listas de precios por proveedor, centros de gasto.** Las
  tres tablas están **en 0** en el Golf después de 8 años. Construirlas sería
  copiar el menú de MaxiRest, no su uso.
- **Detalle por insumo que mueva stock y actualice el precio del insumo.** Es la
  pieza más valiosa que queda afuera. El `expense_concept_id` de esta spec es el
  gancho por el que va a entrar.

  > **Corregido 2026-09-05 (relevamiento del gap):** acá decía «es el 64% de los
  > comprobantes del Golf» y **el número estaba mal** — ese 64% (en rigor 80,8%)
  > son comprobantes con *cualquier* línea, y la mayoría son líneas de concepto de
  > gasto, que es justo lo que esta spec implementó. Con detalle **por insumo real**
  > (`mxitc.cod_ins > 0`) son **366 comprobantes**: 242/3.677 en 2025 (6,6%) y
  > 124/1.502 en 2026 (8,3%).
  >
  > Lo que el número corregido **no** dice es que sea marginal: **no hay una sola
  > línea con insumo antes del 2025-09-10**, y desde ahí corren 25-45 comprobantes
  > por mes sin parar hasta el último día del backup, sobre 247 insumos. El Golf
  > empezó a itemizar hace un año, justo lo que va a receta. Es una práctica que
  > arranca, no un resto legacy.
  >
  > También cayó la dependencia declarada: **la spec 10 cerró** (issue #10, commit
  > `8548e46`, 2026-06-14) y `getCosteoOverview` ya está cableado. Esto quedó
  > colgado por inercia, no por bloqueo.
- **Neto / IVA por tasa / percepciones / impuestos internos.** Es el subdiario IVA
  compras: contabilidad, no operación, y nadie lo pidió. Con el 75% de los
  comprobantes sin IVA discriminado, agregarlo ahora sería seis columnas vacías.
- **OCR de la foto.** Se sube y se carga a mano, igual que hoy.
- **Multi-medio en un mismo pago** (MaxiRest permite saldar una deuda con
  efectivo + cheque en el mismo acto). Un pago, un medio; dos medios son dos
  pagos.

## Escenarios de aceptación

1. **Dado** un proveedor con concepto "Verdulería" y 7 días de crédito, **cuando**
   el encargado carga una compra de $482.100 **sin número de factura**,
   **entonces** el comprobante queda con concepto "Verdulería" y vencimiento a 7
   días, sin haber tipeado ninguno de los dos. *(Es el 36% de los comprobantes del
   Golf.)*
2. **Dado** ese comprobante impago, **cuando** se consulta la ficha del proveedor,
   **entonces** el saldo dice $482.100 y el comprobante figura entre los impagos
   con su fecha de vencimiento.
3. **Dado** un pago en efectivo de $482.100 imputado a ese comprobante,
   **entonces** el saldo queda en cero **y** la caja registra un egreso de
   $482.100 que el arqueo del turno descuenta. Un pago que no aparezca en el
   arqueo es un bug.
4. **Dado** un pago sin imputar a ningún comprobante, **entonces** queda como
   **pago a cuenta** y el saldo del proveedor puede ser negativo — saldo a favor,
   no cero clampeado.
5. **Dado** un comprobante con un pago vivo imputado, **cuando** se intenta
   anularlo, **entonces** el sistema lo rechaza y dice que primero hay que anular
   el pago.
6. **Dado** un pago anulado, **entonces** la deuda vuelve, el egreso de caja queda
   anulado con su motivo, y **los dos siguen visibles tachados** en el libro.
7. **Dado** un mes con compras, **cuando** se mira el gasto por rubro, **entonces**
   "Mercaderías" y "Mantenimiento" totalizan sus conceptos — la pregunta que hoy
   no se puede responder.
8. **Dado** un pago por transferencia, **entonces** la deuda baja y **la caja no se
   toca**.
9. **Dado** un negocio distinto, **entonces** no ve ni un concepto, ni un
   comprobante, ni un pago del otro. Multi-tenancy con RLS, verificado con el rol
   real.

## Verificación

**Implementada y verificada el 2026-09-04.** En vivo en `demo` con el rol real
(Sofía, encargada), vía `node scripts/magic-link.mjs sofia@demo.test
"/demo/admin/proveedores"`. `pnpm typecheck` limpio y `pnpm test` con **2.468
unitarios en verde** (los 7 `*.integration.test.ts` fallan sin el stack Supabase
local: ruido conocido, comprobado idéntico con los cambios stasheados).
Migración `0066` aplicada al cloud por MCP.

**Escenario 1 — la compra sin factura, en cuatro datos.** Se creó «Verdulería del
Sur» con concepto *Verdulería* y **7 días de crédito**. Al abrir «Cargar compra»,
el formulario ya venía resuelto sin tipear nada:

    concepto = Verdulería (preseleccionado)   comprobante = Sin comprobante
    fecha    = 2026-09-04                     vence       = 2026-09-11  (+7 d)
    y NINGÚN campo de número de factura en el DOM

El número aparece sólo al elegir un comprobante que lo lleva. La fila que quedó
en la base es la prueba: `document_type=interno · due_date=2026-09-11 ·
total_cents=48210000 · concepto Verdulería (mercaderias)`.

**Escenario 2 — el saldo.** La ficha pasó a «Se le debe **$ 482.100**», «Impagos
**1**», y el comprobante figura con su vencimiento.

**Escenario 3 — el pago sale de la caja.** Se pagó en efectivo desde Caja
Principal. Quedó `supplier_payments` (cash, 1 imputación) + el movimiento
`kind=sangria · $482.100 · "Pago a proveedor · Verdulería del Sur"`. Y el arqueo
lo descontó: **«EN LA CAJA DEBERÍAS TENER» pasó de $ 410.500 a −$ 71.600**, con
la sangría encabezando el libro de movimientos del período. Este era el escenario
que la primera versión de D5 habría roto en silencio.

**Escenario 4 — pago a cuenta.** $ 100.000 sin tildar comprobantes: el formulario
avisó «$ 100.000 van a quedar a cuenta» antes de confirmar, el toast lo repitió, y
el saldo bajó a $ 382.100 **dejando el comprobante impago por sus $ 482.100** — no
se imputó nada por su cuenta.

**Escenario 5 — la guarda de D7.** Anular el comprobante con el pago vivo:
«El comprobante tiene pagos imputados: anulá primero el pago y después el
comprobante.» No se anuló nada.

**Escenario 6 — anular el pago.** La deuda volvió a $ 482.100 y el impago
reapareció; el egreso de caja quedó anulado con motivo heredado
(`"Pago a proveedor anulado · verify spec 158 - se pagó de más"`) y el neto vivo
de la caja volvió a lo de antes. Los dos siguen visibles, tachados.

**Escenario 7 — en qué se fue la plata.** La tab Vencimientos: «Deuda total
$ 482.100 · Ya vencido $ 0», «Verdulería del Sur · vence 2026-09-11 · **en 7 d**»,
y por rubro **«Mercaderías $ 482.100 · 100% · 1 compra»**.

**Escenario 8 — transferencia.** Al elegir el medio, el selector de caja
**desaparece**, y la fila quedó con `caja_id` y `caja_movimiento_id` en NULL: la
deuda bajó sin tocar el cajón.

**Escenario 9 — multi-tenancy con el rol real.** Se sembró un concepto en
`golf-jcr` y se consultó **como la encargada de demo** (`set local role
authenticated` + su `sub` en el JWT, en una transacción que revierte):

    conceptos demo: 31 · conceptos golf: 0 · pagos golf: 0 · comprobantes golf: 0

**Dos arreglos que salieron del verify.** (1) Cargar una compra dejaba la lista
diciendo «Sin facturas cargadas» hasta recargar: `router.refresh()` llegaba
después con props nuevas y pisaba el `setState` suelto; la recarga pasa ahora por
el mismo effect que la carga inicial. (2) Un comprobante interno se mostraba como
«Sin número», que es cierto y no dice nada: muestra el tipo («Sin comprobante»),
como en la lista de impagos.

**Deuda que queda anotada.** `database.types.ts` no incluye las tablas ni las
columnas nuevas — el `pnpm db:types` del repo necesita el CLI linkeado. El módulo
usa el mismo escape hatch que la spec 141 (`type GenericClient = SupabaseClient`);
hay que regenerar los tipos cuando el CLI vuelva.

**Rastro en `demo`:** el proveedor «Verdulería del Sur» con su compra, su pago
anulado y su pago a cuenta por transferencia son de este verify.
