# 131 · La reserva la confirma el local

**Issue:** [#203](https://github.com/gachetponzellini/RestaurantOS-app/issues/203) ·
**Milestone:** Post-demo · Growth & hardening ·
**Estado:** implementada y verificada en vivo (2026-08-31)

**Input:** Juan, 2026-08-31: *"habría que hacer, para evitar todo tipo de
confusión con las reservas, que la reserva la tengan que confirmar los
encargados, así nadie piensa que tiene una reserva cuando de verdad no la
tiene"*.

**Depende de**: [`059-reservas-modo-flexible`](../059-reservas-modo-flexible/spec.md)
(los dos motores conviven), [`077-reservas-cupo-real`](../077-reservas-cupo-real/spec.md)
(el cupo duro para el cliente), [`045`](../045-puente-email-transaccional/spec.md)
(el canal de avisos al cliente).

## Por qué

Hoy **toda** reserva nace `confirmed`, sin excepción y sin que nadie del local
la mire. Lo hacen los tres caminos de [`booking-actions.ts`](../../src/lib/reservations/booking-actions.ts):
`createReservationCommon` (dos inserts, `status: "confirmed"`),
`createFlexibleReservation` (uno más). El `source` cambia validaciones, nunca el
estado.

Y el sistema se lo dice al cliente con todas las letras:

- La pantalla final del flujo — [`reservar/confirmacion`](<../../src/app/[business_slug]/(public)/reservar/confirmacion/page.tsx>) —
  titula **«Reserva confirmada»** y remata *"Te esperamos en …"*.
- El mail que sale al instante (`reservationConfirmedEmail`) dice
  **«¡Tu reserva quedó confirmada!»**.
- «Mis reservas» la pinta con el pill **Confirmada**.

Lo único que hay parecido a una confirmación es el **opt-in del cliente** de la
spec 45 (`confirm_token` / `client_confirmed_at`): el recordatorio le pregunta
al cliente si va a venir. Es la pregunta inversa a la que falta.

El resultado es el que describe Juan: alguien reserva por la web un sábado a la
noche, se va con un mail que dice "confirmada", y en el local nadie decidió
nada. Si el servicio está lleno, si esa mesa la quiere el socio de siempre, si
ese día hay evento cerrado — el local se entera cuando la persona llega.

El agujero de cupo lo tapó la spec 077 (el cliente ya no reserva sobre un
servicio completo). Lo que queda es más de fondo: **la web no puede
comprometer al local**. Puede pedir.

## Las decisiones

**D1 · Las reservas de cliente nacen pendientes; las del local, confirmadas.**
`source` en `web` o `chatbot` → `pending`. `source: admin` → `confirmed`, sin
cambios: que el encargado la cargue *es* aceptarla. Vale para los dos motores
(estricto y flexible) y para todos los negocios — **no es un flag**. Una regla
sola, igual en todos lados, es justamente lo que saca la confusión.

**D2 · La pendiente toma el lugar.** Entra en `LIVE_RESERVATION_STATUSES` y en
el `EXCLUDE USING gist` de la tabla. Mientras espera respuesta descuenta
cubiertos y bloquea la mesa: nadie más puede quedarse con ese lugar y el
encargado decide sobre algo que existe. Si la rechaza o vence, el lugar se
libera solo.

**D3 · Tres estados nuevos, cada uno con su motivo.** `pending` (esperando al
local), `rejected` (el local dijo que no) y `expired` (nadie la miró a tiempo).
No se reusa `cancelled` — hoy significa *el cliente se arrepintió*, y mezclarlo
haría ilegible la lista del encargado y el aviso al cliente.

**D4 · Expira sola.** Una pendiente vence a los `approval_expiry_min` minutos
**antes del turno** (default **120**, configurable por negocio), con un piso
duro: nunca antes de **15 minutos** desde que se creó, así una reserva para
dentro de un rato no muere sin que nadie tenga chance de verla.

```
vence_en = max(starts_at − approval_expiry_min, created_at + 15 min)
```

El barrido lo hace el cron que ya corre cada 15 min para los recordatorios
(`/api/cron/reservation-reminders`, migración 0011): mismo tick, un barrido
más. No hace falta cron nuevo.

**D5 · El cliente nunca lee "confirmada" hasta que lo esté.** Pantalla final,
mail y «mis reservas» hablan de **solicitud** mientras está pendiente. El mail
de confirmación —el que ya existe— pasa a salir **cuando el encargado
confirma**, que es cuando es verdad.

**D6 · Rechazar pide un motivo (opcional) y se lo lleva el cliente.** Columna
`rejection_reason`. Sin motivo el aviso sale genérico; con motivo, el cliente
lee la razón. Es la diferencia entre "no pudimos tomarla" y "esa noche tenemos
un evento privado".

## Alcance

### Datos — migración `0053_reservas_pendientes.sql`

1. `reservations_status_check` acepta `pending`, `rejected`, `expired`.
2. `reservations_no_overlap` (GIST) pasa a `status in ('pending','confirmed','seated')`.
3. `reservations.rejection_reason text` (null).
4. `reservations.decided_at timestamptz` + `decided_by uuid` (quién resolvió; `null` = expiró sola).
5. `reservation_settings.approval_expiry_min int not null default 120 check (> 0)`.
6. `mark_overdue_reservations_no_show()` no cambia: sigue tocando sólo `confirmed`
   (una pendiente que llegó a la hora ya venció por D4, no es un "no vino").

### Dominio

- `types.ts`: `ReservationStatus` suma los tres y `LIVE_RESERVATION_STATUSES`
  suma `pending` — ese renglón es el que hace el hold de D2 en todo el motor
  (`availability`, `flexible-availability`, `assign-table`).
- `schema.ts`: `DecideReservationInputSchema` (decisión + motivo). El enum de
  `updateReservationStatus` **no** suma los nuevos: una solicitud se resuelve
  con `decideReservation` o la vence el cron, no cambiándole el estado a mano.
- **`pending-expiry.ts` (nuevo, puro + barrido):** `pendingExpiresAt(reservation, expiryMin)`
  e `isPendingExpired(...)` — función pura testeable, espejo de D4; más
  `expireStalePendingReservations(now)` que marca y avisa.
- `booking-actions.ts`:
  - `createReservationCommon` y `createFlexibleReservation` insertan
    `status: source === "admin" ? "confirmed" : "pending"`.
  - **`decideReservation(...)` (nueva action):** confirmar o rechazar. Sólo
    opera sobre `pending`, escribe `decided_at`/`decided_by` y dispara el aviso
    al cliente. Exige el permiso nuevo **`canDecideReservation`** (admin o
    encargado): el mozo gestiona reservas, pero decidir cuáles entran
    compromete el cupo y le dice que no a un cliente.
    No re-chequea cupo al confirmar: por D2 la pendiente ya venía ocupando el
    lugar, así que confirmarla no mueve la ocupación.
  - `sentarReserva` y `updateReservationDetails`: rechazan `pending` con
    mensaje claro ("Confirmá la reserva antes de sentarla / editarla").
  - `cancelOwnReservation`: el cliente **sí** puede cancelar una pendiente.
- `no-show.ts`: sin cambios (ya exige `confirmed`).
- `reminders.ts`: sin cambios (ya filtra `confirmed`) — una pendiente no recibe
  recordatorio.

### Avisos

- **Internos (spec 27):** `reserva.nueva` pasa a decir "pendiente de
  confirmar" en `view.ts` cuando el payload trae `pendiente: true`. El
  encargado ya la recibe hoy; lo que cambia es que ahora es accionable.
- **Al cliente (spec 45):** tres plantillas nuevas en
  `customer-email-templates.ts` — `reservationRequestedEmail` (recibimos tu
  pedido), `reservationRejectedEmail` (con motivo si lo hay) y
  `reservationExpiredEmail`. `reservationConfirmedEmail` se conserva tal cual,
  cambia **cuándo** se manda: al confirmar, no al crear.

### UI

**Encargado** — [`admin-day-list.tsx`](../../src/components/reservations/admin-day-list.tsx):

- Tab **«Pendientes»** primera, con el contador al lado. Es la bandeja.
- Fila pendiente: dos botones, **Confirmar** y **Rechazar** (el segundo abre el
  diálogo de confirmación que ya existe, con campo de motivo opcional).
- `STATUS_LABEL` / `DOT` / `RING` para los tres estados nuevos
  (pendiente ámbar, rechazada rosa, vencida zinc).
- `day-stats.ts`: las pendientes cuentan aparte de las confirmadas en los KPI —
  «Reservas» y «Comensales» las incluyen (toman el lugar), y el sub-label suma
  `N pend`.

**Cliente** — flujo público:

- `reservar/confirmacion`: con `pending`, eyebrow **«Solicitud enviada»**,
  headline con día y hora, y bajada *"Falta que el local la confirme. Te
  avisamos apenas la respondan."* Con `rejected` / `expired`, el mensaje del
  caso y el motivo si está.
- `my-reservations-screen.tsx`: pill **«Pendiente»**; sigue siendo cancelable.
- `reservar-flow.tsx`: el CTA pasa de **«Confirmar reserva»** a **«Pedir
  reserva»** (y «Ingresar y pedir reserva» sin sesión). El cliente pide;
  confirma el local.

## Qué NO entra

- **Lista de espera.** Rechazar es rechazar; el overflow sigue fuera de alcance
  (era así en 059 y en 077).
- **Confirmación automática por reglas** (ej. "auto-confirmar si hay lugar
  y el party es chico"). Sería volver a que el local no mire.
- **Aviso por WhatsApp** de la decisión: sale por el canal que el negocio ya
  tenga configurado (`dispatchCustomerMessage`); los que están en `whatsapp`
  hoy no reciben avisos de reserva y esto no lo cambia.
- **Migrar reservas viejas.** Las `confirmed` que ya existen quedan como están.
- **Editar una solicitud antes de decidirla.** Primero se decide, después se
  ajusta: `updateReservationDetails` (spec 097) sigue pidiendo `confirmed`.

## Escenarios de aceptación

1. **Dado** un cliente en `/reservar` con lugar disponible, **cuando** confirma
   sus datos, **entonces** la reserva queda `pending`, la pantalla dice
   «Solicitud enviada» y el mail dice que recibimos el pedido — nunca
   "confirmada".
2. **Dado** que entró una pendiente, **cuando** el encargado abre la lista del
   día, **entonces** la ve en la tab «Pendientes» con el contador, y puede
   **Confirmar** o **Rechazar**.
3. **Dado** que el encargado confirma, **entonces** la reserva pasa a
   `confirmed`, el cliente recibe el mail de confirmación y la fila muestra
   «Sentar» como cualquier confirmada.
4. **Dado** que el encargado rechaza con motivo, **entonces** la reserva queda
   `rejected`, el lugar se libera (deja de contar cupo y de bloquear la mesa) y
   el cliente recibe el aviso con el motivo.
5. **Dado** que una pendiente está a menos de `approval_expiry_min` del turno y
   nadie la tocó, **cuando** corre el cron, **entonces** queda `expired`, el
   lugar se libera y el cliente recibe el aviso.
6. **Dado** que la pendiente se creó hace 5 minutos para dentro de una hora,
   **cuando** corre el cron, **entonces** **no** expira (piso de 15 min).
7. **Dado** un servicio con 4 cubiertos de cupo y una pendiente de 4, **cuando**
   otro cliente intenta reservar, **entonces** no hay lugar (la pendiente tomó
   el lugar).
8. **Dado** que el encargado carga una reserva desde el admin, **entonces**
   nace `confirmed` — el flujo del mostrador no cambia en nada.
9. **Dado** un cliente con una reserva `pending`, **cuando** la cancela desde
   «mis reservas», **entonces** queda `cancelled` y el lugar se libera.
10. **Dado** una reserva `pending`, **cuando** el encargado intenta sentarla,
    **entonces** el server la rechaza pidiendo que la confirme primero.

## Verificación

- `pnpm typecheck` en verde; **1810 tests unitarios** en verde (los
  `*.integration.test.ts` piden el stack local levantado).
- Unit: `pending-expiry.test.ts` (D4, incluido el piso), `day-stats.test.ts`
  (pendientes en los KPI), `availability` / `flexible-availability` (la
  pendiente ocupa).
- Integración: `booking-permissions.integration.test.ts` (el mozo no decide),
  alta web → `pending`, `decideReservation` sobre no-pendiente → error.
### Verificado en vivo (2026-08-31, `demo`, magic link como Sofía · encargada)

| Escenario | Resultado |
|---|---|
| 1 · alta desde `/demo/reservar` | quedó `pending`; la pantalla dice **«Solicitud enviada — Falta que Restaurante Demo la confirme»** |
| 2 · bandeja | tab **«Pendientes (1)»**, pill ámbar, KPI «1 pend», botones Confirmar/Rechazar |
| 3 · confirmar | pasa a `confirmed`, aparece «Sentar», la tab de pendientes desaparece |
| 4 · rechazar con motivo | `rejected` + `rejection_reason`, `decided_at`/`decided_by` cargados, el lugar se libera |
| 5 · vencimiento | el tick del cron devolvió `{considered: 2, expired: 1}`; la vieja quedó `expired` con `decided_by` null |
| 6 · piso de 15 min | la recién creada **no** venció |
| 9 · cancelar pendiente | el cliente la canceló desde «mis reservas» |
| — · hold | la solicitud tomó la mesa R74 apenas entró |

Los datos de prueba del `demo` se borraron al terminar.
