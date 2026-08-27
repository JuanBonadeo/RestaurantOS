# 127 · Los dos horarios del pedido

**Issue:** [#197](https://github.com/gachetponzellini/RestaurantOS-app/issues/197) ·
**Milestone:** Post-demo · Growth & hardening

**Input:** Juan, 2026-08-27, revisando pedidos: *"la parte de elegir el horario
y las notas quedó medio rara"*. Y, sobre los dos campos de nota: *"es que una
sería el horario de cocina, y el otro sería el horario del pedido"*.

## Por qué

El encargue telefónico no tiene dónde escribir su hora, así que se la escribe
encima a una nota. De ahí salen cuatro costuras que se cruzan justo en el paso
de datos de «Cargar pedido».

**1 · La hora vive en un campo de texto.** El selector real está apagado en la
carga a mano (spec 120, `MOSTRAR_PROGRAMADO = false`) pero sigue vivo en el
checkout del cliente. Por teléfono la única forma de decir «para las 21:30» es
escribirlo en «Nota para cocina», y el board después muestra esa nota como si
fuera el «para cuándo» ([`entrega.ts`](../../src/lib/orders/entrega.ts)). El
cartel dice una hora que el sistema no respeta: no hay `scheduled_at`, no cae en
«Próximos», la comanda sale a cocina en el acto.

**Por qué se llegó a esto:** el motor real pide ≥60 min (`SCHEDULED_MIN_LEAD_MIN`)
y sólo ofrece los chips de los servicios de reserva, cada 15 min. El encargue
típico —«en 40 minutos», «21:20»— no entra por esa puerta. La nota fue la
válvula de escape.

**2 · La nota le gana a la hora real.** `entregaLabel` devuelve la nota primero
y `scheduled_at` sólo si la nota está vacía. Un programado del cliente para las
21:00 al que el encargado le escribe «junto con la mesa 5» al marchar muestra
la nota donde debería decir la hora. La precedencia está al revés.

**3 · Los dos campos de nota prometen lo que no hacen.**

| Campo | Placeholder | Dónde imprime | El problema |
|---|---|---|---|
| «Nota para el pedido» (`delivery_notes`) | *sin cebolla, tocar timbre…* | **sólo** el ticket de control | «sin cebolla» no llega nunca a cocina |
| «Nota para cocina» (`kitchen_notes`) | *21:30, junto con la mesa 5…* | banner «ENTREGAR x» de la comanda | no es nota libre: «sin cebolla» sale como «ENTREGAR sin cebolla» |
| nota del ítem (`order_items.notes`) | — | comanda **y** control, «obs: …» | es la única que sirve para «sin cebolla», y no está en el paso de datos |

**4 · El mismo campo tiene dos nombres.** `kitchen_notes` es «Nota para cocina»
en la hoja de carga y «Entregar (sale en la comanda)» en el detalle
([`order-detail-sheet.tsx:653`](../../src/components/admin/order-detail-sheet.tsx)),
y se pide dos veces: al cargar y otra vez al marchar.

## Las decisiones (Juan, 2026-08-27)

**D1 · Hora libre para el staff, y el pedido queda programado de verdad.** Vuelve
«¿Para cuándo?» a la hoja, pero para el encargado es hora libre: sin chips y sin
el mínimo de 60 min. El cliente por la web sigue con chips y anticipación, igual
que hoy.

**D2 · Son dos horas, no dos notas.** La **hora del pedido** (cuándo lo retira o
lo recibe el cliente) y la **hora de cocina** (cuándo sale la comanda). Las dos
**a mano, siempre**: el sistema no las calcula ni las pre-llena. El lead del
negocio sigue gobernando sólo el canal web, donde no hay quien escriba la
segunda.

**D3 · El cron no marcha, avisa.** Nada sale solo a cocina por ahora. El cron
sigue corriendo —es lo único que sabe que llegó la hora— pero cambia de trabajo:
en vez de mandar la comanda, toca el timbre. La tarjeta de «Próximos» se
enciende y sale la notificación interna al encargado.

> ⚠️ **Corolario de D3, explícito:** hoy un pedido web **pagado y programado**
> marcha solo. Con esto deja de hacerlo y espera el gesto del encargado, igual
> que el impago. Es lo pedido, pero es un cambio de comportamiento del canal
> cliente, no sólo del teléfono. El aviso es lo que hace que sea seguro.

## Qué se construye

### FR-001 · La hora de cocina es una columna

`orders.kitchen_at timestamptz null` — cuándo tiene que salir la comanda. Hoy esa
hora es implícita (`scheduled_at − lead`) y en la práctica se tipea a mano dentro
de `kitchen_notes`.

Una función pura resuelve la ventana para todo el resto:

```
horaDeCocina(order, business) = order.kitchen_at ?? order.scheduled_at − lead(delivery_type)
```

El `??` es lo que deja el canal web intacto: sin `kitchen_at`, la ventana se
sigue calculando con `scheduled_march_lead_{pickup,delivery}_min`.

Migración **0050**: `orders.kitchen_at`, `orders.march_alerted_at` (idempotencia
del aviso, ver FR-004) y `businesses.scheduled_auto_march boolean not null
default false` (el interruptor de D3).

### FR-002 · La hoja pide las dos horas

Vuelve la sección «¿Para cuándo?» (se borra `MOSTRAR_PROGRAMADO`), con los chips
«Ahora» / «Programar» de siempre. Al programar, dos `input type="time"` — hora
del local, no del navegador:

| Campo | Qué es |
|---|---|
| **Hora del pedido** | cuándo lo retira o lo recibe el cliente |
| **Hora de cocina** | cuándo sale la comanda al sector |

Las dos son **obligatorias** al programar: es lo que significa «a mano,
siempre», y evita el fallback silencioso al lead. Coherencia mínima: hora de
cocina ≤ hora del pedido, las dos de hoy. La hora de cocina en el pasado se
acepta —es «ya»— y marcha al confirmar; la hora del pedido en el pasado no.

En **modo agregar** (spec 125) nada de esto aparece: las horas ya se decidieron.

### FR-003 · El server valida distinto según quién carga

`validateScheduledOrder` suma `source: "public" | "staff"`:

| Regla | `public` | `staff` |
|---|---|---|
| Sólo hoy | sí | sí |
| ≥ `SCHEDULED_MIN_LEAD_MIN` (60) | sí | **no** |
| La hora tiene que ser un chip de la grilla | sí | **no** |

`cargarPedidoStaff` pasa `source: "staff"`; el checkout público no cambia una
coma. Es el único punto donde las dos puertas se separan.

### FR-004 · El cron avisa en vez de marchar

`marchDueScheduledOrders` se parte en dos trabajos sobre la misma ventana
(`horaDeCocina <= now`, sin comandas, `pending` pagado o `confirmed`):

1. **Avisar** — `createNotification({ type: "pedido.hora_de_marchar", targetRole:
   "encargado" })` + su render en `notifications/view.ts`. Idempotente por
   `orders.march_alerted_at`: el tick corre cada 5 min y el timbre suena una vez.
2. **Marchar** — sólo si `businesses.scheduled_auto_march = true`. Default
   `false`, así que hoy no marcha nadie.

El endpoint, el `pg_cron` y `routeOrderToCocina` no se tocan. El interruptor es
una columna, no un deploy: prenderlo por negocio es un UPDATE.

### FR-005 · «Próximos» se enciende

- **Ordena por hora de cocina**, no por la del pedido: es la que exige el gesto.
- Muestra las dos: «Cocina 21:00 · Entrega 21:30».
- Tres estados, con un tick de reloj client-side (30 s):

| Cuándo | Cómo se ve |
|---|---|
| falta > 15 min | como hoy |
| faltan ≤ 15 min | ámbar, con la cuenta regresiva |
| pasada la hora | rojo, primera de la lista, «hace 6 min que tenía que marchar» |

### FR-006 · Las notas vuelven a ser notas

- `entregaLabel` deja de leer `kitchen_notes`: la hora sale de `scheduled_at` y
  nada más. Muere la costura 2.
- «Nota para el pedido» (`delivery_notes`): el placeholder deja de sugerir «sin
  cebolla» —que cocina no ve— y la ayuda lo dice entero: *va en el ticket de
  control, cocina no la ve*.
- «Nota para cocina» (`kitchen_notes`): el placeholder deja de sugerir «21:30».
  Queda para lo que siempre fue, la instrucción de armado («junto con la mesa
  5»). **Mismo nombre en la hoja y en el detalle.**
- Una línea de ayuda manda «sin cebolla» a donde corresponde: la nota del
  producto.

### FR-007 · El papel dice la hora

- **Comanda**: el banner pasa a `ENTREGAR 21:30` desde `scheduled_at`, con la
  nota libre debajo si la hay. Hoy el banner **es** la nota, y por eso la hora
  sólo llegaba a cocina si alguien la tipeaba.
- **Control** (el papel del repartidor): suma la hora del pedido.

## Qué NO cambia

- **El checkout del cliente.** Chips, anticipación y `scheduled_at` idénticos.
- **`routeOrderToCocina`** y la idempotencia de la marcha.
- **El lead por negocio.** Sigue gobernando la ventana del canal web.
- **El salón.** Una mesa no se programa (`dine_in` ya lo rechaza).
- **`pg_cron`.** El job sigue agendado y activo; cambia lo que hace el endpoint.

## Fases

| Fase | Qué entra |
|---|---|
| **A** | Migración 0050 · los dos campos en la hoja · FR-003 · `entregaLabel` · las notas · los papeles |
| **B** | El cron avisa: notificación, idempotencia, flag por negocio |
| **C** | «Próximos» encendido: orden, colores, cuenta regresiva |

## Verificación

- `pnpm typecheck` · `pnpm test` · `pnpm build` en verde.
- **En vivo, con rol real de encargado** (nunca service_role):
  1. Encargue telefónico a las 20:50 para las **21:20** (40 min: hoy lo rechaza
     el mínimo de 60) con cocina **21:00** → entra, cae en «Próximos», no marcha.
  2. A las 21:00 la tarjeta se pone en rojo y llega el aviso interno. Una sola
     vez, aunque el cron pase tres veces.
  3. «Marchar ahora» → la comanda sale con `ENTREGAR 21:20` arriba.
  4. Pedido web pagado y programado: **no** marcha solo; avisa y espera.
  5. `scheduled_auto_march = true` en el negocio → vuelve a marchar solo.
  6. Escribir sólo notas (sin horas) → el pedido es para ahora, como siempre.
  7. El detalle y la hoja llaman al mismo campo con el mismo nombre.
