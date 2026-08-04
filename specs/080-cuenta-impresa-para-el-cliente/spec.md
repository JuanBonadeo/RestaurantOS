# Feature Specification: Cuenta impresa para darle al cliente

**Feature Branch**: `080-cuenta-impresa-para-el-cliente`

**Created**: 2026-07-28

**Status**: ✅ Implementado (2026-08-04) — migración 0034 aplicada al cloud (las 2 filas de `control_tickets` migraron), `pnpm typecheck` en verde, `pnpm test` 1278 pass. Los 16 archivos rojos son `*.integration.test.ts` que no levantan por `ECONNREFUSED 127.0.0.1:54321` (stack local apagado): cero assertions fallidas. **Pendiente:** T018–T019. Issue [#127](https://github.com/gachetponzellini/RestaurantOS-app/issues/127). Milestone: Post-demo · Growth & hardening.

**Input**: Pedido de Juan 2026-07-28 — *"ahora hay que hacer algo parecido, pero para comandas de las mesas, para poder darles a los clientes con el resumen de toda la cuenta"*. Decidido con Juan (misma fecha): **siempre la cuenta entera** (no una por división), disparada por un **botón «Imprimir cuenta»**, y *"va a haber que poner una comandera configurada por salón… y que cada salón pueda tener su propia comandera"*.

Hermana de [spec 063](../063-comanda-de-control-delivery/) (control de pedido para delivery), con la que comparte el pipeline de impresión.

## Contexto y problema

Hoy **no existe ninguna cuenta impresa**. El mozo abre la cuenta en pantalla, la mesa mira el celular del mozo o le cree, y lo único que sale en papel es la **factura de ARCA** — que es otra cosa: es el comprobante fiscal, se emite al cobrar, y muchas mesas ni la piden.

Lo que falta es el papel de siempre: *"¿me traés la cuenta?"* → un ticket con el detalle de lo consumido y el total, para que la mesa lo revise **antes** de pagar. Es donde el cliente chequea que no le cobraron de más, y donde discute un ítem si hace falta.

### Lo que ya existe y se reusa

- **Los datos, completos**, en `CuentaState` ([`billing/types.ts`](../../src/lib/billing/types.ts)): ítems con cantidad, notas y precio (incluido el pisado por el encargado de spec 069), subtotal, descuento con motivo, propina, total, y `total_paid_cents` para los pagos parciales.
- **El pipeline de impresión entero** (specs 051 + 063): el server pre-renderiza ESC/POS y el agente relay imprime los bytes. `toAscii`, `wrap`, `renderEscPos` son agnósticos del contenido.
- **La pantalla de la cuenta** del mozo ([`cuenta-client.tsx`](../../src/app/[business_slug]/mozo/mesa/[id]/cuenta/cuenta-client.tsx)), con su bloque de acciones al lado de «Dividir cuenta».
- **`tables.floor_plan_id`** es `NOT NULL`: toda mesa pertenece a un salón, así que el salón siempre se puede resolver.

## Decisiones de diseño

### D1 — Se generaliza `control_tickets` en `print_jobs`, no se crea una tercera tabla

La cuenta necesita exactamente la misma maquinaria que el control de pedido (spec 063): una fila `pendiente`, el agente la levanta, la imprime y la confirma; con `print_failed_at` para el fallo. Crear `cuenta_tickets` al lado de `control_tickets` sería la segunda copia de la misma tabla y la tercera rama del mismo `if` en el endpoint.

Se unifican en **`print_jobs`** con una columna `kind` (`control` | `cuenta`). `control_tickets` tiene 2 filas y menos de un día de vida (spec 063 se implementó hoy y su verify en vivo todavía está pendiente), así que migrarlas es un `insert … select`.

La diferencia de comportamiento entre los dos tipos queda expresada **en el esquema**, no en código:

```sql
create unique index print_jobs_control_uniq on print_jobs(order_id) where kind = 'control';
```

Un control por orden (idempotencia de la marcha); cuentas, las que haga falta. Que es justo la diferencia real: **el control sale una vez, la cuenta se pide de nuevo cuando la mesa agrega un café**.

### D2 — Comandera por salón, con el negocio como fallback

Pedido de Juan. `floor_plans.cuenta_printer_*` (por salón) + `businesses.cuenta_printer_*` (default del local). Resolución:

1. El salón tiene IP → imprime ahí.
2. El salón tiene la comandera **apagada** → no imprime (el "off" explícito gana; no cae al fallback).
3. El salón no tiene IP → cae a la del negocio.
4. Ninguna de las dos → no imprime.

Así un local chico configura una sola y anda; uno con terraza y salón interno le pone una a cada uno sin tocar la otra.

### D3 — El agente del local sigue sin tocarse

Igual que en 063: los jobs viajan en el array `comandas` del `GET /api/print-agent` con su propio UUID y el `POST` los resuelve por id. El `.exe` no cambia.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — El mozo imprime la cuenta (Priority: P1)

Como **mozo**, la mesa 12 me pide la cuenta. Desde la pantalla de la cuenta toco «Imprimir cuenta» y sale en la comandera de ese salón un ticket con todo lo consumido y el total, para dárselo a la mesa.

**Acceptance**:
1. El botón está en la pantalla de la cuenta, junto a «Dividir cuenta».
2. Imprime **la cuenta entera**, aunque la mesa esté dividida en splits.
3. Se puede tocar **varias veces**: cada vez sale un papel nuevo con lo que haya en ese momento.
4. A partir de la segunda, el ticket sale marcado **«REIMPRESIÓN»** para que no se confunda con el anterior.
5. Si no hay comandera resuelta (ni salón ni negocio), el botón avisa que no hay comandera configurada y no deja un job colgado.

### User Story 2 — El cliente entiende lo que le cobran (Priority: P1)

Como **cliente**, leo el ticket y veo qué consumí, a cuánto, y cuánto tengo que pagar.

**Acceptance**:
1. Cada ítem con cantidad, nombre y precio de línea. Los ítems anulados **no** aparecen.
2. Subtotal, descuento (con su motivo si lo tiene) y **TOTAL**, destacado.
3. Si hay pagos parciales, sale **«Pagado»** y **«RESTA»** — el resto es lo que la mesa todavía debe.
4. Si la propina ya está cargada, se muestra como renglón propio; si no, el ticket aclara que **no está incluida**.
5. El pie dice que **no es factura** — el comprobante fiscal es el de ARCA, que es otro papel.

### User Story 3 — El encargado configura la comandera de cada salón (Priority: P2)

Como **encargado**, en Ajustes → Operación del local pongo la comandera de cuentas del local, y si un salón necesita la suya, se la configuro aparte.

**Acceptance**:
1. Campo de comandera de cuentas a nivel negocio, junto al de control (spec 063).
2. Una fila por salón, con IP + puerto + switch, que muestra cuándo está heredando la del negocio.
3. Solo admin/encargado, el mismo gate que el resto de las comanderas.

## Requisitos funcionales

- **FR-001** Tabla `print_jobs` (`kind`, `order_id`, `business_id`, `status`, `emitted_at`, `printed_at`, `print_failed_at`, `reprint_requested_at`, `requested_by`), con índice único parcial sobre `order_id` **solo** para `kind = 'control'`.
- **FR-002** `control_tickets` se migra a `print_jobs` (`kind = 'control'`) y se elimina.
- **FR-003** `floor_plans.cuenta_printer_ip / _port / _enabled` y `businesses.cuenta_printer_ip / _port / _enabled`.
- **FR-004** La resolución de comandera de una cuenta sigue D2: salón con IP → salón; salón apagado → nada; salón sin IP → negocio; ninguna → nada.
- **FR-005** Action `imprimirCuenta(tableId, slug)`: gate de mozo sobre la mesa, exige orden abierta con total > 0, **resuelve la comandera antes de insertar** y devuelve error claro si no hay ninguna.
- **FR-006** El ticket se marca `reprint` cuando ya existe un `print_job` de `kind='cuenta'` previo para esa orden.
- **FR-007** El render (`buildCuentaTicketContent`) sale en ASCII, reusando los primitivos de `ticket.ts`.
- **FR-008** Todo texto de origen externo (nombre de producto, notas, motivo de descuento) pasa por `sanitizeTicketText`.
- **FR-009** El `GET /api/print-agent` resuelve la comandera por `kind` y saltea los jobs sin destino.

## Éxito medible

- **SC-001** Tocar «Imprimir cuenta» dos veces produce dos jobs; el segundo sale marcado como reimpresión (test).
- **SC-002** El control de pedido sigue siendo **uno solo** por orden después de la migración (test + índice único parcial).
- **SC-003** Un salón con comandera propia imprime ahí; uno sin comandera cae a la del negocio; uno apagado no imprime (test).
- **SC-004** El agente no se recompila: el contrato del `GET`/`POST` no cambia de forma.
- **SC-005** `pnpm typecheck` + `pnpm test` en verde, con los tests de 063 adaptados a `print_jobs`.

## Fuera de alcance

- Un ticket por división (`order_splits`). Decisión de Juan: siempre la cuenta entera.
- Imprimir la cuenta automáticamente al «Pedir la cuenta».
- Reemplazar la factura de ARCA — son papeles distintos y conviven.
- QR de pago en el ticket.
