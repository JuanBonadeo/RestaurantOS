# Plan de implementación: Reservas — modo flexible

**Spec**: [`spec.md`](./spec.md) · **Estado**: 📋 propuesto (approval gate) · **Creado**: 2026-07-28

> Este plan describe **el cómo**. No se implementa hasta OK de Juan + resolver los `[NEEDS CLARIFICATION]` del spec (al menos #1, #3, #5).

## Technical Context

- **Stack**: Next.js 15 (App Router), Server Actions, Supabase (Postgres + RLS), Zod, date-fns-tz (TZ `America/Argentina/Buenos_Aires`), Vitest.
- **Módulo**: [`src/lib/reservations`](../../src/lib/reservations) — `availability.ts` (puro), `assign-table.ts` (puro), `booking-actions.ts`, `chatbot-actions.ts`, `queries.ts`, `settings-actions.ts`, `schema.ts`, `types.ts`, `no-show.ts`.
- **Motor consolidado (spec 22)**: los 3 canales pasan por `getAvailability(businessId, timezone, { date, partySize, floorPlanId })` en `queries.ts`. **Este es el punto de dispatch por modo** — no duplicar ramas por canal.
- **Integridad actual**: `reservations_no_overlap` = `EXCLUDE USING gist (table_id WITH =, tstzrange(starts_at, ends_at) WITH &&) WHERE (status IN ('confirmed','seated') AND table_id IS NOT NULL)`.

## Principios (alineación CLAUDE.md)

- **Multi-tenant estricto**: `mode` scopeado por `business_id`; toda query y RLS mantienen el scoping. El default `estricto` preserva a todos los negocios.
- **TDD para lógica de negocio**: la disponibilidad flexible, la regla "una por mesa/servicio" y el cómputo de cubiertos son **funciones puras testeables** primero (rojo → verde).
- **Server actions para mutaciones**: validación Zod en el borde; permisos vía `can.ts`. Timezone AR explícita.
- **Sin cambios a mano en prod**: migración versionada (`0021`), RLS probada con rol real.

## Arquitectura: dispatch por modo

```
reservation_settings.mode ∈ { 'estricto', 'flexible' }  (default 'estricto')

getAvailability(businessId, tz, params)
  ├─ mode == 'estricto'  → computeAvailableSlots(...)      [HOY, sin tocar]
  └─ mode == 'flexible'  → computeFlexibleAvailability(...) [NUEVO]

createReservation* (web / admin / chatbot)
  ├─ estricto → pipeline actual (slots → pickTable → insert, ends_at = start + slot_duration)
  └─ flexible → insert directo (table_id opcional; ends_at = cierre del servicio; sin pickTable)
```

El `mode` se lee una vez y se pasa a las funciones puras. El estricto queda **literalmente igual** (misma función `computeAvailableSlots`, mismo `pickTable`, mismo path de insert).

## Modelo de datos + migración `0021`

### Integridad "una reserva por (mesa, servicio, fecha)" — **reusar el GIST**

Approach preferido (mínimo cambio): en flexible, **`ends_at = cierre del servicio`**. Entonces dos reservas sobre la misma mesa en el mismo servicio tienen rangos `[hora_a, cierre]` y `[hora_b, cierre]` que **siempre se solapan** → el constraint `reservations_no_overlap` **ya existente** las rechaza. Beneficios:

- Cero constraint nuevo; el mismo GIST sirve a los dos modos (estricto usa ventanas de 90 min, flexible usa `[hora, cierre]`).
- "No reservable de nuevo antes de la hora" sale gratis: `[20:00, cierre]` se solapa con `[21:00, cierre]`.
- Genéricas (`table_id IS NULL`) quedan fuera del `WHERE` → no bloquean nada. ✅
- Seat/walk-in operativo no inserta reserva → no colisiona. ✅

*Riesgo a validar*: reservas de mediodía y cena de la misma mesa/fecha **no** deben solaparse entre sí (son servicios distintos). Como sus `[start, cierre]` son disjuntos en el tiempo (mediodía cierra 16, cena abre 20), no se pisan. Si algún negocio tuviera servicios contiguos/solapados, cae el approach y se usa el plan B.

*Plan B* (si el GIST no alcanza): unique index parcial `(business_id, table_id, service, reservation_date) WHERE status IN ('confirmed','seated') AND table_id IS NOT NULL` + `service`/`reservation_date` como columnas generadas o explícitas.

### Cambios de schema (borrador — afinar con `[NEEDS CLARIFICATION: servicios-config]`)

```sql
-- 0021_reservations_modo_flexible.sql  (borrador)

-- 1) Modo por negocio
ALTER TABLE reservation_settings
  ADD COLUMN mode text NOT NULL DEFAULT 'estricto'
  CHECK (mode IN ('estricto','flexible'));

-- 2) Servicio + zona en la reserva (flexible; nullable para no romper estricto)
ALTER TABLE reservations
  ADD COLUMN service text,                        -- ej. 'mediodia' | 'cena' (o id de servicio configurable)
  ADD COLUMN floor_plan_id uuid REFERENCES floor_plans(id);  -- zona de las genéricas (las con-mesa la derivan de la mesa)

-- 3) Config de servicios + capacidad blanda (opción tabla; alternativa: JSONB en reservation_settings)
--    Servicios por día de semana con apertura/cierre + umbral de cubiertos por (servicio[, zona]).
CREATE TABLE reservation_services (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id),
  name text NOT NULL,                 -- 'Mediodía' | 'Cena'
  day_of_week int,                    -- 0..6, NULL = todos
  opens_at time NOT NULL,
  closes_at time NOT NULL,
  soft_capacity int,                  -- umbral advisory de cubiertos (NULL = sin umbral)
  floor_plan_id uuid REFERENCES floor_plans(id),  -- NULL = capacidad del servicio entero
  UNIQUE (business_id, name, day_of_week, floor_plan_id)
);
-- RLS: SELECT staff del negocio; write manager (canConfigureReservations). service-role para cron.
```

> Decisión pendiente (`servicios-config`): si mediodía/cena son **fijos** (enum) → alcanza con `service text` + apertura/cierre en `reservation_settings`. Si son **configurables** (como las hojas del libro) → tabla `reservation_services`. El Excel sugiere configurables (horarios distintos por día). Recomendación: **tabla**.

`pnpm db:types` tras la migración. Aplicar al cloud vía **MCP** (`apply_migration`) — ver [migraciones · aplicar al cloud](../../../../wiki/dominio/migraciones.md#aplicar-al-cloud-mcp).

## Lógica de dominio (pura, TDD)

- **`computeFlexibleAvailability(...)`** (nuevo, en `availability.ts`): dado servicio + fecha + (mesa? | zona?) + reservas vivas del servicio → devuelve disponibilidad. Para mesa puntual: "¿libre este servicio?" (no hay otra reserva viva sobre esa mesa/servicio). Para genérica: "¿el total de cubiertos < umbral?" → pero **advisory** (devuelve `{ disponible: true, warning?: 'sobre-capacidad' }`, nunca false por capacidad).
- **`serviceWindow(service, date, tz)`** (nuevo, puro): `[apertura, cierre]` en instantes UTC TZ-aware (reusa el patrón de `availabilityLookupWindow`). `ends_at` de la reserva = `cierre`.
- **`reservedCovers(reservations, { service, floorPlanId })`** (nuevo, puro): suma `party_size` de las vivas del servicio/zona → para el panel y el warning.
- **`isTableFreeForService(reservations, tableId, service, date)`** (nuevo, puro): pre-chequeo en cliente/acción; la **fuente de verdad** sigue siendo la base (GIST).
- El estricto (`computeAvailableSlots`, `pickTable`) **no se toca**.

## Server actions

- **`settings-actions.ts`**: exponer `mode` (y servicios/capacidad) en la config; gate `canConfigureReservations`.
- **`booking-actions.ts`**: `createReservation*` se vuelve mode-aware. En flexible: valida Zod (servicio requerido, mesa/hora opcionales), calcula `ends_at = cierre de servicio`, inserta **sin** `pickTable`, captura `23P01` → "La mesa ya está reservada en ese servicio". `updateReservationDetails` respeta la regla flexible.
- **`queries.ts`**: `getAvailability` bifurca por modo (único dispatch). Cargar `mode` + servicios del negocio.
- **`chatbot-actions.ts`**: las tools de disponibilidad (`check_reservation_availability`, `generate_reservation_link`) en flexible responden por **servicio** en vez de slots. *(Alcance del chatbot afinable; puede quedar en una fase posterior si golf-house arranca cargando reservas desde admin.)*
- **Sentar (US4)**: reutiliza `sentarReserva`/`openTable` existentes — sin cambios de contrato; sólo asegurar que acepta reservas genéricas (setea `table_id` al sentar).

## RLS / permisos

- `reservation_services`: RLS `is_business_staff` para SELECT, manager para write (patrón spec 22/26). `service-role`-only donde aplique.
- Reusar `can.ts`: `canConfigureReservations` (modo/servicios/capacidad), `canManageReservations`/`canSeatReservation` (operar). **No** duplicar asserts.
- `reservations`: RLS actual se mantiene (role-aware `is_business_staff`, spec 22). Las columnas nuevas no cambian las policies.

## No-show flexible (US5)

- `mark_overdue_reservations_no_show()` (SECURITY DEFINER, cron) hoy marca vencidas como `no_show`. En flexible: **no** auto-liberar sin criterio → o bien el predicado excluye negocios flexibles, o marca un estado "demorada/por-confirmar" no terminal. Depende de `[NEEDS CLARIFICATION: gracia-flexible]`. Predicado puro en `no-show.ts` (testeable), como hoy.

## Fasado (mapea a las prioridades del spec)

- **P1** — migración `0021` (mode + service + ends_at=cierre) · dispatch en `getAvailability` · `createReservation` flexible · `computeFlexibleAvailability`/`serviceWindow`/`isTableFreeForService` (TDD) · config de `mode`. **MVP: reserva flexible sin desalojo + estricto intacto.**
- **P2** — zonas (`floor_plan_id`) + capacidad blanda (`reservation_services.soft_capacity` + `reservedCovers` + warning) · sentar genéricas (US4) · panel con totales por servicio/zona.
- **P3** — confirmación + no-show relacional (US5) · ajustes de chatbot para flexible.
- **Fases futuras (specs aparte)**: recurrentes, combinables N:N, lista de espera, socio-entidad, eventos, atributos de mesa.

## Testing

- **Unit (TDD)**: `computeFlexibleAvailability`, `serviceWindow`, `reservedCovers`, `isTableFreeForService`, predicado no-show flexible. Co-ubicados `*.test.ts`.
- **Integración**: regla una-por-mesa/servicio contra la base (insert dobles → `23P01`); genérica sin mesa acepta; cancel libera. `*.integration.test.ts` (corren contra cloud, ver memoria de entornos).
- **No-regresión estricto**: los tests actuales de `availability.test.ts` / `assign-table.test.ts` deben seguir **verdes sin cambios**.
- **En vivo**: rol real (encargado golf-house) en un negocio flexible.

## Riesgos / decisiones técnicas abiertas

- **GIST reuse vs plan B** (integridad) — validar que servicios no se solapan en el tiempo. → decidir en implementación con datos reales de servicios.
- **`servicios-config`** enum vs tabla → recomendado tabla (`reservation_services`).
- **`starts_at` opcional** — hoy es `NOT NULL`. En flexible sin hora se guarda el inicio del servicio como `starts_at` (mantiene NOT NULL, orden y recordatorios) y se marca "sin hora exacta" con un flag o convención. Evita relajar el `NOT NULL`.
- **Chatbot** — si el ajuste de tools es grande, se difiere a fase posterior; golf-house puede arrancar cargando desde admin.
- **Cambio de modo con reservas vivas** — documentar que se cambia de modo sin reservas futuras pendientes.
