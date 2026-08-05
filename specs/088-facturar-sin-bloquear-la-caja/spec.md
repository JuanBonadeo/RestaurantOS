# Feature Specification: Facturar no bloquea la caja

**Feature Branch**: `088-facturar-sin-bloquear-la-caja`

**Created**: 2026-08-04

**Status**: ✅ Implementada

**Input**: Juan, 2026-08-04, probando ARCA en golf-jcr: *"el tema es que se queda esperando hasta que emitan la factura, pero generalmente se encola y puede demorar"*.

**Issue**: #140

**Depende de**: [`086-facturar-desde-el-cobro-del-encargado`](../086-facturar-desde-el-cobro-del-encargado/spec.md) (la pantalla que se desbloquea) · [`013-facturacion-arca-afip`](../../../wiki/specs/13-facturacion-arca-afip/spec.md) + su [addendum del gateway](../../../wiki/specs/13-facturacion-arca-afip/addendum-gateway.md) (declara la Fase 2 del webhook, que esta spec **reemplaza como prioridad**) · patrón de cron de [`031`](../031-pedidos-diferidos/spec.md) y migraciones `0012`/`0013`/`0017`.

## Contexto y problema

El gateway es asíncrono: `enqueue` devuelve `202 { job_id }` y el CAE llega después. Hoy la UI lo espera con **polling del cliente** y le dice al operador **"No cierres esta pantalla"**. Contra los datos reales de `invoice_jobs`:

| Dato | Valor real |
|---|---|
| Worker del gateway | corre cada 1 min |
| Backoff de reintentos | 1 → 5 → 15 → 60 min (hasta 5 intentos) |
| Tiempo hasta estado terminal | **promedio ~28 min · máximo ~85 min** |
| Deadline del polling del cliente | **120 s** (`src/lib/afip/poll.ts:25`) |

Los dos últimos renglones no cierran. **Aunque el operador no cierre la pantalla, en el peor caso nunca ve el desenlace.** Y si la cierra —lo que va a pasar siempre en hora pico— la factura queda `pending` **para siempre**: no hay nada del lado app que vaya a buscar cómo terminó. Mientras tanto, la caja está trabada mirando un spinner.

Esto ya está pasando en producción: golf-jcr tiene dos `invoices` en `failed` que se descubrieron **consultando la base**, no desde la app.

## Decisiones de producto

| Pregunta | Decisión |
|---|---|
| ¿Webhook del gateway o cron en la app? | **Cron.** El gateway ya tiene motor de webhooks firmados, pero (a) **no hay alta self-service** de la URL —ni endpoint ni panel, sólo un script o un INSERT a mano— y (b) la entrega es **best-effort real**: 2 intentos, timeout 3 s, sin tabla de deliveries. Si la app tose 5 segundos el evento se pierde para siempre. El webhook **no puede ser la garantía**. Un sistema con cron y sin webhook está completo; uno con webhook y sin cron, no. |
| ¿Qué ve el operador mientras tanto? | Emite y **sigue trabajando**. Se va el "No cierres esta pantalla"; queda *"Facturando… podés cerrar, queda en Facturación"*. El polling del cliente sobrevive como cortesía —si el CAE sale en 3 segundos, lo ve— pero deja de ser el contrato. |
| ¿El ticket fiscal se imprime solo cuando el cron cierra la factura? | **No, sigue manual.** `imprimirFactura` sigue siendo gesto humano de encargado/admin. Auto-print es fase 2: imprimir sin que nadie esté mirando la comandera es papel tirado. |
| ¿Una `pending` vieja se marca `failed` sola? | **No.** Marcarla sin respuesta del gateway invita a re-facturar algo que quizá ya tiene CAE → **comprobante fiscal duplicado**. Se cuentan como `stale`, se pollean con menos frecuencia y se muestran con badge. Una pendiente visible es infinitamente mejor que una factura fantasma. |
| ¿Re-encolar automáticamente una fallida? | **No.** `retryInvoice` sigue siendo humano (encargado/admin) y con `Idempotency-Key` nueva. La reconciliación anti-duplicado del gateway (`attempted_numero`) es **por job**: un job nuevo no la hereda. |

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Cobrar y seguir (Priority: P1)

