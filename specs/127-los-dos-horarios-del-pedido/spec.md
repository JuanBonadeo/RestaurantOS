# 127 · Los dos horarios del pedido

**Issue:** [#197](https://github.com/gachetponzellini/RestaurantOS-app/issues/197) ·
**Milestone:** Post-demo · Growth & hardening

**Input:** Juan, 2026-08-27, revisando pedidos:

- *"la parte de elegir el horario y las notas quedó medio rara"*
- *"una sería el horario de cocina, y el otro sería el horario del pedido"*
- *"que el horario de cocina se informe en todas las comandas, como una nota,
  sólo en las comandas para pedidos"*
- *"así como está ahora funciona bien para los cocineros y para Ale que se
  encarga de los pedidos, pero para el encargado queda raro, y para nuestro
  sistema también"*
- **"que se auto avance el pedido 40 minutos antes, así le quitamos trabajo al
  encargado"**

## Por qué

La cuarta cita es el diagnóstico y la quinta es la solución. **El papel no está
roto** — cocina lee «ENTREGAR 21:30» arriba del ticket y se organiza; Ale trabaja
con eso. Lo que está roto es de dónde sale ese texto: el encargue telefónico **no
tiene dónde escribir su hora**, así que se la escribe encima a una nota. Y como
el sistema no entiende esa hora, tampoco puede hacer nada con ella — ni ordenar,
ni mostrarla, ni **marchar el pedido a tiempo**.

Las cuatro costuras, todas del lado del encargado y del sistema:

**1 · La hora vive en un campo de texto.** El selector real está apagado en la
carga a mano (spec 120) pero sigue vivo en el checkout del cliente. Por teléfono
la única forma de decir «21:30» es «Nota para cocina».

**2 · El board muestra la nota como si fuera la hora.** `entregaLabel` devuelve
`kitchen_notes` primero y `scheduled_at` sólo si la nota está vacía
([`entrega.ts`](../../src/lib/orders/entrega.ts), #192). La precedencia está al
revés: un programado del cliente con nota muestra la nota en vez de su hora real.

**3 · Los dos campos de nota prometen lo que no hacen.**

| Campo | Placeholder | Dónde imprime | El problema |
|---|---|---|---|
| «Nota para el pedido» (`delivery_notes`) | *sin cebolla, tocar timbre…* | **sólo** el ticket de control | «sin cebolla» no llega nunca a cocina |
| «Nota para cocina» (`kitchen_notes`) | *21:30, junto con la mesa 5…* | banner «ENTREGAR x» de la comanda | no es nota libre: es el renglón del **cuándo** |
| nota del ítem (`order_items.notes`) | — | comanda **y** control, «obs: …» | es la única que sirve para «sin cebolla», y no está en ese paso |

**4 · El mismo campo tiene dos nombres.** `kitchen_notes` es «Nota para cocina»
en la hoja y «Entregar (sale en la comanda)» en el detalle
([`order-detail-sheet.tsx:653`](../../src/components/admin/order-detail-sheet.tsx)),
y se pide dos veces: al cargar y otra vez al marchar.

## Las decisiones (Juan, 2026-08-27)

**D1 · Son dos horas, y las dos a mano.**

| | Qué es | Para quién |
|---|---|---|
| **Hora de cocina** | para cuándo el plato tiene que estar **listo** | cocina — se imprime arriba de la comanda |
| **Hora del pedido** | cuándo el cliente lo **retira o lo recibe** | el encargado y Ale — board y ticket de control |

El sistema no calcula ninguna de las dos ni pre-llena la segunda con la primera.

**D2 · La comanda marcha sola.** El encargado no aprieta nada: el pedido sale a
cocina **`hora de cocina − lead`**. Con lead 40 y «listo 21:15», la comanda se
imprime a las 20:35 y cocina tiene sus 40 minutos completos. Nada de papeles
dando vueltas tres horas, y nada de un gesto más en hora pico.

**D3 · El lead vuelve a ser tiempo de cocina, y es uno solo.** Hoy son 40 (retiro)
y 60 (delivery) porque el de delivery incluía el viaje. Con las dos horas
escritas, **el viaje ya está dicho en la diferencia entre ellas** (listo 21:15 →
entrega 21:30 = 15 min), así que el lead deja de depender del canal.

> Sólo aplica **cuando hay hora de cocina**. El pedido del checkout público no la
> tiene —el cliente elige una sola hora— así que ahí sigue rigiendo el lead por
> tipo, exactamente como hoy. Ver FR-004.

**D4 · La hora de cocina va en todas las comandas del pedido, y sólo en ésas.**
Como una nota, arriba de todo, igual que hoy. En una mesa no aparece.

**D5 · «Nota para el pedido» queda como campo de notas y nada más.**

## Qué se construye

### FR-001 · Una columna nueva, no dos

Migración **0050**:

| Columna | Qué guarda |
|---|---|
| `orders.kitchen_at timestamptz null` | hora de cocina — para cuándo tiene que estar listo |
| `businesses.scheduled_march_lead_kitchen_min int not null default 40` | el lead único de D3 (check `0..240`, igual que la 0027) |

**La hora del pedido no necesita columna: es `scheduled_at`.** Con D2 el encargue
difiere su marcha de verdad, que es justo lo que `scheduled_at` siempre
significó. Los dos canales pasan a escribir la misma columna y el board, el
control y `entregaLabel` tienen una sola fuente.

`scheduled_march_lead_{pickup,delivery}_min` **se conservan**: siguen rigiendo el
canal web (D3).

### FR-002 · La hoja pide las dos horas

Muere `MOSTRAR_PROGRAMADO`. En su lugar, dos `input type="time"` — hora del
local, no del navegador:

- **Hora de cocina** — «para cuándo tiene que estar listo»
- **Hora del pedido** — «cuándo lo retira o lo recibe»

Vacías = para ahora, como siempre. **Si se completa una, la otra es obligatoria.**
Coherencia mínima: cocina ≤ pedido, las dos de hoy. Debajo, en gris, lo que el
sistema va a hacer con eso: *la comanda sale sola a las 20:35*.

En **modo agregar** (spec 125) no aparecen: las horas ya se decidieron. Las mismas
dos se corrigen desde el detalle, donde hoy se pide la nota al marchar.

### FR-003 · El server valida distinto según quién carga

`validateScheduledOrder` suma `source: "public" | "staff"`:

| Regla | `public` | `staff` |
|---|---|---|
| Sólo hoy | sí | sí |
| ≥ 60 min de anticipación | sí | **no** |
| La hora tiene que ser un chip de la grilla | sí | **no** |

`cargarPedidoStaff` pasa `source: "staff"`; el checkout no cambia una coma. Es el
único punto donde las dos puertas se separan — y es lo que hace que «para las
21:20» a las 20:50 entre por fin.

### FR-004 · La ventana de marcha mira la hora de cocina

Una función pura, y todo lo demás la usa:

```
marchaAt(order, business) =
  order.kitchen_at                                  // hay hora de cocina (staff)
    ? kitchen_at − scheduled_march_lead_kitchen_min
    : scheduled_at − marchLeadForOrder(delivery_type, business)   // web, intacto
```

El `?:` es lo que deja el canal web exactamente donde está. `shouldMarchNow`,
`marchDueScheduledOrders` y el filtro SQL del cron pasan a preguntarle a esto.

### FR-005 · El que ya está en ventana sale en el acto

Un encargue a las 21:10 para cocina 21:15 tiene su ventana **vencida al nacer**.
Hoy `cargarPedidoStaff` lo dejaría `confirmed` esperando el próximo tick del
cron: hasta 5 minutos de un pedido que tiene que salir **ya**. Si `marchaAt <=
now` al crear, se rutea en el acto y no se difiere nada.

### FR-006 · El papel, igual que hoy pero con el dato bien

- **Comanda** — el banner sigue siendo lo primero del ticket y sigue diciendo
  `ENTREGAR 21:15`, pero la hora sale de `kitchen_at` en vez del texto libre. La
  nota de cocina, si la hay, baja un renglón. Sale en **todas** las comandas del
  pedido (ya es así: el payload se arma por comanda desde la orden) y **en
  ninguna de mesa** (nada llena esa columna en el salón).
- **Control** (el papel de Ale) — suma la **hora del pedido**, que es la que le
  sirve al que entrega. Hoy no la tiene.

### FR-007 · Las notas vuelven a ser notas

- `entregaLabel` deja de leer `kitchen_notes`: lee `scheduled_at` y nada más.
- **«Nota para el pedido»** (`delivery_notes`): el placeholder deja de sugerir
  «sin cebolla» —que cocina no ve— y la ayuda lo dice entero: *va en el ticket de
  control; cocina no la ve*.
- **«Nota para cocina»** (`kitchen_notes`): el placeholder deja de sugerir
  «21:30». Queda para la instrucción de armado («junto con la mesa 5»). **Mismo
  nombre en la hoja y en el detalle.**
- Una línea de ayuda manda «sin cebolla» a donde corresponde: la nota del ítem.

### FR-008 · «Próximos» dice las tres cosas

La tarjeta del agendado muestra hoy una sola hora. Pasa a decir **hora del
pedido**, **hora de cocina** y **a qué hora marcha**: `21:30 · listo 21:15 ·
marcha 20:35`. Ordenada por hora de marcha, que es la que va a pasar primero.

### FR-009 · La red de seguridad del automatismo

Con D2 el encargue telefónico **pasa a depender del cron**. Si el cron falla, el
pedido no sale y hoy nadie se entera hasta que el cliente llama.

Entonces: pasada la hora de marcha + un margen, si la orden sigue sin una sola
comanda → `createNotification({ type: "pedido.no_marcho", targetRole: "encargado" })`
y la tarjeta de «Próximos» en rojo. Idempotente por `orders.march_alerted_at`
(el tick corre cada 5 min; el timbre suena una vez).

**No es el mecanismo, es el detector.** El pedido lo marcha el cron; esto avisa
cuando no lo hizo.

## Qué NO cambia

- **El papel que ve cocina.** Mismo banner, misma posición, mismo formato.
- **El checkout del cliente** y su lead por tipo de entrega: intactos.
- **`routeOrderToCocina`**, su idempotencia, el endpoint del cron y el `pg_cron`.
- **El salón.** Una mesa no tiene horas y su comanda no lleva banner.

## Riesgos

- **El cron pasa a ser crítico para el teléfono**, no sólo para la web. FR-009 es
  la contrapartida y no es opcional.
- **Los pedidos viejos tienen la hora adentro de `kitchen_notes`** y no hay
  backfill posible (parsear texto libre no es confiable: en la base hay `T`,
  `transfirio`, `a`). Cuando `entregaLabel` deje de leer la nota, esos pedidos
  dejan de mostrarla en el board. Aceptable: son pedidos del día, y la nota sigue
  impresa en su comanda.

## Verificación

- `pnpm typecheck` · `pnpm test` · `pnpm build` en verde.
- **En vivo, con rol real de encargado** (nunca service_role):
  1. Encargue a las 18:00: cocina **21:15**, pedido **21:30** → **no** sale nada;
     queda en «Próximos» diciendo `21:30 · listo 21:15 · marcha 20:35`.
  2. A las 20:35 la comanda se imprime **sola**, con `ENTREGAR 21:15` arriba.
  3. Encargue a las 21:10 para cocina 21:15 → sale **en el acto**, sin esperar el
     tick (FR-005).
  4. Un pedido con tres sectores → las **tres** comandas llevan el banner.
  5. Abrir una mesa y mandar comanda → **sin** banner.
  6. El board dice `21:30`, no la nota ni «hace 40 min».
  7. El control de Ale trae la hora del pedido.
  8. Cargar sin horas → todo igual que hoy.
  9. Completar una sola hora → no deja guardar hasta poner la otra.
  10. Un pedido web programado → misma ventana y mismo lead que antes.
  11. Cron caído (o `app_config` vacío) → pasada la hora de marcha, aviso al
      encargado y la tarjeta en rojo. Una sola vez.
