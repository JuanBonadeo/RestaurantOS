# 133 · La hora en 24 h, y el «para cuándo» que dice la verdad

**Issue:** [#205](https://github.com/gachetponzellini/RestaurantOS-app/issues/205) ·
**Milestone:** Post-demo · Growth & hardening ·
**Estado:** implementada y verificada en vivo (2026-08-31)

**Input:** Juan, 2026-08-31, mirando el panel y el checkout:

- *"habría que sacar, del input de la hora de la pantalla del encargado, que sea
  formato 24hs, sin pm y am"*
- *"además hay datos que están mal: el para cuándo debería ser, si es delivery
  1 h – 1 h 30, y si es para llevar 40 min – 1 h"*

## Por qué

**La hora.** Los ocho campos de hora del panel usaban `<input type="time">`, y
Chrome **ignora** el `lang` —el del documento y el del propio input— para
elegir el formato: lo saca del locale del navegador. En una máquina en `en-US`
el encargado ve **06:00 PM** donde la lista de reservas, la comanda y el ticket
dicen **18:00**. Comprobado en vivo: con `lang="es"` en el `<html>`,
`lang="es-AR"` y `lang="en-GB"` en el input, los tres renderizan `06:00 PM`.

No es estético. A las dos de la mañana, leyendo rápido, un `06:00` con sufijo
chiquito se lee mal, y el resto del sistema habla en 24 h.

**El estimado.** El checkout tenía tres números escritos a mano y en desacuerdo
entre sí: «40 min» en envío, «15–20 min» en retiro y otra vez «15–20 min» en
«Lo antes posible» — que ni siquiera miraba qué había elegido el cliente. El
header del menú mostraba un cuarto («40 min»). Ninguno era cierto: un delivery
no sale en 40 minutos.

## Las decisiones

**D1 · Un campo de hora propio, en 24 h.** `TimeField24` reemplaza a los ocho
`type="time"`. Se escriben los cuatro dígitos y los dos puntos los pone el
campo: `2130` → `21:30`. Hacia afuera el valor sigue siendo `HH:MM`, así los
formularios que ya guardaban eso no cambian.

**D2 · El estimado es una ventana, no un número.** «1 h – 1 h 30», no «60 min».
Prometer un número exacto es prometer lo que ninguna cocina sostiene un sábado.
El **piso** lo pone el negocio; el **techo** sale de redondear al siguiente
medio horario en punto: 40 → 1 h, 60 → 1 h 30. Son los dos casos que pidió
Juan, y la regla sigue valiendo si el local cambia el número.

**D3 · El piso es config, no una constante.** `estimated_delivery_minutes` ya
existía; se suma `estimated_pickup_minutes`. Defaults del producto: **60** para
envío y **40** para retiro. Los dos se editan en Ajustes › Negocio.

**D4 · «Lo antes posible» sigue al modo elegido.** Si el cliente eligió retiro,
dice el estimado de retiro. Antes decía siempre lo mismo, sin mirar nada.

**D5 · El dato viejo se corrige.** `demo` y `golf-jcr` tenían 40 min de envío —
el número que Juan marcó como equivocado. La migración lo lleva a 60. Un
negocio que lo hubiera ajustado a otra cosa no se toca.

## Alcance

### Datos — migración `0055_estimado_de_entrega.sql`

- `businesses.estimated_pickup_minutes int` (null = default 40), con check
  5–240.
- Comentarios nuevos en las dos columnas: son el **piso**, el techo lo calcula
  la app.
- `update … set estimated_delivery_minutes = 60 where estimated_delivery_minutes = 40`.

### Dominio

- **`src/lib/hora-24.ts` (nuevo, puro):** `maskTime24` (cómo se ve lo que se
  tipea, con el caso «borrando» para que el separador no sea inborrable),
  `normalizeTime24` (qué es una hora válida) e `isTime24`.
- **`src/lib/orders/entrega-estimada.ts` (nuevo, puro):** `formatMinutos`,
  `ventanaEstimada`, `ventanaEstimadaLabel` y `minutosEstimados` con los
  defaults del producto.
- `business-actions.ts`: el perfil guarda también `estimated_pickup_minutes`.

### UI

- **`TimeField24`** (`components/ui/time-field-24.tsx`) reemplaza los ocho
  `type="time"`: editar reserva, las dos horas de cargar pedido, horarios de
  atención (×2), grilla de reservas y editor de servicios flexibles (×2).
- **Checkout**: los tres textos salen de la ventana, y «Lo antes posible» sigue
  al modo.
- **Header del menú**: la misma ventana, para que no prometa una cosa distinta
  del checkout.
- **Ajustes › Negocio**: «Estimado de envío» y «Estimado de retiro», cada uno
  diciendo qué ve el cliente.

## Qué NO entra

- **Un date-picker propio.** Sólo la hora; las fechas siguen con `type="date"`,
  que no tiene el problema del meridiano.
- **Estimados por franja horaria** (que el sábado a la noche prometa más que un
  martes al mediodía). Es otra conversación.
- **Tocar el `estimated_delivery_minutes` de un negocio que no estuviera en 40.**

## Escenarios de aceptación

1. **Dado** cualquier campo de hora del panel, **cuando** el encargado escribe
   `2130`, **entonces** queda `21:30` y en ningún caso aparece AM/PM.
2. **Dado** un campo con `21:` a medio escribir, **cuando** el encargado sale
   del campo, **entonces** vuelve a la última hora válida en vez de guardar
   basura.
3. **Dado** el checkout en envío, **entonces** dice **1 h – 1 h 30**; en retiro,
   **40 min – 1 h**.
4. **Dado** que el cliente cambia de envío a retiro, **entonces** «Lo antes
   posible» pasa a decir el estimado de retiro.
5. **Dado** un negocio con `estimated_pickup_minutes = 20`, **entonces** el
   retiro dice «20 min – 30 min».
6. **Dado** el header del menú, **entonces** muestra la misma ventana que el
   checkout.

## Verificación

`pnpm typecheck` en verde y **1839 tests unitarios** en verde, con 15 nuevos
entre `hora-24.test.ts` (máscara, borrado, «930» = 09:30, horas imposibles) y
`entrega-estimada.test.ts` (formato, techo del rango, defaults).

### Verificado en vivo (2026-08-31, `demo`)

| Escenario | Resultado |
|---|---|
| 1 · tipeo | en la grilla de horarios de reservas, escribí `2130` y quedó `21:30`; los campos son `inputMode="numeric"` con placeholder `HH:MM` |
| 3 · checkout | **Envío a domicilio · 1 h – 1 h 30** y **Retiro en el local · 40 min – 1 h** |
| 4 · «lo antes posible» | en envío decía `1 h – 1 h 30`; al pasar a retiro, `40 min – 1 h` (y «Listo en 40 min – 1 h») |
| 6 · header del menú | `1 h – 1 h 30` |

Para probar el checkout hubo que abrir el `demo` un lunes (día cerrado); la
franja se borró al terminar.