Como encargado en hora pico, quiero emitir la factura y volver al salón sin esperar el CAE.

**Independent Test**: cobrar, tocar «Emitir Factura B», cerrar la pantalla enseguida. A los pocos minutos la factura aparece `authorized` con su CAE en **Facturación**, sin que nadie haya vuelto a la pantalla de cobro.

### User Story 2 - El fracaso se ve (Priority: P1)

Como encargado, quiero enterarme de que una factura no salió, aunque me haya ido de la pantalla.

**Independent Test**: con el certificado sin `wsfe` autorizado (el estado real de golf-jcr hoy), emitir y cerrar. La factura termina `failed` en Facturación con el mensaje del gateway y el botón «Reintentar». Hoy quedaría `pending` para siempre.

### User Story 3 - Nada se pisa (Priority: P2)

Como sistema, quiero que el cron y el poller de la pantalla no escriban dos veces la misma factura.

**Independent Test**: con la pantalla abierta polleando, forzar el cron sobre la misma factura. Una sola transición a `authorized`, un solo aviso al cliente.

## Requisitos

- **FR-001** Un cron cada 2 min cierra las `invoices` en `pending` con `provider_job_id`, consultando al gateway. Endpoint `POST /api/cron/reconcile-invoices` con el molde exacto de los crons existentes (Bearer `CRON_SECRET`, 503 sin secreto, 401 si no matchea).
- **FR-002** La lógica de persistencia es **la misma** que usa el poller de la UI: `applyGatewayStatus` en un módulo `server-only`, con el UPDATE condicional `.eq("status","pending")` como guarda optimista; si no devuelve fila, otro ganó la carrera y se relee la fresca. `pollInvoiceStatus` pasa a ser el wrapper con auth encima.
- **FR-003** El barrido agrupa por `business_id` y resuelve credencial + provider **una vez por negocio**; saltea sandbox y negocios sin credencial **sin llamar al gateway**.
- **FR-004** Lotes acotados (frescas + viejas) y `maxDuration = 60`: lo que no entra en un tick entra en el siguiente.
- **FR-005** Un 401/5xx del gateway **no** marca la factura `failed` — sigue `pending` y se cuenta. Sólo el desenlace real del gateway (`emitted` / `error`) es terminal.
- **FR-005b** Un **404 tampoco cierra la factura**, aunque `gateway.ts` lo mapee a `failed`. Ese mapeo se escribió para la pantalla, donde se pollea un job creado segundos antes con la misma credencial: ahí un 404 sí significa "job inexistente". El barrido consulta jobs de días atrás, cada 2 minutos y sin nadie mirando, así que un `base_url`/`tenant_slug` desactualizado —que devuelve 404 en **toda** ruta— daría por fallido un backlog entero de facturas que ARCA quizá autorizó. Y una `failed` habilita «Reintentar», que reemite con clave nueva: **comprobante duplicado**. Se cuentan como `unknownJob`; si ese contador sube, hay que mirar la config del negocio.
- **FR-005c** El barrido se limita a `provider = 'gateway'`: una fila de otro provider no tiene job que consultar en este gateway.
- **FR-006** La migración incluye `revoke execute from anon, authenticated` sobre la función del cron. Sin eso, al ser `SECURITY DEFINER` y ejecutable por PostgREST, cualquiera con la publishable key la dispara con el Bearer ya puesto por la propia función (agujero que la migración `0017` tuvo que tapar para los tres crons anteriores).
- **FR-007** La emisión deja de bloquear la pantalla; el copy cambia y en Facturación una `pending` de más de ~10 min se marca como demorada.
- **FR-008** Se manda `metadata: { invoice_id, business_id, slug }` al encolar. El gateway ya la persiste tal cual: cero costo hoy, correlación lista para la fase 2.

