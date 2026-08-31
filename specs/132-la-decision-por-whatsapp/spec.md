# 132 · La solicitud se edita antes de decidirla, y la decisión sale por WhatsApp

**Issue:** [#204](https://github.com/gachetponzellini/RestaurantOS-app/issues/204) ·
**Milestone:** Post-demo · Growth & hardening ·
**Estado:** implementada y verificada en vivo (2026-08-31)

**Input:** Juan, 2026-08-31: *"bueno implementa eso ahora"*, sobre los dos
pendientes que la [spec 131](../131-confirmar-la-reserva/spec.md) dejó afuera.

**Depende de**: [`131-confirmar-la-reserva`](../131-confirmar-la-reserva/spec.md)
(el estado `pending` y la bandeja del encargado), [`097-editar-reserva`](../097-editar-reserva/spec.md)
(el editor mode-aware), `045` (el puente de avisos al cliente).

## Por qué

**Editar.** La 131 dejó `updateReservationDetails` pidiendo `confirmed`, con el
argumento de "primero se decide, después se ajusta". En el mostrador no es así:
*«te la tomo, pero a las 21:30 y en el salón 2»* es **una** decisión, no dos
pasos. Hoy el encargado tiene que confirmar algo que todavía no le cierra —
mandándole al cliente el mail de «reserva confirmada» con la hora equivocada—
para recién después corregirla. La secuencia obliga a mentir.

**WhatsApp.** Los cuatro avisos de la 131 salen sólo por email:
[`reservation-notify.ts`](../../src/lib/notifications/reservation-notify.ts)
pasa `whatsapp: null` en los cuatro despachos. En un negocio con
`customer_channel = "whatsapp"` — el caso real del piloto — eso significa que
el cliente **no recibe nada**: ni el acuse, ni la confirmación, ni el rechazo,
ni el vencimiento. Toda la 131 depende de que el cliente se entere, y en el
canal que el cliente efectivamente usa hoy no se entera.

No es un olvido de la 131: era deuda de la spec 45, que dejó los avisos de
reserva sin template de WhatsApp a propósito para no llenar `whatsapp_outbox`
de filas `failed`. Lo que faltaba es la config, y es la misma que ya existe
para delivery.

## Las decisiones

**D1 · La solicitud se edita como cualquier reserva viva.**
`updateReservationDetails` acepta `pending` además de `confirmed`. Todo lo
demás de la spec 097 vale igual: las ventanas mode-aware, el cupo excluyendo la
propia reserva, el overbook con confirmación. En la bandeja, la fila pendiente
suma **Editar** al lado de Confirmar y Rechazar.

**D2 · Editar no decide.** Ajustar una solicitud la deja `pending`: el
encargado corrige y después decide, o decide directamente. No hay
"confirmar-editando" implícito, porque el aviso al cliente sale en la decisión
y tiene que salir una sola vez, con los datos finales.

**D3 · Los cuatro avisos salen también por WhatsApp**, por el canal que el
negocio ya tiene configurado (`whatsapp` / `email` / `both`), con el mismo
mecanismo que delivery: cuerpo editable por negocio + **nombre del template
aprobado en Meta**, porque un aviso proactivo fuera de la ventana de 24 h no
acepta texto libre.

**D4 · Sin template configurado no se intenta el envío.** Es la regla que la
spec 45 ya fijó y que esta spec respeta: si el negocio no cargó el
`template_name` de ese evento, el despacho de WhatsApp se omite en vez de
generar una fila `failed`. El email sigue saliendo. Nadie queda peor que hoy.

**D5 · La plantilla se puede apagar por evento.** `enabled` por fila: un local
puede querer avisar la confirmación y el rechazo pero no el acuse. Apagarla
apaga **el evento entero** (los dos canales), que es como se lee la casilla
«Enviar este aviso» en la pantalla que ya existe para delivery.

## Alcance

### Datos — migración `0054_plantillas_de_reserva.sql`

Tabla `reservation_message_templates`, espejo de `delivery_message_templates`:

| columna | |
|---|---|
| `business_id` | FK, cascade |
| `event` | `requested` · `confirmed` · `rejected` · `expired` (check) |
| `body` | texto con placeholders |
| `enabled` | bool, default true |
| `template_name` | nombre del template de Meta (null = no se manda por WhatsApp) |
| `template_lang` | default `es_AR` |

Unique `(business_id, event)` para el upsert. RLS: lectura/escritura del staff
del negocio (`is_business_staff`), como su gemela de delivery.

### Dominio

- **`reservation-templates.ts` (nuevo, puro):** `RESERVATION_NOTIFY_EVENTS`,
  labels, `DEFAULT_RESERVATION_TEMPLATES` y `renderReservationBody(...)` con
  placeholders `{cliente}` `{negocio}` `{fecha}` `{hora}` `{personas}`
  `{motivo}`. Espejo de `delivery-templates.ts`, testeable sin DB.
- **`reservation-notify.ts`:** los cuatro notifiers leen la fila del evento,
  arman el cuerpo con la lógica pura y pasan
  `whatsapp: { body, template }` cuando hay teléfono **y** `template_name`.
  Params posicionales del template: `{{1}}` = cliente, `{{2}}` = cuándo.
  `enabled: false` corta el evento entero.
- **`actions.ts`:** `listReservationTemplates` / `setReservationTemplate`
  (admin/encargado, `canManageNotificationPrefs`), calcadas de las de delivery.
- **`booking-actions.ts`:** `updateReservationDetails` acepta `pending`.

### UI

- **`reservation-templates-form.tsx`** en
  `/admin/configuracion/notificaciones`, debajo del de delivery: cuerpo,
  casilla de enviar y nombre del template por evento.
- **`admin-day-list.tsx`:** la fila pendiente suma **Editar** (mismo panel
  inline que la confirmada).

## Qué NO entra

- **Avisar al cliente que le editaron la reserva.** Sigue pendiente de la 097 y
  es una decisión aparte (qué se avisa y cuándo). Acá el aviso sale en la
  decisión.
- **Recordatorio de reserva por WhatsApp.** Es de la spec 45; su template
  necesita el link de confirmación de asistencia y merece su propia fila.
- **Alta automática de los templates en Meta.** El nombre se carga a mano, como
  en delivery.

## Escenarios de aceptación

1. **Dado** una solicitud pendiente, **cuando** el encargado toca «Editar»,
   **entonces** puede cambiar mesa, comensales y horario igual que en una
   confirmada, y la reserva **sigue** `pending`.
2. **Dado** que la editó, **cuando** después la confirma, **entonces** el aviso
   al cliente sale una sola vez y con los datos **nuevos**.
3. **Dado** un negocio en canal `whatsapp` con `template_name` cargado para
   `confirmed`, **cuando** el encargado confirma, **entonces** se encola el
   WhatsApp con el cuerpo renderizado y el template.
4. **Dado** el mismo negocio **sin** `template_name` para ese evento,
   **entonces** no se intenta el WhatsApp (no hay fila `failed`) y el email
   sigue saliendo si el canal lo incluye.
5. **Dado** un rechazo con motivo, **entonces** el cuerpo del WhatsApp incluye
   el motivo; sin motivo, la frase no queda colgada.
6. **Dado** un evento con `enabled: false`, **entonces** no sale por ningún
   canal.
7. **Dado** un negocio que nunca configuró plantillas, **entonces** los cuerpos
   por defecto se usan igual (y el email sale como hasta ahora).

## Verificación

`pnpm typecheck` en verde y **1824 tests unitarios** en verde, con 14 nuevos
sobre `reservation-templates.ts` (defaults sin placeholders colgados, motivo
ausente, cuerpo propio del negocio, evento apagado, y las tres respuestas de
`reservationWhatsappPayload`).

### Verificado en vivo (2026-08-31, `demo` — que ya estaba en canal `whatsapp`)

| Escenario | Resultado |
|---|---|
| 1 · editar la solicitud | como Sofía (encargada): 2p 18:00 → **4p, 21:30, mesa R01**, y quedó `pending` (`decided_at` null) |
| 2 · confirmar después de editar | el aviso salió una sola vez y con los datos nuevos |
| 3 · WhatsApp con template | como admin, cargué `reserva_confirmada` desde la pantalla nueva; al confirmar se encoló: *"¡Hola Prueba 132! ✅ Tu reserva en Restaurante Demo quedó confirmada para el 02/09 a las 21:30, para 4 personas. ¡Te esperamos!"* (el envío falla con «WhatsApp no conectado», que es lo esperado en el demo) |
| 4 · sin template | el rechazo —evento sin `template_name`— **no** dejó ninguna fila en `whatsapp_outbox` |

Los datos de prueba y la plantilla cargada en el `demo` se borraron al terminar.
