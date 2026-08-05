# Feature Specification: El cobro parcial deja rastro, y borrar splits no borra la plata

**Feature Branch**: `094-cobro-parcial-y-splits`

**Created**: 2026-08-05

**Status**: 🟡 Implementada · H-09 (convención de propina) queda abierto

**Issue**: #146

**Fuente**: [auditoría de estados de pedidos](../../../wiki/analyses/estados-de-pedidos-auditoria.md) — H-07, H-10, H-33 (H-09 pendiente).

## Contexto y problema

### H-07 · el cobro parcial no dejaba rastro persistente

`registrar_pago_tx` insertaba el pago, actualizaba el split y calculaba `fully_paid` — **y nada más**. `orders.total_paid_cents` sólo lo escribía `closeOrderIfFullyPaid`, o sea **al cerrar**. En un parcial sin split (tarjeta, transferencia, MP) el progreso vivía únicamente en la pantalla.

Cuenta de $20.000, el cliente paga $12.000 con tarjeta, la pantalla dice «Falta $8.000». El mozo cambia de pantalla y vuelve: **«Falta $20.000»**, barra en 0%. Cobra $20.000 más → **$32.000 en caja**.

Y una variante que **no depende de recargar**: si quiere cobrar los $8.000 restantes en efectivo, el server responde «En efectivo no se puede cobrar menos de lo que falta ($20.000)». La pantalla dice 8.000 y el sistema exige 20.000, en hora pico.

Lo llamativo es que **la convención ya existía**: las tres RPC de corrección (`0031`, `0032`, `0033`) sí escriben `total_paid_cents`. Faltaba en la que cobra.

### H-10 · borrar splits borraba el rastro del que ya pagó

`deleteSplitsAndItems` era un `DELETE` liso de todos los `order_splits` de la orden, sin mirar pagos. El FK de `payments.split_id` es `ON DELETE SET NULL`, así que **no fallaba**: los pagos sobrevivían sin vínculo. Combinado con H-07 (`total_paid_cents` en 0), no quedaba **ningún registro consultable** de que alguien había pagado.

Mesa de 4 dividida en $10.000; uno paga y se va; después piden sacar un plato. Al anular el ítem se borraban los 4 splits, incluido el cobrado, y la pantalla volvía a mostrar la cuenta entera pendiente → **el que ya pagó paga dos veces**.

El propio código sabía del peligro: `limpiarDivision` marcaba `cancelled` los splits con pagos en vez de borrarlos. Esa lógica existía en **un solo** caller de tres.

## Decisiones de producto

| Pregunta | Decisión |
|---|---|
| ¿`total_paid_cents` se escribe en la RPC o en TS? | **En la RPC**, con el valor que ya venía calculando para decidir `fully_paid`. Escribirlo en TS dejaría una ventana entre el pago y el registro del progreso, que es justo lo que rompe. |
| ¿Los splits con pagos se borran o se cancelan? | **Se cancelan.** La fila es el único rastro de a qué se imputó ese pago; borrarla deja el pago huérfano y la plata sin explicación. |
| ¿Se toca el `revoke` de la 0007 al reemplazar la función? | **No hace falta** — un `create or replace` conserva los privilegios. Verificado en el cloud: `anon` y `authenticated` siguen sin `EXECUTE`. |

## Requisitos

- **FR-001** `registrar_pago_tx` escribe `orders.total_paid_cents = v_paid_sum` antes del return (migración `0041`).
- **FR-002** `deleteSplitsAndItems` conserva como `cancelled` los splits con pagos y borra sólo el resto.
- **FR-003** `limpiarDivision` delega en ese helper — la lógica deja de estar duplicada.
- **FR-004** *(hecho en `6b83446`)* `anularCobro` restaura `tables.current_order_id`.

## Verify

- `pnpm typecheck` ✅ · `pnpm test` ✅ **1605 tests, 0 rojos** con stack local · eslint limpio.
- Tests nuevos: `cobro-parcial.integration.test.ts` (3, contra Postgres real) — un parcial persiste, dos parciales acumulan, y un split cobrado sobrevive con su pago apuntándole.
- Migración `0041` ensayada en local y **aplicada al cloud**; verificado que el fix está en `pg_proc` y que el `revoke` de la 0007 sobrevivió (`anon`/`authenticated` con 0 grants).

**Lo que NO está verificado:**

- **Nada en vivo con el rol real.** Falta cobrar $12.000 de una cuenta de $20.000, salir de la pantalla y volver: tiene que seguir diciendo «Falta $8.000».
- Los tests de H-10 **reproducen** la lógica del helper contra la base en vez de invocar la server action (que arrastra auth y `revalidatePath`). Prueban el invariante de datos, no el cableado del caller.

## ⚠️ Fuera de alcance — queda abierto en #146

**H-09 · `payments.tip_cents` tiene dos significados incompatibles según por qué pantalla se cobre.**

| Pantalla | `amount_cents` | `tip_cents` |
|---|---|---|
| Cobro del mozo | propina **incluida** | repetida |
| Cobro desktop del encargado | igual | **arranca editable en 0**, sin el chip «Propina incluida» |
| Cobro de pedido online | propina **por encima** | |

Y los consumidores asumen convenciones distintas: `expected-cash.ts` ignora el tip, `liquidacion-mozo.ts` hace `neto = amount − tip`, `caja/queries.ts` suma ambos por separado (doble conteo en mesa).

Consecuencias reales: **la propina del mozo depende de quién apretó el botón** (cobrada desde desktop queda en 0), y un delivery con propina en efectivo deja $1.000 de sobrante en el arqueo todos los días.

No entra acá porque es un cambio de convención que toca **3 callers + 3 consumidores** y hay que decidir primero cuál es la verdad (`amount_cents` = plata que entró, `tip_cents` = cuánto de eso es propina, que es lo que ya asume `liquidacion-mozo.ts`). Hacerlo a medias deja la caja peor que ahora. Parche inmediato posible sin la convención completa: `tip={{mode:'fixed', cents: orderTipCents}}` en el cobro desktop, que al menos empareja las dos pantallas de mesa.
