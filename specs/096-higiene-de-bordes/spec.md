# Feature Specification: Higiene de bordes de estado

**Feature Branch**: `096-higiene-de-bordes`

**Created**: 2026-08-05

**Status**: 🟡 Parcial · 7 de ~17 hechos

**Issue**: #148

**Fuente**: [auditoría de estados de pedidos](../../../wiki/analyses/estados-de-pedidos-auditoria.md).

## Qué es esta spec

La bolsa de piezas **chicas e independientes** que salieron de la auditoría. No comparten causa: comparten tamaño. Por eso se pican de a una y no hace falta hacerlas todas juntas.

## Hecho

| | Qué | Commit |
|---|---|---|
| **H-11** | `enviarComanda` escribía `total_cents = subtotal` pelado, borrando descuento y propina del total pero no de sus columnas. Una mesa con 10% de descuento **nunca daba `fully_paid` y no se podía cerrar**; si se facturaba, ARCA recibía de más. | `6b83446` |
| **H-33** | `anularCobro` no restauraba `tables.current_order_id`, y `imprimirCuenta` resuelve la orden exclusivamente por ahí → «La mesa no tiene una cuenta abierta». | `6b83446` |
| **H-13** | `enviarComanda` era la **única** action del módulo sin gate de membresía: sólo `auth.getUser()` y después service client (RLS bypass). Un mozo dado de baja seguía pudiendo cargar consumo e imprimir en cocina. | `d0b3351` |
| **H-30** | Anular una mesa **ya cobrada** devolvía «Mesa anulada.», notificaba al mozo y auditaba una anulación que no ocurrió. `canTransition('libre','libre')` es true por `from === to`, y con eso **también se caía la guarda de encargado**. Ahora corta si no hay cuenta abierta. | este |
| **H-29** | El desenlace de la reserva se **deriva del consumo** en vez de asumir `no_show`. El cliente que reservó, comió y se fue sin pagar leía «No asististe» y al dueño le llegaba una alerta de asistencia caída. | este |
| **H-52** | `deleteOrder` exigía **cualquier** rol del negocio. Ahora encargado+, y rechaza explícitamente órdenes con comprobante (el FK de `invoices` es SET NULL → factura huérfana de su venta) o con pagos. | este |
| **H-38** | El `return` por fallo de comanda estaba **antes** del recompute, con los ítems ya persistidos y el stock ya descontado: el ticket, la factura y el criterio de "saldada" salían del total viejo → se cobraba de menos y la orden cerraba igual. | este |
| **H-51** | El botón «Confirmar» del detalle **nunca funcionó**: no recibe `onConfirm`, caía a `updateOrderStatus` y el server respondía «Usá "Confirmar"…» sobre el botón que decía «Confirmar». Ahora usa **el mismo predicado que el server** (`isOnlinePendingAdvance`) para decidir si dibujarlo, así UI y guarda no se pueden desincronizar. | este |

**Corrección a la auditoría:** H-51 citaba también `orders-historial-client.tsx`. Ese archivo **ya no existe** — `OrderDetailActions` tiene un solo consumidor hoy (`admin/(authed)/pedidos/[id]/page.tsx`).

## Pendiente

Ninguno es urgente por sí solo; varios son de operación desatendida, que es donde más caro sale el silencio.

| | Qué falta | Tamaño |
|---|---|---|
| **H-20** | Cron `expire-stale-pending`: un carrito de MP abandonado queda vivo para siempre con el stock descontado y sumando a la facturación del día. Y el cliente sigue viendo «Tenés un pedido en curso #312» meses después. | Medio |
| **H-23** | Los crons son **ciegos**: `pg_net` descarta la respuesta y nadie lee los contadores. Un programado que falla al marchar reintenta cada 5 min, siempre falla, y el primer aviso es el cliente parado en el mostrador. Necesita tabla `cron_runs` + notificación. | Medio |
| **H-42** | La ventana del cron de marcha no tiene piso: vuelve internet tras media hora y la comandera imprime seis comandas de golpe. | Chico |
| **H-43** | El lote `stale` del cron de reconciliación se muere de hambre por los jobs 404: cinco facturas en 404 permanente ocupan los cinco cupos en cada tick, para siempre. | Chico |
| **H-44** | Una factura rechazada por ARCA se cierra en **silencio total** — sin notificación, sin mail, sin badge. | Chico |
| **H-45** | El programado en efectivo que nadie acepta queda vivo indefinidamente. | Chico |
| **H-46** | El auto-`no_show` marca ausente a gente que está comiendo si la sentaron como walk-in. **El agujero real es la app del mozo**: no tiene «Sentar reserva» (no hay un solo import de `sentarReserva` en `components/mozo/`). | Medio |
| **H-47** | `openTable` reusa cualquier orden `open`: el walk-in nuevo puede heredar la cuenta del grupo anterior. Hay que exigir que la orden reusada no tenga ítems vivos, y **cancelar antes de liberar** en `updateTableOperationalStatus`. | Medio |
| **H-34** | La cuenta cerrada e impaga que promete la 0033 no aparece en ninguna pantalla: el board filtra `.neq('delivery_type','dine_in')` y las mesas son justo el caso que llega al libro. | Chico |
| **H-53** | `trasladar_mesa_tx` valida el destino sólo por ausencia de orden abierta, nunca por `operational_status`. Las dos UIs filtran destinos `libre`, pero la server action acepta cualquier `toTableId`. Una línea en el pre-check de la RPC (migración). | Chico |

## Verify

- `pnpm typecheck` ✅ · `pnpm test` ✅ **1609 tests, 0 rojos** con stack local · eslint limpio en lo tocado.
- **No hay tests nuevos en esta tanda.** Son guardas de borde en caminos que la suite ya recorre (la suite entera sigue verde, incluido `anular-mesa.integration.test.ts`, que ejercita el camino de H-30/H-29 contra Postgres). Lo que **no** está cubierto es el caso negativo de cada guarda — anular una mesa sin cuenta abierta, borrar un pedido siendo mozo, etc.
- **Nada verificado en vivo con el rol real.**
