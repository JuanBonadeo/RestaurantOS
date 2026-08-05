# Feature Specification: No se anula por encima de plata ya movida

**Feature Branch**: `092-no-anular-sobre-plata`

**Created**: 2026-08-05

**Status**: 🟡 Implementada en parte · H-35 queda abierto

**Issue**: #144

**Fuente**: [auditoría de estados de pedidos](../../../wiki/analyses/estados-de-pedidos-auditoria.md) — H-04, H-05, H-06, H-08, H-41, H-48 (H-35 pendiente).

## Contexto y problema

Ningún camino de anulación miraba la plata que ya se había movido, y ningún camino de plata miraba si la orden seguía viva. Seis agujeros del mismo par.

| | Qué pasaba |
|---|---|
| **H-06** | `emitInvoice` traía `lifecycle_status` en el select **desde siempre** y el cast lo tiraba — la columna aparecía una sola vez en el archivo. El encargado anulaba la mesa 12, apretaba «Re-facturar» sobre un comprobante fallido y **salía una factura B con CAE por los $80.000 de una mesa que nunca se cobró**. Sólo se saca con nota de crédito. |
| **H-04** | `anularMesa` no leía `payments` (grep vacío). Tras anular, «Anular cobro» desaparecía —esa pantalla exige `lifecycle='open'`— y quedaba un único camino nada obvio desde el libro de caja. El resumen de cierre mostraba la recaudación pero la venta no estaba en el bloque de operación: **los dos números del mismo PDF no cerraban**. |
| **H-05** | Ni `anularMesa` ni `reconcile` miraban `invoices`; grep de `orders` en `reconcile.ts` daba **cero**. Se anulaba la mesa y media hora después el cron autorizaba la factura **y le mandaba el mail al cliente**. |
| **H-41** | Todo el módulo de cobro guardaba por `lifecycle_status` y **ni siquiera traía `status`**. Como los pedidos online quedan `open` eternamente (H-40), esa guarda no protegía nada en ese canal. |
| **H-48** | El `cancelarItem` del kanban no validaba el estado de la cuenta (su gemelo de la pantalla de cuenta sí). Mesa cobrada, comanda del postre todavía en pantalla, el encargado la limpia con «86 · se acabó»: la orden dice $18.000, en caja entraron $22.000, la factura dice $22.000. **Tres números distintos.** |
| **H-08** | `anularCobro` refundaba los pagos, borraba los pendientes, reseteaba splits y **recién al final** reabría la orden — sin `.select()` y **sin capturar el error**. Si alguien había sentado gente nueva en esa mesa, el UPDATE violaba `orders_one_open_per_table` y no hacía nada, pero la action devolvía `actionOk` igual: «Cobro anulado», cuenta cerrada **y paga**, con todos sus pagos reembolsados. La plata desaparecía del arqueo y no se podía re-cobrar. |

## Decisiones de producto

| Pregunta | Decisión |
|---|---|
| ¿Bloquear o arreglar solo? | **Bloquear.** Anular un cobro o emitir una nota de crédito son decisiones con consecuencia fiscal: las toma una persona. El sistema dice qué falta y en qué orden. |
| ¿Qué se bloquea primero si hay pago **y** factura? | **El pago.** Es el primer paso operativo en los dos casos, y el mensaje tiene que dar una sola instrucción. |
| Una factura ya autorizada sobre una orden que después se anula, ¿se cierra o se deja `pending`? | **Se cierra.** El CAE es un hecho consumado ante ARCA; dejar la fila abierta no lo deshace y además invita a re-facturar. Lo que **no** se hace es avisarle al cliente, y queda un `warn` explícito de que hay que emitir NC. |
| ¿`anularCobro` pasa a RPC transaccional? | **No en esta spec** — ver Fuera de alcance. Sí se invierte el orden, que es el 90% del daño. |

## Requisitos

- **FR-001** Helper `bloqueoPorPlata(service, orderIds)` en `orders/cancel-guards.ts`: devuelve el mensaje de error o `null`.
- **FR-002** `anularMesa` y `liberarMesa` lo usan. En `liberarMesa` la guarda va **antes** de tocar `tables`: más abajo la mesa ya quedó libre y auditada, y errorear ahí dejaría la mesa liberada con su orden viva — el estado imposible que ese bloque existe para evitar.
- **FR-003** `emitInvoice` usa el `lifecycle_status` que ya traía y suma `status`; rechaza las anuladas.
- **FR-004** Todo el módulo de cobro trae `status` y corta si es `cancelled` (3 entrypoints).
- **FR-005** El `cancelarItem` del kanban exige `lifecycle_status = 'open'`.
- **FR-006** `anularCobro` **reabre primero y refunda después**, con `.select()` y chequeo de error. Si la reapertura falla, no se toca un solo peso y el mensaje dice por qué.
- **FR-007** `applyGatewayStatus` cierra la factura pero **no notifica** si la orden está anulada, y lo loguea.

## Verify

- `pnpm typecheck` ✅ · `pnpm test` ✅ **1596 tests, 0 rojos** con stack local · eslint limpio en lo tocado.
- Tests nuevos: `cancel-guards.test.ts` (6) — fijan el **criterio** y los mensajes, que es lo único que el encargado lee en hora pico.

**Lo que NO está verificado:**

- **Nada en vivo con el rol real.**
- **Los caminos nuevos de `anularCobro` y `reconcile` no tienen test propio.** El primero necesita el harness de caja completo; el segundo, un fake del gateway. La lógica es chica y está leída, pero no ejercitada.

## ⚠️ Fuera de alcance — queda abierto en #144

**H-35 · `anularCobro` sigue sin guardas de corte de caja ni de rendición.** Es el martillo más grande —refunda **todos** los pagos de la orden— y sólo pide rol y motivo, mientras que anular **una línea suelta** sí pasa por `evaluarGuardasDeAnulacion` con el último corte y las rendiciones posteriores. Peor: el mensaje de `correcciones.ts:286` («Anulá el cobro y volvé a registrarlo») **empuja justo hacia esa puerta sin control**.

Lo que falta: reusar `evaluarGuardasDeAnulacion`, escribir `caja_audit_log` por pago reembolsado (hoy no se escribe nada y `payments` no tiene `refunded_by`), y contemplar la sangría cuando el pago era efectivo y sale del cajón en un período posterior al arqueo.

**`anularCobro` como RPC transaccional.** Invertir el orden saca el daño grande, pero siguen siendo cuatro escrituras sueltas.
