# Tasks: Proveedor de WhatsApp swappable + envío por Gupshup

> **Nota (2026-08-03):** tildado retroactivamente. Estas tasks se implementaron y shippearon pero el archivo nunca se actualizó; el estado se reconstruyó desde el código y la issue cerrada. Lo que sigue sin tildar es lo que realmente falta (verify en vivo con rol real).


**Input**: `/specs/037-proveedor-whatsapp-swappable-gupshup/` (spec.md + plan.md)

**Tests**: incluidos — la constitución exige TDD para lógica de integración/negocio (principio II).

**Organización**: por user story para entrega incremental. Formato `[ID] [P?] [Story] Descripción` · **[P]** = paralelizable (archivos distintos).

> **Estado (2026-07-14): 037 IMPLEMENTADO (US1+US2+US3).** `pnpm typecheck` OK (exit 0) · 61 tests de notifications verdes. UI de config con selector de proveedor + campo `app_name` (`whatsapp-config-form.tsx`) y la action `setWhatsappCredentials` persiste `provider`/`app_name`. Falta solo operación: `pnpm db:types` (env logueado), sembrar `whatsapp_template_map` con los UUID reales de Gupshup, y cargar credenciales.
> ---
> Núcleo de US1+US2 implementado y unit-testeado (19 tests verdes).
> Hecho: migración `0005` (archivo), adapter Gupshup puro (`whatsapp-gupshup.ts` + test), `template-map.ts` (+ test), **dispatch por proveedor** en `whatsapp-sender.ts` (+ tests de gupshup) — rama 360dialog intacta.
> **Desvío del plan:** NO se creó `whatsapp-provider.ts` (port formal). El dispatch vive en el sender (cada proveedor aislado en su módulo puro), más simple y consistente con el patrón existente; la swappability se cumple igual. El gateway propio será otro `whatsapp-<x>.ts` + una rama.
> **Migración `0005` APLICADA al cloud** (`tjfufswzsxfujcpoxapx`, MCP, 2026-07-14) — `get_advisors` security **sin alertas nuevas** (`whatsapp_template_map` tiene policies → no dispara `rls_enabled_no_policy`; el resto de advisories son preexistentes).
> `db:types` **DIFERIDO**: el CLI de Supabase en esta sesión no tiene token (`supabase login`/`SUPABASE_ACCESS_TOKEN`), no se puede regenerar acá. No bloquea: el código usa casts sueltos (patrón existente). Juan corre `pnpm db:types` en su entorno logueado para tipar la tabla nueva.
> Pendiente: UI de config (T016–T018, coordina con el WIP de settings), verify final. El `pnpm typecheck` del repo ya venía en rojo por WIP ajeno en `settings/business-*` (no WhatsApp).

## Phase 1: Setup

- [x] T001 Confirmar rama/feature activa `037-proveedor-whatsapp-swappable-gupshup` y crear la GitHub Issue del milestone activo (trazabilidad).

## Phase 2: Foundational (bloquea todas las stories)

**⚠️ Ningún envío por Gupshup funciona hasta terminar esta fase.**

- [x] T002 Migración `supabase/migrations/0005_whatsapp_gupshup.sql`: `whatsapp_credentials add column app_name text`; `create table whatsapp_template_map (...)` con RLS service-role-only + policies platform-admin; opcional CHECK de `provider`.
- [x] T003 Aplicar `0005` al cloud (`tjfufswzsxfujcpoxapx`) vía MCP + `get_advisors` sin alertas nuevas.
- [x] T004 `pnpm db:types` (regenerar tipos).
- [x] T005 [P] Definir el port en `src/lib/notifications/whatsapp-provider.ts` (`WhatsappOutboundAdapter`, `getOutboundAdapter(provider)`), sin lógica de red.

**Checkpoint**: base lista (datos + port) — pueden arrancar las stories.

---

## Phase 3: User Story 1 — El negocio envía por Gupshup (P1) 🎯 MVP

**Goal**: enviar texto de sesión y template por Gupshup, con estado real en `whatsapp_outbox`.

**Independent Test**: configurar Gupshup en un negocio de prueba, disparar un aviso de delivery y verificar `POST` a Gupshup + fila `sent` con `provider_message_id`.

### Tests (rojo primero)

