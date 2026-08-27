# 127 · Los dos horarios del pedido

**Issue:** [#197](https://github.com/gachetponzellini/RestaurantOS-app/issues/197) ·
**Milestone:** Post-demo · Growth & hardening

**Input:** Juan, 2026-08-27, revisando pedidos: *"la parte de elegir el horario y
las notas quedó medio rara"* · *"es que una sería el horario de cocina, y el otro
sería el horario del pedido"* · *"que el horario de cocina se informe en todas las
comandas, como una nota, sólo en las comandas para pedidos"* · **"así como está
ahora funciona bien para los cocineros y para Ale que se encarga de los pedidos,
pero para el encargado queda raro, y para nuestro sistema también"**.

## Por qué

Esa última frase es la spec entera. **El papel no está roto** — cocina lee
«ENTREGAR 21:30» arriba del ticket y se organiza; Ale trabaja con eso. Lo que
está roto es de dónde sale ese texto: el encargue telefónico **no tiene dónde
escribir su hora**, así que se la escribe encima a una nota.

De ahí las cuatro costuras, todas del lado del encargado y del sistema:

**1 · La hora vive en un campo de texto.** El selector real está apagado en la
carga a mano (spec 120) pero sigue vivo en el checkout del cliente. Por teléfono
la única forma de decir «21:30» es «Nota para cocina». El sistema no la entiende:
no la puede ordenar, ni mostrar como hora, ni ponerla en el control.

**2 · El board muestra la nota como si fuera la hora.** `entregaLabel` devuelve
`kitchen_notes` primero y `scheduled_at` sólo si la nota está vacía
([`entrega.ts`](../../src/lib/orders/entrega.ts), #192). Un pedido con nota
«junto con la mesa 5» muestra eso donde debería ir una hora, y un programado del
cliente con nota muestra la nota en vez de su hora real. La precedencia está al
revés.

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

El sistema **no calcula ninguna de las dos** ni pre-llena la segunda con la
primera: nada de leads ni de magia.

**D2 · La comanda sale ya, siempre.** El encargue no espera: se carga y marcha,
como hoy — que es justamente lo que funciona. Las dos horas son **información**,
no un temporizador. Cocina se organiza sola con la hora impresa, que es lo que ya
viene haciendo.

**D3 · La hora de cocina va en todas las comandas del pedido, y sólo en ésas.**
Como una nota, arriba de todo, igual que hoy. En una mesa no aparece.

**D4 · «Nota para el pedido» queda como campo de notas y nada más.** Ningún
horario adentro.

### Lo que estas decisiones dan de baja

Las fases B y C de la versión anterior de esta spec (**el cron avisando** y
**«Próximos» encendido**) **se caen**: existían para un pedido de staff que
esperaba su hora, y con D2 el pedido de staff no espera nunca.

> ⚠️ **Queda abierto, sin implementar:** Juan había pedido *"con el cron
> desactivado por ahora"* cuando el modelo era otro. Con D2, **el staff ya no
> produce ni un programado**, así que el cron sólo toca los del **canal web**
> (el cliente que elige hora en el checkout), que hoy funcionan. Apagarlo ahora
> sólo rompería eso. Se deja como está y se decide aparte; si se quiere apagar,
> es una columna `businesses.scheduled_auto_march` y un `if`.

## Qué se construye

### FR-001 · Dos columnas, dos horas

Migración **0050**, puramente aditiva:

| Columna | Qué guarda |
|---|---|
| `orders.kitchen_at timestamptz null` | hora de cocina — para cuándo tiene que estar listo |
| `orders.entrega_at timestamptz null` | hora del pedido — cuándo lo retira o lo recibe el cliente |

**`scheduled_at` no se toca.** Sigue significando lo único que significó: *esta
orden difiere su marcha hasta esta hora*, que es el motor del canal web. Las dos
nuevas son información y **no difieren nada** — por eso el pedido de staff sale
al instante sin tocar una línea del motor.

Para que la UI tenga una sola fuente para «la hora del pedido» en los dos
canales, `persistOrder` escribe `entrega_at = scheduled_at` cuando el pedido
viene programado del checkout. Backfill del histórico en la misma migración.

### FR-002 · La hoja pide las dos horas

Muere `MOSTRAR_PROGRAMADO`. En su lugar, dos `input type="time"` — hora del
local, no del navegador:

- **Hora de cocina** — «para cuándo tiene que estar listo»
- **Hora del pedido** — «cuándo lo retira o lo recibe»

Vacías = el pedido es para ahora, como siempre. **Si se completa una, la otra es
obligatoria**: es lo que significa «las dos a mano». Coherencia mínima: cocina ≤
pedido, las dos de hoy. Ninguna difiere la marcha: el pie sigue siendo «Cargar y
enviar a cocina» / «Sólo cargar», y ⌘Enter marcha.

En **modo agregar** (spec 125) no aparecen: las horas ya se decidieron.

Las mismas dos horas se pueden corregir desde el detalle del pedido, donde hoy
se pide la nota al marchar.

### FR-003 · El papel, igual que hoy pero con el dato bien

- **Comanda** — el banner sigue siendo lo primero del ticket y sigue diciendo
  `ENTREGAR 21:30`, pero la hora sale de `kitchen_at` en vez del texto libre. La
  nota de cocina, si la hay, baja un renglón. Sale en **todas** las comandas del
  pedido (ya es así: el payload se arma por comanda desde la orden) y **en
  ninguna de mesa** (nada llena esas columnas en el salón).
- **Control** (el papel de Ale) — suma la **hora del pedido**, que es la que le
  sirve al que entrega. Hoy no la tiene.

### FR-004 · Las notas vuelven a ser notas

- `entregaLabel` deja de leer `kitchen_notes`: lee `entrega_at` y nada más. Muere
  la costura 2, y de paso el board pasa a mostrar una hora de verdad, ordenable.
- **«Nota para el pedido»** (`delivery_notes`): el placeholder deja de sugerir
  «sin cebolla» —que cocina no ve— y la ayuda lo dice entero: *va en el ticket de
  control; cocina no la ve*.
- **«Nota para cocina»** (`kitchen_notes`): el placeholder deja de sugerir
  «21:30». Queda para lo que siempre fue, la instrucción de armado («junto con la
  mesa 5»). **Mismo nombre en la hoja y en el detalle.**
- Una línea de ayuda manda «sin cebolla» a donde corresponde: la nota del
  producto.

### FR-005 · El board muestra las dos

La tarjeta dice la **hora del pedido** (es la promesa al cliente); el detalle,
las dos. Ordenar por hora queda habilitado por ser un dato — no entra en esta
spec.

## Qué NO cambia

- **El papel que ve cocina.** Mismo banner, misma posición, mismo formato.
- **El checkout del cliente**, `scheduled_at`, «Próximos», el cron y el lead por
  negocio: intactos.
- **`routeOrderToCocina`** y la idempotencia de la marcha.
- **El salón.** Una mesa no tiene horas y su comanda no lleva banner.

## Riesgo conocido

Los pedidos viejos tienen la hora **adentro** de `kitchen_notes` y no hay
backfill posible (parsear texto libre no es confiable: en la base hay `T`,
`transfirio`, `a`). Cuando `entregaLabel` deje de leer la nota, esos pedidos
dejan de mostrarla en el board. Es aceptable: son pedidos del día, y la nota
sigue impresa en su comanda.

## Verificación

- `pnpm typecheck` · `pnpm test` · `pnpm build` en verde.
- **En vivo, con rol real de encargado** (nunca service_role):
  1. Encargue a las 20:50: cocina **21:15**, pedido **21:30** → la comanda sale
     **en el acto**, con `ENTREGAR 21:15` arriba.
  2. Un pedido con tres sectores → las **tres** comandas llevan el banner.
  3. Abrir una mesa y mandar comanda → **sin** banner.
  4. El board dice `21:30` (hora del pedido), no la nota ni «hace 40 min».
  5. El control de Ale trae la hora del pedido.
  6. Cargar sin horas → todo igual que hoy.
  7. Completar una sola hora → no deja guardar hasta poner la otra.
  8. Escribir «junto con la mesa 5» en la nota de cocina → sale debajo del
     banner, y el board **no** la muestra como hora.
