# Feature Specification: Comanda de control para delivery y retiro

**Feature Branch**: `063-comanda-de-control-delivery`

**Created**: 2026-07-28

**Status**: ✅ Implementado (2026-07-28) — migración 0028 aplicada al cloud, `pnpm typecheck` en verde, `pnpm test` 934 pass (los 6 rojos son timeouts de latencia cloud en `traslado.integration` / `cuenta.integration`, **preexistentes**). **Pendiente:** T015, verify en vivo con el print-agent. Issue [#97](https://github.com/gachetponzellini/RestaurantOS-app/issues/97). Milestone: Post-demo · Growth & hardening.

**Input**: Pedido de Juan 2026-07-28 — *"lo de la comandera de control que había dicho es porque además de imprimir la comanda de cocina, hay que imprimir una comanda para el que se encarga del delivery"*, con foto de un «Control de Pedido» de MaxiRest del Restaurant del Golf como referencia.

Se apoya en [spec 061](../061-delivery-programado-y-lead-configurable/) (el control de un programado sale con el lead del negocio) y en [spec 28](../../../wiki/specs/28-comanderas-config-por-sector/) (impresoras por sector) + [spec 051](../051-print-agent-render-server/) (el server pre-renderiza el ticket).

## Contexto y problema

### La comanda de cocina no le sirve al repartidor

Lo que hoy se imprime al marchar un pedido es la comanda de cocina, y está deliberadamente diseñada para cocina: **sin precios**, **partida por sector** (una a la parrilla, otra a la fritera, [`route-items.ts`](../../src/lib/comandas/route-items.ts)), en doble alto y doble ancho para leerse de lejos, y **sin cliente, teléfono ni dirección** ([`ticket.ts:159`](../../src/lib/print/ticket.ts)).

El que sale a repartir necesita exactamente lo contrario, y todo junto en un solo papel:

| | Comanda de cocina | Control de pedido |
|---|---|---|
| Ítems | solo los de su sector | **todos** |
| Precios | ❌ | ✅ |
| Total y **cuánto cobrar** | ❌ | ✅ |
| Cliente / teléfono / dirección | ❌ | ✅ |
| Horario de entrega | ❌ | ✅ |
| Para quién | cocina | repartidor / mostrador |

La referencia de MaxiRest lo dice en el encabezado: *Control de Pedido*, con `Repartidor:` en blanco para completar a mano, `Horario de Entrega:`, `Paga con:` / `Vuelto:`, y el pie *DOCUMENTO NO VALIDO COMO FACTURA*. En el ticket de ejemplo la hora de entrega y el nombre están escritos en **Observaciones** (`20:30 Rodrigo`) — el workaround que spec 061 vino a reemplazar.

### Lo que ya existe y se reusa

- **Pipeline de impresión completo** (spec 051): el server pre-renderiza ESC/POS + texto plano y el agente relay imprime los bytes tal cual. `toAscii`, `wrap`, `renderEscPos` y `renderPlain` en [`ticket.ts`](../../src/lib/print/ticket.ts) son agnósticos del contenido.
- **Un solo punto de emisión:** las cuatro rutas que mandan un pedido a cocina (`confirmarPedido`, el cron de programados, el webhook de MP, la venta de mostrador) pasan todas por [`routeOrderToCocina`](../../src/lib/orders/route-to-cocina.ts), que ya es idempotente.
- **Config de impresoras por sector** en Ajustes → Operación del local ([`station-printers-form.tsx`](../../src/components/admin/settings/station-printers-form.tsx)) — el lugar donde el encargado ya configura comanderas.
- **Sanitizado del stream** (`sanitizeTicketText`, security review #8) — un `notes` de un pedido online no puede inyectar comandos ESC/POS.

## Decisiones de diseño

### D1 — Tabla propia, no una fila en `comandas`

Un ticket de control no tiene sector, ni tanda, ni estado de cocina, ni `delivered_at`. Meterlo en `comandas` significaría hacer `station_id` nullable y sumar un `kind`, y después **filtrar por ese `kind` en los ~8 lugares que leen la tabla** — KDS, kanban de comandas, reportes, notificaciones, demora de mesa, el pedir del mozo. Cada uno que se olvide es un ticket de control apareciendo en la pantalla de la cocina.

Tabla `control_tickets` aparte: blast radius cero sobre los flujos de cocina.

### D2 — El print-agent instalado en el local NO se toca

El agente confirma la impresión mandando `{ comanda_id, business_id, result }` y nada más ([`agent.mjs:349`](../../print-agent/agent.mjs)). Entonces:

- Los tickets de control viajan en **el mismo array** `comandas` del `GET /api/print-agent`, con su propio UUID, su `printer_ip` y su contenido ya renderizado. Para el agente son un ítem más de la lista.
- El `POST` resuelve el id contra `comandas` y, si no está, **cae a `control_tickets`**. Colisión de UUIDs: no.

Esto importa porque el `.exe` del local se actualiza por TeamViewer. Un cambio que necesite recompilar y visitar el local no vale lo mismo que uno que es solo un deploy de Vercel.

### D3 — Comandera propia a nivel negocio

Decisión de Juan: campo nuevo en el negocio (no un flag sobre `stations`), **configurado desde Ajustes → Operación del local**, junto a las comanderas por sector. Es un destino único por local, no un sector más.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Sale el control junto con la cocina (Priority: P1)

Como **repartidor**, cuando el pedido marcha a cocina sale también, en la comandera de control, un ticket con todo el pedido: qué lleva, para quién, a dónde, a qué hora tiene que estar y cuánta plata cobrar.

**Acceptance**:
1. Al marchar un pedido `delivery` o `pickup` se emite **un** ticket de control además de las comandas de cocina.
2. Un pedido `dine_in` (venta de mostrador, mesa) **no** emite control.
3. Es **idempotente**: marchar dos veces (reintento, ticks solapados del cron, «Marchar ahora» sobre algo que el cron ya tomó) deja **un** solo ticket.
4. En un pedido programado sale con el lead configurado en spec 061 — el mismo momento que las de cocina.
5. Si el negocio no tiene comandera de control configurada (IP vacía o apagada), no se imprime nada y **no se rompe** la impresión de cocina.

### User Story 2 — El repartidor sabe cuánto cobrar (Priority: P1)

Como **repartidor**, leo del ticket si el pedido ya está pagado o cuánta plata tengo que traer de vuelta.

**Why this priority**: Es la diferencia entre el ticket y una comanda cualquiera. Cobrar de más o de menos es plata del local.

**Acceptance**:
1. Pedido con `payment_status = 'paid'` → **«PAGADO — NO COBRAR»**, destacado.
2. Pedido impago → **«A COBRAR: $X»** con el total, destacado.
3. El total del ticket es el mismo `total_cents` de la orden (subtotal + envío − descuento), desglosado.

### User Story 3 — El encargado configura la comandera de control (Priority: P2)

Como **encargado**, en Ajustes → Operación del local pongo la IP de la comandera de control, igual que pongo la de cada sector.

**Acceptance**:
1. Campo de IP + puerto (default 9100) + switch de encendido, en la misma pantalla que las comanderas por sector.
2. IP vacía = sin comandera de control (no se imprime).
3. Solo admin/encargado, el mismo gate que la config de sectores.

## Requisitos funcionales

- **FR-001** Tabla `control_tickets` (`order_id` **único**, `business_id`, `status`, `emitted_at`, `printed_at`, `print_failed_at`, `reprint_requested_at`), con RLS: `select` scopeado por membresía, sin `insert/update/delete` para `anon`/`authenticated`.
- **FR-002** `businesses.control_printer_ip` (nullable), `control_printer_port` (default 9100), `control_printer_enabled` (default `true`).
- **FR-003** `routeOrderToCocina` emite el ticket de control cuando `delivery_type ∈ {delivery, pickup}`, después de crear las comandas. La unicidad de `order_id` da la idempotencia.
- **FR-004** Un fallo al emitir el control **no** hace fallar la marcha: se loguea y sigue. La comida entra a cocina igual.
- **FR-005** El `GET /api/print-agent` devuelve los control tickets `pendiente` (o con reimpresión pedida) del negocio, en el array `comandas`, con `printer_ip`/`printer_port`/`printer_enabled` del negocio y `station_name: "CONTROL"`.
- **FR-006** El `POST /api/print-agent` resuelve el id contra `comandas` y, si no existe, contra `control_tickets`, aplicando el mismo check de ownership por `business_id` y el mismo tratamiento de `ok` / `failed`.
- **FR-007** El ticket se renderiza en el server (`buildControlTicketContent`), en ASCII, reusando `renderEscPos` / `renderPlain`.
- **FR-008** Todo el texto de origen externo (nombre, dirección, observaciones, nombres de producto) pasa por `sanitizeTicketText` antes de entrar al stream.
- **FR-009** La configuración de la comandera de control vive en Ajustes → Operación del local y se guarda con el gate de encargado/admin.

## Contenido del ticket

```
    NOMBRE DEL NEGOCIO          centrado, negrita
    direccion
    telefono
    ------------------------
    Control de Pedido           centrado
    DELIVERY #123               doble alto, centrado   (o RETIRO #123)
    ------------------------
    Emitido: 28/07 19:16
    Entrega: 28/07 20:30        (o "Lo antes posible")
    Repartidor: ______          (solo delivery)
    ------------------------
    2x Brochette de lomo
                    66000.00
    1x Papa rejilla
                     9500.00
    ------------------------
    Subtotal:      110500.00
    Envio:           1500.00
    Descuento:      -1000.00
    TOTAL:         111000.00    doble alto
    ------------------------
    A COBRAR: 111000.00         doble alto   (o "PAGADO - NO COBRAR")
    Metodo: Efectivo
    ------------------------
    Cliente: Juan Perez
    Tel: 341 555 1234
    Direccion: Calle 123
    Obs: tocar timbre
    ------------------------
    DOCUMENTO NO VALIDO COMO FACTURA
```

## Éxito medible

- **SC-001** Marchar un delivery produce exactamente 1 ticket de control; marcharlo de nuevo sigue produciendo 1 (test).
- **SC-002** Un `dine_in` produce 0 (test).
- **SC-003** Un negocio sin comandera de control configurada imprime sus comandas de cocina sin cambios (test).
- **SC-004** El agente **no se recompila**: el contrato del `GET`/`POST` no cambia de forma.
- **SC-005** `pnpm typecheck` + `pnpm test` en verde.

## Fuera de alcance

- Asignar el repartidor en el sistema (el ticket deja la línea en blanco para escribir a mano).
- Reimpresión del control desde el board — la columna `reprint_requested_at` queda lista, el botón no.
- Ticket de control para pedidos de mesa.
- Agrupar varios pedidos en una hoja de ruta del repartidor.