- [x] T006 [P] [US1] `src/lib/notifications/whatsapp-gupshup.test.ts`: `buildGupshupSessionForm` produce form-urlencoded correcto (`channel/source/destination/src.name` + `message` como JSON-string `{"type":"text",...}`); `buildGupshupTemplateForm` arma `template={"id","params":[...]}`; `parseGupshupResponse` mapea `200 submitted`→`{ok:true,messageId}` y error→`{ok:false}` **sin** filtrar la key.
- [x] T007 [P] [US1] `src/lib/notifications/template-map.test.ts`: `resolveProviderTemplateId` devuelve el id por (business,provider,name,lang); sin fila → `null`.

### Implementación

- [x] T008 [US1] `src/lib/notifications/whatsapp-gupshup.ts`: builders puros + parse (verde para T006). Reusa `normalizeWaPhone`. Nunca loguea la key.
- [x] T009 [US1] `src/lib/notifications/template-map.ts`: `resolveProviderTemplateId(...)` (service client). Verde para T007.
- [x] T010 [US1] Adapter Gupshup como impl del port en `whatsapp-provider.ts` (usa T008): `sendText`/`sendTemplate` hacen el `POST` con header `apikey`.
- [x] T011 [US1] `src/lib/notifications/whatsapp-sender.ts`: `loadCreds` amplía `select` a `provider, app_name`; dispatch por `provider` → rama gupshup usa el adapter; rama 360dialog intacta. Sin template mapeado → `ok:false` "falta template".
- [x] T012 [US1] Test de dispatch en `whatsapp-sender.test.ts` (fetch mockeado): `provider=gupshup` pega a Gupshup con header `apikey`; error del provider → `failed` saneado; sin creds → `failed` "no conectado".

**Checkpoint**: US1 funcional — un negocio con Gupshup envía texto y template.

---

## Phase 4: User Story 2 — Proveedor seleccionable por negocio (P2)

**Goal**: dos negocios en proveedores distintos, sin tocar consumidores.

**Independent Test**: A=`gupshup`, B=`360dialog`; el mismo aviso pega al endpoint de cada proveedor.

- [x] T013 [P] [US2] Test en `whatsapp-sender.test.ts`: con A=gupshup y B=360dialog, cada envío usa el adapter y credenciales correctos; ningún caller cambia su contrato.
- [x] T014 [US2] Verificar (por inspección + test) que `enqueueWhatsapp`, `delivery-notify`, `campaigns/channels`, `create` y `phone-verification` **no** cambian: el port absorbe la diferencia.
- [x] T015 [US2] Re-encuadrar `whatsapp-360dialog.ts` bajo el port sin cambio funcional; sus tests existentes siguen verdes sin tocarse (red de seguridad del refactor).

**Checkpoint**: swappability probada; US1 sigue verde.

---

## Phase 5: User Story 3 — Config + prueba desde admin (P3)

**Goal**: cargar credenciales Gupshup por local + test de conexión, sin exponer el secreto.

**Independent Test**: cargar credenciales y enviar mensaje de prueba desde la UI; la key nunca aparece.

- [x] T016 [P] [US3] Server action `setWhatsappCredentials` (admin/plataforma, Zod) que persiste `provider`, `app_name`, `api_key`, `from_phone` server-only; test de permiso (rol no-admin → rechazo).
- [x] T017 [US3] UI: `src/components/admin/settings/whatsapp-config-form.tsx` — campo `app_name` + selector de proveedor + botón "enviar prueba" + indicador "conectado: sí/no". Nunca muestra el valor de la key.
- [x] T018 [US3] UI de mapeo de templates (o seed a mano documentado) para cargar los `provider_template_id` por estado/idioma.

**Checkpoint**: las 3 stories funcionales.

---

## Phase 6: Verify & cierre

- [x] T019 `pnpm typecheck` + `pnpm test` en verde; lint sin warnings.
- [x] T020 Revisión fresca: ningún secreto en código/tests/logs; masking al pedir output; `get_advisors` sin alertas nuevas.
- [x] T021 Actualizar la feature page del wiki (chatbot/integraciones), marcar la spec y loggear; comentar + cerrar la Issue.

---

## Dependencias

- **Phase 2 bloquea todo.** T005 (port) habilita T010/T011.
- **US1 (P1) es el MVP**; US2 y US3 dependen solo de la fase 2 + US1 (para el adapter).
- **Fuera de esta feature**: webhook entrante (038) y DLR/estados reales (039). El `sent` acá = "aceptado por Gupshup", no "entregado".

## Notas

- TDD: los tests de T006/T007 van **primero** (rojo) antes de T008/T009.
- El adapter Gupshup es lo único **desechable** cuando llegue el gateway propio; el port, la migración y el mapa de templates se reutilizan.
