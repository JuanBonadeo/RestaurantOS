# Plan de implementación: Reservas flexibles — cupo real

**Spec**: [`spec.md`](./spec.md) · **Estado**: 📋 aprobado (decisiones de Juan, 2026-08-04) · **Creado**: 2026-08-04

## Technical Context

- **Módulo**: [`src/lib/reservations`](../../src/lib/reservations) — `flexible-availability.ts` (puro), `booking-actions.ts`, `availability-actions.ts`, `queries.ts`, `schema.ts`.
- **UI**: [`src/components/reservations/reservar-flow.tsx`](../../src/components/reservations/reservar-flow.tsx) (cliente) y [`src/components/admin/local/new-reservation-modal.tsx`](../../src/components/admin/local/new-reservation-modal.tsx) (encargado).
- **Sin migración**: `soft_capacity` ya existe (migración `0022`). Esta feature es 100 % lógica + UI.

## Decisiones de producto (Juan, 2026-08-04)

| Pregunta | Decisión |
|---|---|
| ¿Qué agota el cupo? | **Ambos** — cubiertos del servicio/zona **o** mesas libres; corta el que se agote primero. |
| ¿Quién puede pasarse? | **Sólo el encargado**, con aviso + confirmación explícita. Web y chatbot cortan duro. |
| ¿Última llegada configurable? | **No** — se reserva en toda la ventana del servicio. |

## Arquitectura: una sola regla, dos lecturas

La asimetría cliente/encargado vive en la **función pura**, no en cada canal:

```
computeFlexibleAvailability({ ..., enforceCapacity })
  ├─ enforceCapacity: false  (encargado)  → available salvo mesa puntual inválida   [HOY]
  └─ enforceCapacity: true   (cliente)    → además: false si sobre-cupo o sin mesas [NUEVO]
                                             reason: "sin-cupo" | "sin-mesas"
```

- `overCapacity` / `reservedCovers` / `softCapacity` se siguen devolviendo **siempre** (el encargado los necesita para el aviso aunque no bloqueen).
- `enforceCapacity` se deriva del canal en el server (`source !== "admin"`), nunca del input del cliente.
- El override del encargado es un flag del input (`allow_overbook`), aceptado **sólo** con `source: "admin"` + `canManage`.

### Tope por mesas (FR-003)

`freeTables` ya se calcula: mesas activas de la zona, con asientos ≥ party, libres ese servicio. El tope es `freeTables.length === 0`. Ojo: eso **no** ata la reserva genérica a una mesa — sólo verifica que el salón tenga dónde sentarla.

## Cambios por archivo

1. **`flexible-availability.ts`** (puro): `enforceCapacity` en params; razones nuevas `sin-cupo` / `sin-mesas` en `FlexibleUnavailableReason`; `available` false cuando corresponde. La mesa puntual inválida sigue teniendo prioridad en el `reason` (es más específica).
2. **`queries.ts`** — `getFlexibleAvailability`: pasar `enforceCapacity` (default `false`, para no cambiar callers existentes).
3. **`schema.ts`**: `FlexibleAvailabilityQuerySchema` suma `enforce_capacity` opcional (lo manda la web); `CreateFlexibleReservationInputSchema` suma `allow_overbook` opcional.
4. **`availability-actions.ts`** — `fetchFlexibleAvailability`: propagar el flag y devolver `reason` al cliente.
5. **`booking-actions.ts`** — `createFlexibleReservation`: tras resolver servicio + ventana, computar disponibilidad; rechazar si `source !== "admin"` y no hay lugar; si es admin y no hay lugar, exigir `allow_overbook`.
6. **`reservar-flow.tsx`**: `useEffect` que consulta `fetchFlexibleAvailability` con `enforce_capacity: true` al cambiar fecha/servicio/salón/personas; ocultar los horarios y mostrar el motivo cuando no hay lugar; bloquear el submit.
7. **`new-reservation-modal.tsx`**: extender el aviso a "no quedan mesas libres" y mandar `allow_overbook: true` cuando el encargado confirma sobre un servicio lleno.
8. **`chatbot-actions.ts`** (P2, US3): dispatch por `settings.mode`.

## Riesgos

- **Carrera de cubiertos**: sin lock, dos confirmaciones simultáneas pueden desbordar un party. Asumido en la spec (Edge Cases); la integridad de mesa la sigue dando el GIST.
- **Servicios ya sobre-vendidos** al activar el tope: dejan de ofrecerse al cliente; nada se rompe.
- **`golf-jcr` con cupo 100 por zona**: verificar con el encargado que 100 es el número real antes del go-live — el tope recién ahora tiene efecto.

## Testing

- TDD en `flexible-availability.test.ts`: sobre-cupo bloquea con `enforceCapacity`, no bloquea sin él; sin mesas libres bloquea aunque sobre cupo; cupo nulo no bloquea por cubiertos; mesa puntual inválida gana el `reason`.
- Tests de la acción de creación (rechazo web / override admin) donde ya hay cobertura de integración.
- `pnpm typecheck` + `pnpm test` + `pnpm build`; verify en vivo con rol real (encargado `golf-jcr`).
