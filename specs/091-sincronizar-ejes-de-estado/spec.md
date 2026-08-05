# Feature Specification: Los dos ejes de estado dicen lo mismo

**Feature Branch**: `091-sincronizar-ejes-de-estado`

**Created**: 2026-08-05

**Status**: ✅ Implementada · backfill aplicado al cloud

**Issue**: #143

**Depende de**: [`090`](#142) — sin el helper que escribe los dos ejes habría que backfillear dos veces. · [`089`](#141) — el backfill tiene que poder apagar el trigger de reversión.

**Fuente**: [auditoría de estados de pedidos](../../../wiki/analyses/estados-de-pedidos-auditoria.md) — H-19, H-24, H-40, H-49.

## Contexto y problema

`orders.status` y `orders.lifecycle_status` son **ortogonales y nadie los sincronizaba**. En todo el repo había **una sola** lectura que los combinaba bien: `shift-summary-loader.ts:182-183`. De ahí sale el predicado.

Los síntomas, todos en pantallas que mira el dueño:

- **H-24** — abre el panel un martes a las 4 con el local vacío y lee **«Pedidos activos: 47»**. Son las mesas cobradas (que quedan en `pending` porque ningún flujo de salón escribe `orders.status`) y las anuladas. Y en el historial cada mesa cobrada aparece con badge «Pendiente», así que el filtro por estado es inservible para el salón.
- **H-49** — «Facturaste el 68% de tus ventas» cuando el real es 82%: el denominador incluye las mesas anuladas, que conservan su `total_cents` completo. El dueño va a buscar un agujero fiscal que no existe.
- Top productos muestra las 6 cervezas de una mesa anulada al día siguiente.
- **H-19** — el bloque de anulaciones del resumen de turno filtra por `cancelled_at`, que el canal online no escribía: seis deliveries cancelados con motivo tipeado y el resumen del dueño no dice una palabra.

## Decisiones de producto

| Pregunta | Decisión |
|---|---|
| ¿Se colapsan los dos ejes en uno? | **No.** Miden cosas distintas y las dos se usan: `status` es producción/entrega (un delivery `preparing` se está cocinando), `lifecycle_status` es el ciclo comercial de la cuenta (una mesa `open` puede tener 3 comandas entregadas y seguir abierta). Colapsar es caro y rompe una distinción real. |
| ¿Predicado en TS o filtro en SQL? | **Los dos.** `isOrderDead()` para lo que se filtra en memoria; encadenar `.neq()` para lo que filtra la base. Con la 090 el predicado casi nunca cambia de resultado — es el cinturón contra el próximo write-site que se olvide de un eje. |
| ¿Qué `status` recibe una orden al cerrarse? | **`delivered`.** Es el estado terminal del eje de producción y lo que la mesa cobrada de hecho es. |
| ¿El backfill devuelve el stock de las 29 líneas? | **No** — ver abajo, es lo más delicado de esta spec. |

## Requisitos

- **FR-001** `isOrderDead(order)` / `isOrderAlive(order)` en `src/lib/orders/predicates.ts`.
- **FR-002** Aplicado en `dashboard-query`, `reports-query`, `reports-extra-query`, `profit-query`, `platform/queries`. Los `select` que hacían falta se ampliaron con `lifecycle_status`.
- **FR-003** Cerrar una orden escribe `status='delivered'` (`closeOrderIfFullyPaid` y el cierre manual de venta mostrador).
- **FR-004** «Pedidos activos» del dashboard excluye además las `closed`.
- **FR-005** Migración `0040` de backfill, cinco `UPDATE`, ninguno destructivo.

## ⚠️ Lo más delicado: por qué el backfill apaga los triggers

Marcar `cancelled_at` en los 29 ítems y poner 23 órdenes en `status='cancelled'` **dispararía la reversión de inventario de la 089** y devolvería stock retroactivamente por ventas de hace semanas.

Eso es exactamente lo que la 089 decidió no hacer, por una razón concreta: **el encargado ya hizo ajustes manuales para compensar** esas anulaciones que nunca devolvieron nada. Revertir ahora contaría la misma mercadería dos veces y dejaría el inventario peor que antes.

Por eso el backfill corre con los dos triggers apagados, dentro de la transacción de la migración (no hay ventana en la que se pierda una cancelación real). **Se declara el corte:** de acá en adelante la reversión corre sola; el pasado se arregla con el conteo físico del próximo cierre.

## Una trampa que sí se pisó

El paso **D** (marcar los ítems vivos) corría **antes** del paso **E** (cerrar/cancelar los online que estaban `open`). Los 4 pedidos que E movió a `cancelled` todavía no lo estaban cuando D los buscó → **quedaron 5 ítems vivos**. Se detectó en la verificación posterior y se barrió con una migración correctiva; en `0040` el orden quedó arreglado (D después de E) y documentado.

Es el tipo de error que sólo aparece si uno **vuelve a contar después de aplicar**, no si se confía en que el `UPDATE` devolvió éxito.

## Verify

- `pnpm typecheck` ✅ · `pnpm test` ✅ **1596 tests, 0 rojos** con stack local · eslint limpio.
- Migración `0040` ensayada contra el schema local antes de tocar el cloud.
- **Backfill aplicado al cloud** `tjfufswzsxfujcpoxapx`, con verificación posterior:

| lifecycle | status | antes | después |
|---|---|---:|---:|
| cancelled | **pending** | 23 | **0** |
| closed | pending/preparing/confirmed | 7 | **0** |
| open | **cancelled** | 4 | **0** |
| ítems vivos en órdenes canceladas | | 29 | **0** |

Distribución final, sin una sola combinación contradictoria: `cancelled+cancelled` 35 · `closed+delivered` 63 · `open+{pending,preparing,ready}` 23.

- **Verificado que el backfill NO tocó inventario**: 0 filas nuevas en `ingredient_consumptions kind='reversion'` y 0 en `stock_movimientos`, y los dos triggers quedaron habilitados (`tgenabled='O'`).

**Lo que NO está verificado:**

- **Nada en vivo con el rol real.** Falta abrir el dashboard y confirmar que «Pedidos activos» ya no cuenta mesas cobradas, y que el % de facturación del reporte fiscal subió a su valor real.
- **H-40 queda afuera**: un pedido online pagado por MP sigue sin cerrar `lifecycle_status` (el webhook inserta el pago directo y el único `closeOrderIfFullyPaid` está en la rama de mesa), y un delivery en efectivo entregado sin que nadie abra «Cobrar» no genera fila en `payments`. El backfill limpió las 5 filas históricas, pero **el camino que las produce sigue abierto**. Es trabajo de la [`092`](#144) o de una spec propia.
