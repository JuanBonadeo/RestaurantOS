# 160 · La caja administrativa

**Issue:** [#241](https://github.com/gachetponzellini/RestaurantOS-app/issues/241) ·
**Milestone:** Post-demo · Growth & hardening ·
**Estado:** ✅ implementada (2026-09-05)

**Input:** Juan, 2026-09-05, después del relevamiento del gap: *"arranca con la caja
mayor"*.

**Depende de**: [`158`](../158-comprar-y-pagarle-al-proveedor/spec.md) (el pago a
proveedor, que es lo que se mueve de caja),
[`070`](../070-caja-correccion-de-lineas-y-libro/spec.md) (el libro y la anulación
con motivo), [`139`](../139-el-cierre-en-papel/spec.md) (el corte y el ticket),
`098` (la propina que inflaba el arqueo — **el mismo modo de falla, con el signo
invertido**).

---

## Por qué

**La spec 158 hace que pagarle al proveedor rompa el cierre de caja.**

`registrarPagoProveedor` escribe una `sangria` sobre la caja que elegís, y hoy todas
las cajas son cajas de turno. La sangría **resta** del efectivo esperado, así que una
orden de pago grande contra un cajón chico deja el esperado en negativo y el arqueo
canta un **sobrante** por el monto entero. Con los datos reales de `demo`: esperado
$410.500; una OP de $2.900.000 lo deja en **−$2.489.500** y el arqueo pide explicar
un sobrante de **$2.900.000** — 580 veces el techo de
`DIFERENCIA_CAJA_OK_CENTS` ($5.000, [`can.ts:36`](../../src/lib/permissions/can.ts)).
`cerrarCaja` lo rechaza y **el encargado no puede cerrar el turno**. No hay número
que pueda tipear para salir: el negativo está prohibido en la action, en el modal y
en un CHECK de la base.

Es exactamente la falla de la spec 098 (la propina inflaba el esperado y la caja
cerraba con sobrante todos los días), con el signo dado vuelta.

### MaxiRest no tiene este problema porque tiene dos cajas

Su ayuda embebida (módulo 28) lo dice sin rodeos:

> «La Caja Mayor es una caja de efectivo totalmente independiente de la Caja
> Adición, y por esta característica se la considera una **caja administrativa**»

Y el Golf lo usa así desde 2018:

| | |
|---|---|
| Órdenes de pago desde la **caja mayor** (`mxcjm` tipo `AC`) | **14.589** · −$402.341.348 |
| Pagos a proveedor desde el **cajón del turno**, 2007-2026 | **2** · −$17.880 |
| Ritmo actual | **7,6 OP por día hábil** (máx. 19 en un día) |
| OP promedio vs sobrante diario del cajón | **$317.805** vs **$534.148** → **4,4x** |

Los pagos son cuatro veces y media lo que el cajón del turno genera. No es que
convenga sacarlos de ahí: **no entran**.

## Las decisiones

**D1 · Un booleano `is_administrative`, no un `kind` ni una tabla aparte.**

El argumento es el que la 158 aprendió por las malas: **el arqueo ya está aislado por
caja.** `getCajaStatsEnVentana` filtra `.eq("caja_id", cajaId)` y
`calculateExpectedCash` sólo ve los movimientos de esa caja. Mover el pago **a otra
fila de `cajas`** arregla el bug sin tocar una línea del cálculo — justo lo contrario
del `kind` nuevo que la D5 de la 158 casi introduce y que habría roto el filtro
binario del arqueo.

Que `expected-cash.ts` y `expected-cash.test.ts` **no se toquen** es la señal de que
el diseño es el correcto. Si el diff los toca, está mal.

MaxiRest usa una tabla aparte (`mxcjm`, con `saldo` materializado). No se copia: acá
el saldo se deriva, y una tabla propia perdería gratis el libro de la spec 070, la
anulación con motivo, el `caja_audit_log` y `corregir_movimiento_tx`.

**D2 · Una sola por negocio, y no puede ser la default.**

`create unique index … on cajas (business_id) where is_administrative`, espejo exacto
de `cajas_one_default_per_business` (0025), más
`check (not (is_administrative and is_default))`.

El CHECK no es decorativo: sin él, marcarla como default le manda **las facturas
fiscales** a su IP de impresora ([`print-agent/route.ts:1226`](../../src/app/api/print-agent/route.ts)
y `factura-print-actions.ts:128` resuelven la comandera con `.eq("is_default", true)`,
y toda caja nace con `fiscal_printer_enabled = true` desde la 0035).

Con una sola, el selector de caja del pago **desaparece**: queda un renglón fijo.

**D3 · No se arquea nunca, y la guarda va en la RPC.**

Esconder el botón no alcanza: `resolveCierrePrinter`
([`cuenta-printer.ts:72`](../../src/lib/print/cuenta-printer.ts)) **no mira `cajas`
en absoluto** — resuelve contra columnas de `businesses`—, así que si la
administrativa llegara a cerrarse, el ticket de arqueo sale igual por la impresora
del encargado. El rechazo va en tres capas: `cerrar_caja_tx` (que es la que estampa
`caja_cortes.numero`, encola el papel y barre el salón), `cerrarCaja` traduciendo el
error, y `getCierreCajaData` devolviendo `null`.

**D4 · La puerta se cierra en el server, no en la pantalla.**

Hay **cuatro caminos** que reciben un `caja_id` del cliente y sólo validan
`business_id` + `is_active`: `loadCaja` del cobro, `loadCajaForBusiness` (sangría,
ingreso, cerrar, set-default), la cobranza de cuenta corriente de cliente, y **la
corrección de línea del libro, que deja mover un cobro de mesa a otra caja**. Filtrar
sólo los `<select>` deja las cuatro abiertas por POST directo.

Y al revés: `registrarPagoProveedor` **resuelve la caja administrativa él mismo** y
rechaza cualquier otra. En MaxiRest ese escape existe y se usó 2 veces en 8 años; no
vale la pena dejar abierta la puerta que esta spec vino a cerrar.

**D5 · La administrativa se fondea con un `ingreso` manual, desde Proveedores.**

Sin fondeo la caja arranca en cero y sólo baja. No existe traspaso entre cajas en el
código (grep = 0) y no hace falta inventarlo: el `ingreso` que ya existe alcanza.

Vive **en Proveedores**, no en `/admin/caja`: esa pantalla ofrece «Ver ahora» → el
board del arqueo, que es justo lo que esta caja no tiene. Y Proveedores es donde el
encargado la usa.

**D6 · El libro la ve; el board del turno no.**

Hoy `getCajasConEstado` alimenta cuatro cosas con la misma lista. Hay que partirla:
el **libro de movimientos** y su filtro necesitan **todas** las cajas; el board de
operación y `/admin/caja` sólo las de turno.

Si no, la OP cae del `Map` de `getLibroDeMovimientos` y la línea sale con
`caja_name: "—"` y `arqueado: false` — o sea **corregible y anulable para siempre**,
sin forma de aislarla en el filtro. El libro es el único lugar donde una OP se
audita, y `anularPagoProveedor` ya manda ahí en su mensaje de error.

**D7 · Puede quedar en negativo. No se bloquea.**

MaxiRest tampoco lo impide. Bloquearlo reintroduce el mismo modo de falla una caja
más arriba: «no podés pagarle al proveedor porque la mayor está en rojo». La caja
mayor del Golf corre −$402M de egresos contra +$123M de ingresos y nadie reclama.

**D8 · La guía de la app hay que corregirla, porque no es copy: es el corpus del
asistente.**

[`asistente.ts`](../../src/lib/ayuda/asistente.ts) serializa `TEMAS` entero y lo mete
como **única fuente** del asistente de la app, con la regla «si la respuesta está en
la guía, contestala». Mientras `contenido.ts:274` diga que la sangría es para «pago a
proveedor», el asistente le va a **enseñar al encargado el camino que rompe el
arqueo**, con la autoridad de la guía oficial.

Y la taxonomía de la guía es binaria (principal / no principal). La administrativa es
una **tercera** clase: no cierra nunca. Ese texto se reescribe, no se le agrega un
renglón.

## Alcance

**Datos** — migración `0067`:
- `cajas` += `is_administrative boolean not null default false`, con unique parcial
  por negocio y el CHECK contra `is_default` (D2).
- Seed por trigger + backfill, patrón `seed_expense_concepts` de la 0066. `sort_order`
  alto (1000) para que no gane el `cajas[0]` de ningún fallback.
- `cerrar_caja_tx` += la guarda de D3.
- RLS de `cajas`: INSERT/UPDATE/DELETE pasan a `is_business_admin`. Hoy son
  `is_business_member`, que incluye **mozo y terminal** — con `is_default` era una
  preferencia; con un flag que sostiene «esta caja no la cobra nadie» es una barrera
  que un mozo puede desactivar por PostgREST con su propio JWT.

**Server:**
- Filtrar en `getCajasForBusiness`, `getAllCajasForBusiness`, `getDefaultCaja` y en el
  camino de board de `getCajasConEstado` (D6).
- Cerrar los cuatro caminos con `caja_id` crudo (D4).
- `registrarPagoProveedor` resuelve la administrativa y rechaza el resto (D4).
- `/api/caja/stats`: rechazar la administrativa para roles que no sean admin/encargado.
- `revalidatePath` del libro, que hoy falta.

**UI:**
- `pago-dialog`: el `<select>` de caja se va, queda el renglón fijo.
- Proveedores: el saldo de la caja administrativa + fondearla (D5).
- El copy de la sangría en el board, que hoy dice «(depósito en banco, pago a
  proveedor, etc.)».

**Ayuda:** los cuatro textos de `contenido.ts` (D8).

**Tests:** `registrarPagoProveedor` y `anularPagoProveedor` **no tienen ni un test**.
Los primeros se escriben acá.

**Seeds:** `seed-estructura.ts` borra `cajas` y las recrea desde un array literal; el
trigger no corre en un reseed. La caja va también en ese array, o el demo se queda sin
ella después del primer reseed. Y los tres scripts que pican `cajas[0]` hay que
apuntarlos.

## Qué NO entra

- **El barrido de fin de turno → caja mayor.** Es la contrapartida del retiro y es el
  modelo completo de MaxiRest (3.147 movimientos), pero toca `cerrar_caja_tx` de lleno
  — spec propia. Sin él la administrativa queda en negativo, que es literalmente lo que
  MaxiRest hace hoy.
- **Traspaso genérico entre cajas.** No existe y el `ingreso` alcanza.
- **Numeración de orden de pago** ([#246](https://github.com/gachetponzellini/RestaurantOS-app/issues/246)).
- **Arqueo, corte o «puesta a cero» de la administrativa.** Para corregir ya está la
  anulación con motivo de la 070 — que además es mejor que la de MaxiRest, que muta la
  fila y quema el número.
- **Mover los vales/adelantos a empleados.** En el Golf el 73% salen del cajón, con el
  empleado presente: moverlos rompe el arqueo en el otro sentido.
- **Cobranza de cuenta corriente de cliente desde la administrativa.** Es el espejo con
  signo invertido, pero el cliente paga en el mostrador. En MaxiRest son 18 movimientos
  en 8 años.
- **Bloqueo por saldo negativo** (D7).
- **El leak general de `/api/caja/stats`** (cualquier mozo lee los stats de cualquier
  caja): preexistente, issue aparte.

**No se toca** — si el diff los toca, el diseño está mal: `expected-cash.ts`,
`CajaMovimientoKind`, el CHECK `caja_movimientos_kind_check` y el CHECK
`supplier_payments_caja_coherente`. La administrativa es una caja de **efectivo**:
la fila del pago sigue exigiendo `caja_id`, sólo cambia cuál.

> **Corregido al implementar:** acá decía también «el refine de
> `SupplierPaymentInput`», y era incompatible con D4. Si el server resuelve la
> caja, el cliente ya no la manda, y un refine que exige `caja_id` en el input
> rechazaría todo pago en efectivo. El campo **se fue del input** y el refine con
> él; el CHECK de la base —que es el que garantiza que la fila la tenga— queda
> intacto, y ahora hay un test que caza si alguien lo reintroduce.

## Escenarios de aceptación

1. **Dado** un pago a proveedor en efectivo, **entonces** el egreso cae en la caja
   administrativa **y el arqueo del turno no se entera**: el esperado del cajón queda
   igual que antes del pago.
2. **Dado** el mismo pago, **cuando** el encargado cierra el turno, **entonces** cierra
   normal — hoy no puede.
3. **Dado** el ticket de cierre en papel, **entonces** la OP **no** figura entre los
   egresos del turno.
4. **Dado** el picker de caja de cualquier cobro (mesa, pedido, venta rápida, cobranza
   de cliente), **entonces** la caja administrativa **no aparece**.
5. **Dado** un POST directo con el `caja_id` de la administrativa a cobrar, a hacer una
   sangría o a **mover una línea del libro**, **entonces** el server lo rechaza.
6. **Dado** un intento de cerrar la caja administrativa, **entonces** la RPC lo rechaza
   con un mensaje propio y **no se emite ningún ticket**.
7. **Dado** el libro de movimientos, **entonces** la OP aparece con el nombre de su
   caja y se puede filtrar por ella — no como `—`.
8. **Dado** un negocio nuevo, **entonces** nace con su caja administrativa y **ningún
   fallback de cobro la elige** (ni `cajas[0]`, ni `getDefaultCaja`, ni el hook de caja
   preferida).
9. **Dado** `kcc`, que hoy tiene una sola caja, **entonces** el destino de cobro del
   mozo **no se muda** a la administrativa.
10. **Dado** el asistente de la app, **cuando** le preguntan cómo pagarle a un
    proveedor, **entonces** no responde «hacé una sangría».
11. **Dado** un mozo, **entonces** no puede marcar ni desmarcar `is_administrative` por
    API.

## Verificación

**Implementada y verificada el 2026-09-05.** En vivo en `demo` con el rol real
(Sofía, encargada). `pnpm typecheck` limpio y **2.493 unitarios en verde**; los 7
`*.integration.test.ts` fallan sin el stack Supabase local (ruido conocido).
Migración `0067` aplicada al cloud.

**La línea de base, antes de tocar nada.** Medida por SQL contra `demo` con la
misma fórmula del arqueo: efectivo esperado **$459.833** (el board muestra
$410.500 — la diferencia son las propinas, que `calculateExpectedCash` descuenta
por la spec 098 y mi consulta no). Con una OP de $2.900.000, el esperado caía a
**−$2.440.167** y el arqueo pedía explicar ese sobrante contra un techo de $5.000:
**488 veces**.

**Escenario 1 — el pago no toca el cajón.** Se pagó $2.900.000 en efectivo desde la
ficha del proveedor. El movimiento quedó así:

    Caja Mayor      (is_administrative)  −$ 2.900.000  "Pago a proveedor · Verdulería del Sur"
    Caja Principal  (turno)              +$    10.000  intacta, como antes del pago

Y el board del turno siguió diciendo **«EN LA CAJA DEBERÍAS TENER $ 410.500»**.

**Escenario 2 — el cierre.** Con la OP ya hecha, se abrió el cierre de Caja
Principal, se contaron los $410.500 y el modal respondió **«Cuadra perfecto»**. Con
el bug, ese mismo conteo habría dado un sobrante de $2.489.500 y `cerrarCaja` lo
habría rechazado. *(El cierre quedó bloqueado por «faltan 3 rendiciones», que es la
maquinaria de la spec 139 y no se tocó.)*

**Escenario 4 — el picker.** Verificado contra la base con las mismas condiciones
que usa el server:

    picker de cobro : Caja Principal, Caja Bar
    libro           : Caja Principal, Caja Bar, Caja Mayor

**Escenario 6 — no se arquea.** Llamando `cerrar_caja_tx` **directo contra la RPC**,
salteando toda la UI, con el id de la Caja Mayor:

    ERROR: CAJA_ADMINISTRATIVA_NO_SE_ARQUEA

`cerrarCaja` lo traduce al mensaje del usuario y `getCierreCajaData` devuelve `null`
antes de armar el arqueo.

**Escenario 7 — el libro.** La OP figura como
`Pago a proveedor · Verdulería del Sur · Sangría · **Caja Mayor** · −$ 2.900.000`,
con el nombre de su caja y no `—`, y el desplegable de filtro lista «Caja Mayor».

**Escenario 11 — el flag.** Ejecutado **con el JWT de un mozo de `demo`** (`set local
role authenticated` + su `sub`, en una transacción que revierte), intentando marcar
la Caja Bar como administrativa: **0 filas actualizadas**. La RLS lo frena.

**La anulación.** Anular el pago devolvió la Caja Mayor a $0 neto y dejó el
movimiento tachado con motivo heredado. En la base queda el contraste histórico de
las dos specs: el pago viejo de la 158 sigue apuntando a **Caja Principal**, el
nuevo a **Caja Mayor**.

**Un hueco que apareció al aplicar la migración.** El primer intento abortó con
`cannot change return type of existing function`: `cerrar_caja_tx` devuelve una
`TABLE` de cinco columnas y tiene un parámetro con `DEFAULT`, y yo había retipeado
la firma como `returns jsonb`. La migración pasó a **reconstruirla desde el catálogo**
(`pg_get_function_arguments` / `pg_get_function_result`), que además la vuelve
inmune a un cambio de firma futuro. Que abortara entera es la prueba de que el
patrón de "verificar antes de tocar" funciona.

**Rastro en `demo`:** el pago de $2.900.000 a «Verdulería del Sur» y su anulación
son de este verify.
