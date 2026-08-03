# Feature Specification: Admin — avisos libres a la comandera de un sector

**Feature Branch**: `057-avisos-a-comanderas`

**Created**: 2026-07-23

**Status**: Propuesto — pendiente de implementación. Issue [#84](https://github.com/gachetponzellini/RestaurantOS-app/issues/84). Milestone: Post-demo · Growth & hardening. Reusa el canal print-agent de [features/comandas.md](../../../wiki/features/comandas.md) (specs [28](../../../wiki/specs/28-comanderas-config-por-sector/) / [33](../../../wiki/specs/33-impresion-instantanea-y-aviso-fallo/) / [35](../../../wiki/specs/35-reimpresion-y-fallos-de-impresion/)). **Depende del spec [051](../051-print-agent-render-server/)** (render en server / relay, issue #85): con 051 el **server renderiza el ticket AVISO** y el agente relay lo imprime **sin tocar el `.exe`** — 057 se implementa **después** de 051.

**Input**: Pedido de Juan 2026-07-23 — "un sistema simple para poder mandar mensajes a las comanderas, que sería a los sectores, tiene que ser simple". Decisiones de alcance (Juan, 2026-07-23): **admin y encargado** (mostrador/operación) mandan los avisos — el **mozo no** — y **texto libre** (sin plantillas/botones rápidos). El render del ticket lo hace el **server** (vía spec 051), no el `.exe`.

## Contexto y problema

Las comanderas (impresoras térmicas por sector) hoy **solo** imprimen comandas atadas a una orden/mesa. No hay forma de que el mostrador le mande a un sector un aviso suelto: *"86 lomo"* (se acabó), *"apurar mesa 12"*, *"entran 20 cubiertos 21hs"*, *"postre con vela mesa 8"*. Esos avisos hoy se gritan o se caminan hasta la cocina.

El objetivo es un canal de **texto libre → comandera de un sector**, lo más simple posible, montado sobre la infraestructura de impresión que ya existe y funciona on-site en golf-jcr.

### Lo que ya existe y se reusa

- **Canal print-agent pull-based**: el agente en la PC del local hace polling a `GET /api/print-agent?business_id=X` (Bearer key por negocio), imprime por TCP 9100 en la `printer_ip` que viene en cada fila, y confirma con `POST /api/print-agent`. Ver [`route.ts`](../../src/app/api/print-agent/route.ts) + [`agent.mjs`](../../print-agent/agent.mjs). **Un aviso es un ticket más — reusa el mismo pull, el mismo POST, el mismo transporte.**
- **La impresora vive en el sector**: `stations.printer_ip` / `printer_port` / `printer_enabled` (spec 28, baseline `0001`). El destino "a la Parrilla" = el `printer_ip` de esa `station`. Cero mapeo nuevo.
- **`sanitizeTicketText()`** ([`route.ts:14`](../../src/app/api/print-agent/route.ts)): saneo de bytes de control ESC/POS que ya se aplica a todo texto que sale al agente. **El body del aviso pasa por el mismo saneo** (es texto de usuario → vector de inyección a la impresora).
- **Patrón de campos aditivos** en el payload del GET (`cancelled`, `reprint`): un agente viejo ignora lo que no conoce. El array `messages` sigue ese patrón.
- **Patrón de flags** (`print_failed_at`): estado por columna, sin máquina de estados.
- **Gates de operación en `can.ts`** (`canConfirmOrder`, `canCargarPedido` = `admin || encargado`): el aviso sigue ese patrón con un helper nuevo `canEnviarAvisoComandera` (admin/encargado). **No** usa `canManageBusiness` (ese excluiría al encargado).
- **Render en el server (spec 051)**: el módulo `src/lib/print/ticket.ts` renderiza el ESC/POS server-side y el agente es un **relay**. El aviso reusa ese módulo (un `buildAvisoContent`) → el ticket AVISO sale ya renderizado del server y el relay lo imprime **sin cambios en el `.exe`**.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Mandar un aviso a un sector (Priority: P1)

Como **admin o encargado**, desde el tab **Comandas** de operación toco **«Enviar aviso»**, elijo un sector (ej. Parrilla), escribo un texto libre (*"86 lomo"*) y envío. En el próximo pull el agente relay imprime un ticket **AVISO** (renderizado por el server, spec 051) en la comandera de la Parrilla, y el aviso queda marcado como impreso.

**Why this priority**: Es el pedido central y el camino feliz completo.

**Independent Test**: Llamar `enviarAvisoComandera(slug, stationId, "86 lomo")` con rol admin → se inserta una fila en `station_messages` (`printed_at=null`); el `GET /api/print-agent?business_id=X` la devuelve en `messages[]` con el `printer_ip` de ese sector y el body saneado; un `POST /api/print-agent {message_id, result:"ok"}` setea `printed_at`.

**Acceptance Scenarios**:

1. **Dado** un admin en el tab Comandas, **Cuando** elige un sector con comandera activa, escribe un texto y envía, **Entonces** se persiste una fila en `station_messages` con `business_id`, `station_id`, `body`, `created_by` y `printed_at=null`.
2. **Dado** ese aviso pendiente, **Cuando** el print-agent hace su GET, **Entonces** aparece en `messages[]` con `station_id`, `station_name`, `printer_ip`, `printer_port`, `body` (saneado) y `created_by_name`.
3. **Dado** que el agente imprimió, **Cuando** hace `POST {message_id, result:"ok"}`, **Entonces** el aviso queda `printed_at` y **no vuelve a aparecer** en el próximo GET.
4. **Dado** un **mozo**, **Cuando** intenta enviar un aviso, **Entonces** se rechaza (gate `canEnviarAvisoComandera`) y el botón no se le muestra en la UI; **admin y encargado** sí pueden.
5. **Dado** un texto con bytes de control / caracteres ESC/POS, **Cuando** se envía, **Entonces** el body sale saneado (`sanitizeTicketText`) y no inyecta comandos a la impresora.
6. **Dado** un aviso de **otro negocio**, **Cuando** el agente confirma con el `business_id` propio, **Entonces** se rechaza (scope `business_id`, igual que las comandas).

---

### User Story 2 — Mandar un aviso a todos los sectores (Priority: P2)

Como **admin**, elijo **«Todos los sectores»** y el aviso (*"cocina cierra 23:30"*) se imprime en cada comandera activa.

**Why this priority**: Útil para avisos generales, pero secundario al envío dirigido. Es un loop sobre US1.

**Independent Test**: `enviarAvisoComandera(slug, "todos", body)` con 3 sectores `printer_enabled=true` → inserta 3 filas (una por sector), cada una ruteada a su `printer_ip`.

**Acceptance Scenarios**:

1. **Dado** 3 sectores con comandera activa y 1 sin comandera, **Cuando** el admin envía a «Todos», **Entonces** se insertan **3** filas (solo las de sectores con `printer_enabled=true`).
2. **Dado** el envío a todos, **Cuando** el agente pollea, **Entonces** cada sector recibe su copia en su propia comandera.

### Edge Cases

- **Sector sin comandera** (`printer_ip=null` o `printer_enabled=false`): la UI no lo ofrece como destino y «Todos» lo saltea. Un aviso nunca queda colgado esperando una impresora que no existe.
- **Body vacío o solo espacios**: la action lo rechaza (Zod, `trim().min(1)`).
- **Body muy largo**: se limita a **200 caracteres** (papel térmico; Zod `max(200)`).
- **Agente pre-051** (sin soporte de relay/`messages`): ignora el array → los avisos quedan `printed_at=null` hasta migrar al relay. Como 057 va **después** de 051, en golf el relay ya está desplegado → **057 no requiere `.exe` nuevo**. Degradación documentada.
- **Fallo de impresión**: si el agente reporta `result:"failed"`, se setea `station_messages.print_failed_at` (best-effort). En fase 1 **no** hay notificación ni reintento automático del aviso (a diferencia de las comandas): el admin reenvía si hace falta.
- **Aviso ya impreso**: `printed_at` no nulo → el GET no lo trae; un `POST ok` repetido es no-op idempotente.

## Requirements *(mandatory)*

### Functional Requirements

**Enviar aviso (US1, US2)**

- **FR-001**: `enviarAvisoComandera(slug, target, body)` MUST resolver el negocio por slug, exigir sesión y gate `canEnviarAvisoComandera` (admin/encargado — helper nuevo en `can.ts`, patrón operación); `target` = un `stationId` (uuid) **o** el literal `"todos"`.
- **FR-002**: MUST validar `body` con Zod: `trim`, no vacío, `max(200)`. Rechazo claro si falla.
- **FR-003**: Con un `stationId`, MUST verificar que la station pertenece al negocio y tiene `printer_enabled=true`; inserta **una** fila en `station_messages` (`created_by` = usuario de sesión, `printed_at=null`).
- **FR-004**: Con `target="todos"`, MUST insertar una fila por **cada** station del negocio con `printer_enabled=true` (ninguna si no hay comanderas activas).
- **FR-005**: MUST scopear todo por `business_id` (defensa cross-tenant en código, como el resto de actions del proyecto).

**Modelo de datos**

- **FR-006**: Migración `0021` (aditiva) crea `station_messages(id, business_id FK→businesses, station_id FK→stations ON DELETE CASCADE, body text, created_by FK→users, created_at timestamptz default now(), printed_at timestamptz null, print_failed_at timestamptz null)`, con índice parcial para el pull (`business_id where printed_at is null`) y RLS: members del business (select/insert), coherente con `comandas` / `stations`.

**Contrato print-agent (US1)**

- **FR-007**: `GET /api/print-agent?business_id=X` MUST devolver, además de `comandas`, un array **`messages`** con los avisos `printed_at IS NULL` del negocio cuyo sector tiene comandera activa: `{ message_id, station_id, station_name, printer_ip, printer_port, printer_enabled, body, created_at, created_by_name, content_escpos_b64, content_plain }` (los dos últimos = ticket AVISO ya renderizado server-side por 051). Campo **aditivo** → un agente viejo lo ignora. `body` pasa por `sanitizeTicketText` **antes** de renderizar.
- **FR-008**: `POST /api/print-agent` MUST aceptar `{ message_id, business_id, result:"ok"|"failed" }` como rama alternativa a `{ comanda_id, … }`: `"ok"` setea `station_messages.printed_at=now()`; `"failed"` setea `print_failed_at=now()`. Ownership por `business_id` (rechaza el aviso de otro negocio). No toca ninguna máquina de estados.
- **FR-009**: El **server** (spec 051) MUST renderizar el ticket **AVISO** (banner «AVISO» + sector + body en tamaño grande + hora + autor) vía un `buildAvisoContent` en `src/lib/print/ticket.ts`, y exponerlo en cada `message` como `content_escpos_b64` + `content_plain` (misma forma que las comandas de 051). El agente **relay** lo imprime tal cual en `message.printer_ip` y confirma con `POST {message_id, result}` — **sin lógica de formato ni cambios en el `.exe`**. Un agente pre-051 (sin soporte de relay/`messages`) no imprime avisos hasta migrar al relay (degradación documentada).

**UI (US1, US2)**

- **FR-010**: El tab **Comandas** de operación MUST ofrecer, a **admin y encargado** (`canEnviarAvisoComandera`), un botón **«Enviar aviso»** que abre un modal con: selector de sector (stations con `printer_enabled=true` + opción «Todos los sectores»), textarea de texto libre (contador, máx 200) y botón **Enviar**. Envío con **loading explícito** (no optimista) + toast de confirmación (*"Aviso enviado a Parrilla"*). El botón no se renderiza para el mozo.

### Key Entities

- **`station_messages`** (nueva, migración `0021`): el aviso libre. `station_id` = sector destino (su `printer_ip` es la comandera). `printed_at` / `print_failed_at` = flags de impresión (patrón spec 33/35). Sin relación con `orders` ni `comandas` — es un canal paralelo.
- **`stations`** (existe): provee `printer_ip` / `printer_port` / `printer_enabled` como destino. Sin cambios.

### Non-Goals (fuera de alcance)

- **Que el mozo mande avisos** — en fase 1 solo admin/encargado (mostrador). Sumar al mozo = ampliar el gate (`+ role === "mozo"`) — una línea.
- **Plantillas / botones rápidos** ("86", "Apurar mesa…") — solo texto libre en fase 1.
- **Historial de avisos enviados + estado impreso/falló en la UI** — fire-and-forget; el flag `print_failed_at` se persiste pero no se muestra en fase 1.
- **Notificación al admin si el aviso no imprime** y **reintento automático** — a diferencia de las comandas (specs 33/35), el aviso no reintenta ni notifica en fase 1.
- **Realtime / push instantáneo (SSE)** — sigue el poll del agente (piso ~1-2 s), igual que specs 33/35.
- **Mensajería bidireccional** (que cocina responda) — no hay pantalla de cocina; el canal es de ida, a papel.

## Success Criteria *(mandatory)*

- **SC-001**: El admin manda *"86 lomo"* a la Parrilla desde el tab Comandas y sale un ticket **AVISO** en la comandera de la Parrilla; el aviso queda impreso y no se reimprime.
- **SC-002**: El admin manda un aviso a «Todos los sectores» y sale una copia en cada comandera activa.
- **SC-003**: El mozo no ve el botón ni puede ejecutar la action; admin y encargado sí (gate). Todo scopeado por `business_id`. El body sale saneado (sin inyección ESC/POS).
- **SC-004**: `pnpm typecheck` + `pnpm test` en verde, con tests que blindan FR-001..FR-005 (action: gate, validación, un-sector vs todos, scope) y FR-007/FR-008 (GET expone `messages` con `content_escpos_b64`; POST confirma por `message_id`). Verify en vivo con **rol real** (admin o encargado) + print-agent relay (ticket AVISO impreso, **sin `.exe` nuevo** por 057).
