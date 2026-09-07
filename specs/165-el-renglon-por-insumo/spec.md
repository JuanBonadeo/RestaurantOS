# 165 · El renglón por insumo del comprobante

**Issue:** [#245](https://github.com/gachetponzellini/RestaurantOS-app/issues/245) ·
**Milestone:** Post-demo · Growth & hardening ·
**Estado:** ✅ implementada (2026-09-07)

**Depende de**: [`158`](../158-comprar-y-pagarle-al-proveedor/spec.md) (el
comprobante), `10` (el costeo, que es quien consume el precio),
[`164`](../164-los-precios-de-los-insumos/spec.md) (sin precios reales, el costo
que escribiríamos arrancaría mal),
[`161`](../161-las-lecturas-de-proveedores-no-mienten/spec.md) (de donde sale el
patrón de RPC transaccional).

---

## Por qué

**Es la pieza raíz que la 158 dejó afuera: sin ella el stock sólo baja y el
costo nunca se actualiza.**

Medido en la nube antes de esta spec:

| | |
|---|---|
| `ingredient_price_log` | 0 filas en los tres negocios |
| `ingredient_consumptions kind='compra'` | **0 filas** — ni el ingreso manual se usó nunca |
| `ingresarStockCocina` | escribe `cost_cents_snapshot: 0` |
| golf-jcr | 230 consumos `venta`, 19 `reversion`, y **7 insumos ya en negativo** (mínimo −13) |

Un stock que sólo resta llega a negativo y deja de significar nada; un costo que
nunca se mueve hace que el food cost de la 164 vuelva a envejecer solo.

### MaxiRest lo hace, y está probado con aritmética

- `mxstk.compras` matchea la línea de compra de `mxitc` por insumo+fecha en
  **1.481 de 1.481 filas**, con la cantidad idéntica al tercer decimal. **El
  comprobante *es* el movimiento de stock.**
- `mxinspre` (histórico de precio) coincide con una línea de compra del mismo
  insumo, misma fecha y **mismo precio**, en **811 de 999 filas**. La compra
  reescribe el costo.
- Su ayuda (módulos 45, 65 y 135): procesar el comprobante dispara «Alta de
  stock», y *«con el procesamiento de las compras de insumos, el sistema
  actualiza el campo "Precio" y "Precio Promedio" en cada insumo procesado»*.

### La dependencia declarada ya no existía

La 158 colgó esto de la spec 10. **La spec 10 cerró** (issue #10, commit
`8548e46`, 2026-06-14) y `getCosteoOverview` está cableado en el catálogo y en
`profit-query.ts`. Quedó bloqueado por inercia.

## Las decisiones

**D1 · Las líneas son OPT-IN, y el editor arranca cerrado.**

Con detalle por insumo real (`cod_ins > 0`) son **366 comprobantes**: 242/3.677
en 2025 (6,6%) y 124/1.502 en 2026 (8,3%). El 92% se sigue cargando sólo con
concepto de gasto, y la ayuda de MaxiRest bendice ese camino: *«si no desea
ingresar el detalle… puede ingresar facturas a través del botón Agregar
Concepto»*.

**Pero no es un resto, es reciente**: hay **cero líneas con insumo antes del
2025-09-10** y desde ahí 25-45 comprobantes por mes sin parar, sobre 247 insumos
en 2025 y 156 en 2026, con 12+ proveedores reales. El Golf empezó a itemizar hace
un año, justo lo que va a receta.

**D2 · NO se enforcea Σ renglones = total.**

En 2026 sólo **585 de 1.502** comprobantes del Golf cuadran exacto. Un CHECK que
lo exigiera haría imposible cargar la mayoría de los comprobantes reales. La
pantalla **muestra** la diferencia y dice que está bien.

**D3 · Una RPC, no cuatro escrituras sueltas.**

Cada renglón toca la línea, el stock del insumo, su consumo y su precio. Es
exactamente el modo de falla de la 161·D4: un fallo a mitad deja **stock sumado
sin rastro**, o **precio nuevo sin mercadería**.

Y si los renglones fallan, **el comprobante no queda**: se anula con motivo. Un
comprobante que el usuario cargó con detalle y quedó sin él es peor que ninguno
— parece cargado y no movió nada.

**D4 · Anular devuelve el stock. El precio NO se revierte.**

El stock vuelve porque la mercadería nunca entró. El precio se queda porque **es
un hecho histórico**: el proveedor cobró eso, y el `ingredient_price_log` ya lo
registró. Revertirlo reescribiría el histórico para que diga que un precio que
existió no existió.

La reversión va **antes** de marcar la anulación: si el stock no se puede
devolver, el comprobante sigue vivo y el encargado reintenta. Al revés quedaría
anulado con el stock inflado y nadie se enteraría.

**D5 · `units` son ENVASES, no unidades base.**

El encargado escribe «5 bidones», no «25 litros». La conversión la hace el server
con el `net_quantity` de la presentación, que es lo que
`ingredient_presentations` ya sabe hacer. Y la línea **guarda cuál presentación
usó**: si mañana le cambian el `net_quantity`, la línea vieja no se reescribe.

## Alcance

**Datos** — migración `0073`: `supplier_invoice_items` + RLS (manager, como todo
el módulo desde la 0068), `registrar_items_comprobante_tx` y
`revertir_items_comprobante_tx`.

**Server:** `SupplierInvoiceItemInput` y el `items` opcional del input;
`createSupplierInvoice` llama a la RPC y anula si falla; `anularComprobante`
revierte; `getIngredientsForLinking` trae la presentación default.

**UI:** `renglones-editor.tsx` dentro del diálogo de compra.

## Qué NO entra

- **Editar los renglones de un comprobante ya cargado.** Se anula y se rehace,
  que es la regla que el repo ya tiene para el pedido pagado (spec 125). Editar
  un renglón obliga a recalcular stock y precio hacia atrás, y ahí el histórico
  deja de ser confiable.
- **Precio promedio ponderado.** MaxiRest tiene `precio` y `precio_pro`; nosotros
  guardamos el último. El promedio es una decisión contable que nadie pidió, y el
  histórico ya queda en `ingredient_price_log` para calcularlo cuando se pida.
- **Mapear automáticamente la línea de MaxiRest a nuestro insumo.** Es el mismo
  matching que la 164·D2 dejó pendiente, y sigue necesitando resolver los ~35
  duplicados.
- **Los 7 insumos en negativo de golf-jcr.** Esta spec hace que dejen de crecer;
  corregir los que ya están es un ajuste de inventario, que la pantalla de stock
  ya sabe hacer.

## Escenarios de aceptación

1. **Dado** un comprobante con un renglón de 5 envases de 5 lt, **entonces** el
   stock del insumo sube 25 lt.
2. **Dado** ese mismo renglón, **entonces** el consumo queda con el **costo
   real**, no con 0.
3. **Dado** un renglón con un precio distinto al que tenía el insumo, **entonces**
   el costo del insumo se actualiza y el histórico lo registra.
4. **Dado** que se anula el comprobante, **entonces** el stock vuelve y **el
   precio no**.
5. **Dado** un comprobante sin renglones, **entonces** se carga igual y no mueve
   stock.
6. **Dado** un renglón cuyo insumo es de otro negocio, **entonces** el server lo
   rechaza.
7. **Dado** que la suma del detalle no da el total, **entonces** se carga igual.
8. **Dado** que la carga de renglones falla, **entonces** el comprobante no queda
   vivo.

## Verificación

**Implementada y verificada el 2026-09-07.** `pnpm typecheck` limpio y **2.529
unitarios en verde**; los 7 `*.integration.test.ts` fallan sin stack local.
Migración `0073` aplicada al cloud.

**El ciclo completo, contra el cloud en una transacción que revierte** (2 bolsas
de 50 kg de Papa a $42.500):

    CARGA
      renglones            1
      stock      27,550 → 127,550   (+100 kg = 2 × 50)
      precio    $40.000 → $42.500
      price_log       1 → 2 filas
      consumos kind='compra': 1
    ANULACIÓN
      stock vuelve a 27,550
      precio queda en $42.500       (NO se revierte: es histórico)

**Escenarios 1-3, en vivo desde la pantalla** con Sofía (encargada) en `demo`. El
diálogo de compra muestra el opt-in cerrado —*«+ Detallar por insumo (da de alta
stock y actualiza el costo)»*—; al abrirlo precarga un renglón con **el precio
que corrigió la 164** ($17.048,65 = $3.409/lt × 5 lt). Con 5 envases:

    stock                  27,960 → 52,960     (+25 lt)
    renglones                            1
    consumos kind='compra'               1
    cost_cents_snapshot            340.973     ← $3.409,73/lt, el costo REAL

Ese último número es la spec entera: `ingresarStockCocina` escribía **0** ahí.

**Escenario 7.** Con el total en $85.000 y el detalle sumando $85.243, la
pantalla dice *«El total del comprobante es $85.000 — la diferencia queda sin
detallar, y está bien»* y **carga igual**.

**Escenario 4, en vivo.** Anulando ese comprobante: stock vuelve a **27,960**,
**0 renglones vivos**, y queda **1 movimiento `reversion`** registrado — no se
borra el consumo, se compensa, que es la regla de la 070.

**Rastro en `demo`:** el comprobante del verify quedó anulado con motivo
«limpieza del verify de la spec 165».
