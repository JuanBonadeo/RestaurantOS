# 139 · El pedido lo confirma el local, y el cliente se entera

**Issue:** [#212](https://github.com/gachetponzellini/RestaurantOS-app/issues/212) ·
**Milestone:** Post-demo · Growth & hardening ·
**Estado:** 📝 spec aprobada (decisiones tomadas por Juan el 2026-08-31) — lista para implementar

**Input:** Juan, 2026-08-31: *"lo mismo que hicimos de que las reservas, de que
se tienen que confirmar, lo vamos a hacer con los pedidos ahora"*.

**Depende de**: [`047`](../047-auto-march-solo-si-pagado/spec.md) (el pedido
online no marcha solo), [`045`](../045-puente-email-transaccional/spec.md) (el
canal de avisos), y el patrón de [`131`](../131-confirmar-la-reserva/spec.md).

## Por qué

Con reservas hubo que construir el estado `pending` desde cero. En pedidos
**ya existe**: el online nace `pending`, no va a cocina hasta que alguien lo
confirma (`confirmarPedido` → `routeOrderToCocina`, spec 047), cancelar exige
motivo, y el board lo muestra en «Pendientes». El motor está.

Lo que falta es todo lo demás, y es exactamente lo que la 131 arregló del otro
lado:

**El seguimiento le miente al cliente.** En
[`order-tracking.tsx:63`](../../src/components/checkout/order-tracking.tsx),
`pending` y `confirmed` comparten paso, y ese paso dice **«El local confirmó tu
pedido»**. Un pedido que nadie del local abrió todavía le informa al cliente que
fue confirmado. Es la misma frase que sacamos de reservas, con las mismas
consecuencias: el cliente espera comida que nadie empezó.

**Y entre que pide y que el local marcha, no le llega nada.** El primer aviso
real es `preparing` (`notifyDeliveryStatusChange`). En el medio —que es justo
donde el pedido está esperando una decisión— silencio.

**Rechazar no existe como decisión.** Existe cancelar, que es lo mismo que se
usa cuando el pedido ya iba en camino. Para el cliente no es lo mismo «no
pudimos tomar tu pedido» que «tu pedido fue cancelado».

## Las decisiones

**D1 · El cliente no lee «confirmó» hasta que sea cierto.** `pending` y
`confirmed` dejan de compartir texto:

| estado | qué ve el cliente |
|---|---|
| `pending` | «Recibido» · *Esperando que el local lo confirme* |
| `confirmed` | «Confirmado» · *El local tomó tu pedido* |

**D2 · Acuse al pedir.** Cuando el pedido entra, sale un aviso por el canal del
negocio: *«Recibimos tu pedido #12. Te avisamos apenas el local lo confirme.»*
Se engancha donde ya está el mecanismo — `pending` se suma a los estados
notificables de delivery, con su plantilla editable como el resto.

**D3 · Rechazar es una decisión con nombre, sin estado nuevo.** El botón vive en
la tarjeta pendiente y pide motivo. Por dentro es `cancelled` (los estados de
`orders` están cableados al kanban, a la caja y a los reportes: sumar uno para
distinguir un caso de copy sería caro y frágil). Lo que cambia es **el aviso al
cliente**, que dice que no se lo pudieron tomar y por qué, en vez del genérico
de cancelación.

**D4 · Un pedido sin atender no vence: grita.** Decisión explícita de Juan, y es
la diferencia de fondo con una reserva. Una reserva es para más tarde y bloquea
un lugar, así que vencerla ordena. Un pedido es **gente esperando comida ahora**:
cancelárselo solo es peor que dejarlo esperar una respuesta. Entonces la tarjeta
pendiente muestra **cuánto lleva esperando** y, pasados unos minutos, se marca.

**D5 · Rechazar un pedido pagado devuelve la plata, automáticamente.** Juan
preguntó si se podía, y sí: `refundPayment()` ya existe —`POST
/v1/payments/{id}/refunds` con `X-Idempotency-Key`— y la usa la cancelación del
cliente. El rechazo del local toma el mismo camino y las mismas reglas: se
intenta el reembolso, el rechazo **igual procede** (el cliente no queda
colgado), y si MP falla el pedido queda `paid` + `cancelled` para resolverlo a
mano, que es como se ve hoy.

## Alcance

### Datos — migración `0056_aviso_de_pedido_recibido.sql`

`delivery_message_templates_status_check` acepta `pending`. Es la única
consecuencia de D2: el acuse es un estado notificable más, con su plantilla
editable en Ajustes › Notificaciones, como los otros cinco.

### Dominio

- **`delivery-templates.ts`:** `pending` entra en `DELIVERY_NOTIFY_STATUSES`,
  con su label («Recibido, sin confirmar») y su cuerpo por defecto.
  `shouldNotifyDeliveryStatus` ya excluye `dine_in`, así que el acuse sale sólo
  para lo online — que es lo que corresponde: en el salón el mozo está ahí.
- **`persist-order.ts`:** al crear un pedido online dispara
  `notifyDeliveryStatusChange(..., "pending")`. Best-effort, como el resto de
  los avisos: si el aviso falla, el pedido no.
- **`rechazar-pedido.ts` (nuevo):** la action del rechazo. Exige motivo, sólo
  opera sobre `pending`/`confirmed` de pedidos online, intenta el reembolso si
  estaba pagado (D5), cancela con `cancelled_reason` / `cancelled_at` /
  `cancelled_by` (los tres ejes de la spec 090) y manda el aviso de rechazo.
- **`delivery-templates.ts`:** cuerpo propio para el rechazo, distinto del de
  cancelación.

### UI

- **`order-tracking.tsx`:** los dos pasos de D1.
- **`orders-realtime-board.tsx`:** en la tarjeta pendiente, **cuánto lleva
  esperando**; pasados `ESPERA_QUE_MOLESTA_MIN` (10) se marca en ámbar. Y el
  botón **Rechazar**, al lado del que confirma.
- **Ajustes › Notificaciones:** la plantilla nueva aparece sola (la pantalla
  recorre `DELIVERY_NOTIFY_STATUSES`).

## Qué NO entra

- **Vencimiento automático.** Decisión de D4.
- **Un estado `rejected` en `orders`.** D3 explica por qué.
- **Reembolsos parciales.** El rechazo es del pedido entero.
- **Tocar el pedido de salón (`dine_in`).** Lo carga el mozo y va derecho a
  cocina: no hay nada que confirmar.
- **Bandeja aparte de pedidos.** El board ya tiene la columna «Pendientes»; dos
  lugares para lo mismo fue justo lo que sacamos de reservas.

## Escenarios de aceptación

1. **Dado** un pedido online recién hecho, **cuando** el cliente mira el
   seguimiento, **entonces** lee «Esperando que el local lo confirme» — nunca
   que fue confirmado.
2. **Dado** ese mismo pedido, **entonces** le llega el acuse por el canal del
   negocio con su número.
3. **Dado** que el local lo confirma, **entonces** el seguimiento pasa a
   «Confirmado» y sigue el flujo de siempre.
4. **Dado** un pedido pendiente, **cuando** el encargado toca «Rechazar»,
   **entonces** se le pide motivo y el cliente recibe un aviso que dice que no
   se lo pudieron tomar, con el motivo.
5. **Dado** un pedido pendiente **pagado**, **cuando** lo rechaza, **entonces**
   se dispara el reembolso por MP y el pedido queda `refunded`.
6. **Dado** que MP falla en ese reembolso, **entonces** el rechazo igual se
   completa y el pedido queda `paid` + `cancelled`, visible para resolverlo a
   mano.
7. **Dado** un pedido pendiente de hace 12 minutos, **entonces** su tarjeta
   muestra la espera y está marcada.
8. **Dado** un pedido de salón, **entonces** nada de esto aplica: no recibe
   acuse ni tiene botón de rechazo.

## Verificación

- Unit: los dos pasos de D1 según estado, el cuerpo del acuse y del rechazo, y
  el umbral de la espera que molesta.
- `pnpm typecheck` + tests en verde.
- En vivo en `demo`: hacer un pedido online, ver el seguimiento diciendo la
  verdad, confirmarlo desde el board, y rechazar otro con motivo.