## Fuera de alcance (fase 2)

- Receptor de webhook `POST /api/arca/webhook/[slug]` con verificación HMAC del body crudo.
- Realtime sobre la fila `invoices` para que la pantalla se actualice sola.
- Auto-print del ticket fiscal.
- Issues en el repo `arca-gpsf-gateway`: alta self-service de webhooks, `webhook_deliveries` con reintento durable, payload incompleto (`tenant_slug`, `status`, `emitted_at`) y `docs/API.md`, que promete un backoff de webhooks que el código no hace.

## Riesgos → tests

| Riesgo | Test |
|---|---|
| Doble escritura cron vs poller | el UPDATE condicional no devuelve fila → relee la fresca, sin doble `notifyInvoiceIssued` |
| No se persiste el CAE | `emitted` → `authorized` con CAE/vto/número/QR |
| `max_attempts_exceeded` colgado | `error` → `failed` con el `error_detail` del gateway |
| Cierre prematuro | `pending`/`retrying` → fila intacta, cero writes |
| Bucle mudo por credencial rota | 401 del gateway → sigue `pending`, se cuenta, no se marca `failed` |
| Cross-tenant | negocio sandbox o sin credencial → skip sin fetch; el negocio A nunca escribe filas del B |
| Endpoint abierto | 503 sin `CRON_SECRET`, 401 con Bearer malo, 200 con Bearer bueno |
| Bypass por PostgREST | assert de `has_function_privilege('anon', …)` = false |
| **404 → duplicado fiscal** | un `not_found` del gateway deja la fila `pending` y suma `unknownJob`, sin escribir |

## Notas de implementación

**Estado: ✅ implementada** (2026-08-04). Un review adversarial del diff (32 agentes) encontró **un defecto real**, confirmado por dos verificadores independientes y corregido antes de commitear:

> El barrido cerraba como `failed` cualquier job que el gateway respondiera con **404**. El mapeo `404 → failed` de `gateway.ts` es preexistente, pero hasta ahora sólo se alcanzaba durante los 120 s en que un operador miraba la pantalla polleando un job recién creado — donde el 404 es casi imposible. El cron lo convertía en un camino **automático, permanente y desatendido** sobre todo el histórico de pendientes: un `base_url` apuntando a un deploy muerto (404 en toda ruta) flipeaba el backlog entero a `failed` en dos minutos, y `retryInvoice` acepta `failed` → reemite con clave nueva → **comprobante fiscal duplicado**. Además violaba el FR-005 que esta misma spec había escrito.

Verificado también (y refutado por el review, no son problemas): el UPDATE condicional es idéntico al preexistente; `notifyInvoiceIssued` no se dispara dos veces; el `setEmitting(false)` adelantado no habilita doble emisión (el guard del server y el índice único siguen mandando); el `cron.schedule` es idempotente por jobname.

## Verify

- `pnpm typecheck` ✅ · `pnpm build` ✅ · `pnpm test` ✅ (los 16 archivos `*.integration` fallan por falta de stack local, igual que antes) · `eslint` limpio en lo tocado.
- Tests nuevos: `reconcile.test.ts` (14), `api/cron/reconcile-invoices/route.test.ts` (4), `format.test.ts` (3).
- Migración `0037` aplicada al cloud `tjfufswzsxfujcpoxapx` y verificada: job `invoices-reconcile` activo `*/2 * * * *`, `has_function_privilege('anon'|'authenticated', …) = false`, índice creado.
- **Pendiente de verificación en vivo**: que el cron cierre una factura real. Hoy golf-jcr no puede emitir — el certificado no tiene `wsfe` autorizado en ARCA —, así que lo primero que se va a ver es el camino `failed`, que es justamente el que hoy quedaba invisible.
