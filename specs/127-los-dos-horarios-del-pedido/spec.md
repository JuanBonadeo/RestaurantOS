# 127 · Los dos horarios del pedido

**Issue:** [#197](https://github.com/gachetponzellini/RestaurantOS-app/issues/197) ·
**Milestone:** Post-demo · Growth & hardening

**Input:** Juan, 2026-08-27, revisando pedidos:

- *"la parte de elegir el horario y las notas quedó medio rara"*
- *"una sería el horario de cocina, y el otro sería el horario del pedido"*
- *"que el horario de cocina se informe en todas las comandas, como una nota,
  sólo en las comandas para pedidos"*
- *"así como está ahora funciona bien para los cocineros y para Ale, pero para el
  encargado queda raro, y para nuestro sistema también"*
- **"quiero que la comanda siga saliendo al instante, pero que el pedido se ponga
  en preparando 40 minutos antes"**
- **"si hacen un pedido para mañana ahí sí debería ser el pedido programado, ese
  debería salir con 40 minutos de anticipación, y también lo pondría en
  preparando"**

## Por qué

El papel no está roto: cocina lee «ENTREGAR 21:30» arriba del ticket y se
organiza. Lo roto es de dónde sale ese texto —el encargue no tiene dónde escribir
su hora, se la escribe encima a una nota— y **el kanban, que miente**: un pedido
cargado a las 18:00 para las 21:30 aparece «Preparando» desde las 18:00, así que
la columna dice quince pedidos en preparación de los que ninguno se está
preparando.

Las cuatro costuras del campo:

**1 · La hora vive en un campo de texto.** El selector real está apagado en la
carga a mano (spec 120) pero sigue vivo en el checkout del cliente. Por teléfono
la única forma de decir «21:30» es «Nota para cocina».

**2 · El board muestra la nota como si fuera la hora.** `entregaLabel` devuelve
`kitchen_notes` primero y `scheduled_at` sólo si la nota está vacía
([`entrega.ts`](../../src/lib/orders/entrega.ts), #192). La precedencia está al
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

El sistema no calcula ninguna de las dos ni pre-llena la segunda con la primera.

**D2 · El papel y el estado se separan.** Son dos cosas distintas y hasta hoy
salían juntas:

| | Pedido de **hoy** | Pedido de **otro día** |
|---|---|---|
| La comanda se imprime | **al instante**, al cargarlo | a `hora de cocina − 40` |
| El pedido pasa a `preparing` | a `hora de cocina − 40` | a `hora de cocina − 40` |

**El momento `hora de cocina − 40` es el mismo en los dos casos.** Lo único que
cambia es si el papel ya salió antes o sale recién ahí.

**D3 · El lead vuelve a ser tiempo de cocina, y es uno solo.** Hoy son 40 (retiro)
y 60 (delivery) porque el de delivery incluía el viaje. Con las dos horas
escritas, el viaje ya está dicho en la diferencia entre ellas (listo 21:15 →
entrega 21:30 = 15 min de viaje).

> Sólo aplica **cuando hay hora de cocina**. El pedido del checkout público no la
> tiene —el cliente elige una sola hora— así que ahí sigue rigiendo el lead por
> tipo, exactamente como hoy.

**D4 · La hora de cocina va en todas las comandas del pedido, y sólo en ésas.**
Como una nota, arriba de todo, igual que hoy. En una mesa no aparece.

**D5 · «Nota para el pedido» queda como campo de notas y nada más.**

**D6 · Entra el encargue para otro día.** Muere el «sólo hoy» de la spec 064 —
para el staff. El checkout público lo conserva.

**D7 · La hora del encargue es libre, y no se chequea contra nada.** Ni grilla,
ni anticipación mínima, ni horario de atención: si el encargado pone las 4 AM de
un lunes cerrado, entra. Decidido con Juan (2026-08-27) sabiendo que `business_hours`
está y permitiría avisar — el encargado es el responsable, y un aviso más en hora
pico no paga. Si algún día molesta, es un `<p>` gris debajo del campo.

**D8 · «Programado» significa otro día, y punto.** Un pedido para hoy —aunque sea
para dentro de cinco horas— **no** es un pedido programado: es un pedido normal
cuya comanda sale ya. La hoja lo dice con todas las letras y el selector de fecha
del modo programado **arranca en mañana**. Esto saca de la cabeza del encargado la
pregunta «¿esto va como programado?», que hoy no tiene una respuesta obvia.

## Qué se construye

### FR-001 · Una columna nueva ✅

Migración **0050**:

| Columna | Qué guarda |
|---|---|
| `orders.kitchen_at timestamptz null` | hora de cocina — para cuándo tiene que estar listo |
| `businesses.scheduled_march_lead_kitchen_min int not null default 40` | el lead único de D3 (check `0..240`, igual que la 0027) |

**La hora del pedido no necesita columna: es `scheduled_at`**, que es lo que
siempre significó. Los dos canales escriben la misma y el board, el control y
`entregaLabel` tienen una sola fuente.

`scheduled_march_lead_{pickup,delivery}_min` **se conservan**: rigen el canal web.

### FR-002 · La hoja: para hoy, o programado ✅

Muere `MOSTRAR_PROGRAMADO`. La hoja arranca en **Para hoy**, que es el 95% de los
encargues, y «Programado» es la puerta aparte para otro día (D8).

**Para hoy** — las dos horas, opcionales:

```
( • ) Para hoy      (   ) Programado

Hora de cocina   [ 21:15 ]      para cuándo tiene que estar listo
Hora del pedido  [ 21:30 ]      cuándo lo retira o lo recibe

La comanda sale ahora. El pedido pasa a Preparando a las 20:35.
```

Vacías = para ahora mismo, como siempre.

**Programado** — la fecha aparece y **arranca en mañana**; hoy no se puede elegir.
Las dos horas pasan a ser obligatorias:

```
(   ) Para hoy      ( • ) Programado

Día              [ miércoles 28/08 ]     desde mañana
Hora de cocina   [ 21:15 ]
Hora del pedido  [ 21:30 ]

Un pedido programado es para otro día. Para hoy, cargalo como «Para hoy».
La comanda sale el miércoles 20:35, y ahí pasa a Preparando.
```

En los dos casos: **si se completa una hora, la otra es obligatoria**, y cocina ≤
pedido.

El pie cambia con el modo: en «Programado» no hay nada que enviar todavía, así
que «Cargar y enviar a cocina» se va y queda un solo botón, **«Cargar el
encargue»**.

En **modo agregar** (spec 125) nada de esto aparece. Las mismas horas se corrigen
desde el detalle, donde hoy se pide la nota al marchar.

### FR-003 · El server valida distinto según quién carga ✅

`validateScheduledOrder` suma `source: "public" | "staff"`:

| Regla | `public` | `staff` |
|---|---|---|
| Sólo hoy | sí | **no** (D6) |
| ≥ 60 min de anticipación | sí | **no** |
| La hora tiene que ser un chip de la grilla | sí | **no** |

`cargarPedidoStaff` pasa `source: "staff"`; el checkout no cambia una coma.

### FR-004 · El momento cero ✅

Una función pura, y todo lo demás la usa:

```
marchaAt(order, business) =
  order.kitchen_at                                  // hay hora de cocina (staff)
    ? kitchen_at − scheduled_march_lead_kitchen_min
    : scheduled_at − marchLeadForOrder(delivery_type, business)   // web, intacto
```

`shouldMarchNow`, `marchDueScheduledOrders` y el filtro SQL del cron pasan a
preguntarle a esto.

### FR-005 · Pedido de hoy: el papel ya, el estado después ✅

Al cargar con «enviar a cocina», se rutea con
**`routeOrderToCocina(id, businessId, { skipStatusAdvance: true })`** — la opción
ya existe (spec 091, la usa la venta de mostrador). Sale el papel; el pedido
queda fuera del kanban activo, en «Próximos».

Llegado `marchaAt`, el cron **sólo avanza el estado**: la orden ya tiene comandas,
así que `routeOrderToCocina` cortaría por idempotencia sin mover nada. Es un
UPDATE a `preparing` con la misma guarda optimista (`.in("status", MARCHABLE)`).

### FR-006 · Pedido de otro día: todo junto, a la hora ✅

No se rutea al cargar. Llegado `marchaAt`, el cron hace lo que ya hace hoy:
`routeOrderToCocina` completo — comandas **y** `preparing` en el mismo gesto.

El encargue que **nace con la ventana vencida** (21:10 para cocina 21:15) sale en
el acto, sin esperar hasta 5 minutos al próximo tick.

### FR-006b · El pedido de otro día pertenece a la jornada en que se prepara ✅

`orders.business_day` y `orders.daily_number` los materializa el trigger
`set_order_daily_number` sobre **`created_at`** (migración 0049). Sin tocar nada,
el encargue cargado hoy para mañana se lleva el número **de hoy**: mañana el pase
cantaría un «#7» que no es el #7 de mañana, y podrían convivir dos.

El trigger ya deja la puerta abierta —`if new.business_day is null`—, así que
alcanza con que `persistOrder` mande `business_day = operating_day(kitchen_at)`
cuando el encargue es para otro día. El número se saca de la jornada correcta y
el encargue queda **#1 de mañana**, que es lo que corresponde: llegó primero.

Corolario aceptado: el pedido no aparece en los totales de la jornada en que se
cargó, sino en la que se trabaja. Es lo correcto para caja y para el pase.

### FR-007 · El papel, igual que hoy pero con el dato bien ✅

- **Comanda** — el banner sigue siendo lo primero del ticket y sigue diciendo
  `ENTREGAR 21:15`, pero la hora sale de `kitchen_at` en vez del texto libre. La
  nota de cocina, si la hay, baja un renglón. Sale en **todas** las comandas del
  pedido y **en ninguna de mesa**.
- **Control** (el papel de Ale) — suma la **hora del pedido**. Hoy no la tiene.

### FR-008 · Las notas vuelven a ser notas ✅

- `entregaLabel` deja de leer `kitchen_notes`: lee `scheduled_at` y nada más.
- **«Nota para el pedido»** (`delivery_notes`): el placeholder deja de sugerir
  «sin cebolla» —que cocina no ve— y la ayuda lo dice entero: *va en el ticket de
  control; cocina no la ve*.
- **«Nota para cocina»** (`kitchen_notes`): el placeholder deja de sugerir
  «21:30». Queda para la instrucción de armado. **Mismo nombre en los dos lados.**
- Una línea de ayuda manda «sin cebolla» a la nota del ítem.

### FR-009 · El agendado vive en «Nuevos», con su chip ✅

> **Corregido con Juan (2026-08-27)**, después de verlo andando: *"si un pedido
> está programado, que quede en la parte de pendientes, y que diga que está
> programado, así no cambia tanto la ui"*. La primera versión le daba su propia
> sección encendida; movía media pantalla para algo que es un pedido más.

**La sección «Próximos» se va.** El agendado ya tiene los estados de esa columna
(`pending` / `confirmed`), así que alcanzó con **dejar de sacarlo** del kanban.
La tarjeta suma un chip **«Programado»** al lado de la hora, y nada más.

Dos cosas que había que rescatar de la sección que se fue:

- **El orden.** Los agendados van al final de «Nuevos», entre ellos por hora de
  marcha. Por FIFO puro un encargue para mañana cargado a las 10 le ganaría a un
  pedido que entró recién, y arriba tiene que estar lo que se atiende ahora.
- **El «Aceptar».** El programado impago del checkout no marcha hasta que alguien
  lo avala (spec 047); sin ese botón se quedaba esperando para siempre. Bajó a la
  tarjeta, al lado de «Marchar ya».

### FR-010 · La red de seguridad del automatismo ✅ (la mitad que importa)

El avance pasa a depender del cron. Si el cron falla, el pedido de otro día **no
sale** y el de hoy se queda fuera del kanban.

**Lo que está:** el chip del agendado pasa a rojo y dice **«No marchó»** cuando
su hora de marcha ya pasó y el pedido sigue en «Nuevos». Es la mitad que
funciona *aunque el cron esté muerto*, porque la calcula el board abierto en el
local (la tarjeta ya se re-renderiza sola cada 30 s).

**Lo que no está, y por qué:** la notificación interna server-side. La emitiría
el propio cron, así que no cubre el caso que importa —que el cron no corra—.
`orders.march_alerted_at` quedó creada para cuando se haga desde afuera.

### FR-011 · El estado no retrocede sobre lo que cocina ya hizo ✅

**Apareció revisando cómo el cambio de estado interfiere con las comandas.**
`orders.status` y `comandas.status` son **ejes independientes** por decisión de
la spec 091, y ninguna acción de cocina mueve el primero. Hasta acá no
importaba: el pedido llegaba a `preparing` en el mismo gesto que creaba las
comandas.

Con el papel saliendo **antes** que el estado aparece un caso que antes no
existía: comanda impresa a las 18:00, cocina la despacha a las 19:00, y a las
20:35 el cron bajaba el pedido a `preparing` — el kanban decía que se empieza a
preparar algo que ya está hecho y entregado.

El cron ahora mira las comandas antes de avanzar: si están todas `entregado`, no
toca el estado. Una comanda cancelada no cuenta.

## Qué NO cambia

- **El papel que ve cocina.** Mismo banner, misma posición, mismo formato.
- **Que la comanda del encargue de hoy salga al instante.** Es lo que funciona.
- **El checkout del cliente**, su «sólo hoy», sus chips y su lead por tipo.
- **`routeOrderToCocina`**, su idempotencia, el endpoint del cron y el `pg_cron`.
- **El salón.** Una mesa no tiene horas y su comanda no lleva banner.

## Riesgos

- **El cron pasa a gobernar el kanban**, no sólo el canal web. FR-010 no es
  opcional.
- **Un pedido de hoy con comanda impresa y estado `confirmed`** es un estado
  nuevo en la operación: papel afuera, pedido fuera del kanban. El KDS de cocina
  lo muestra desde que se imprime (correcto: el papel ya está en la cocina), pero
  el board no. FR-009 lo hace legible.
- **El stock se descuenta al cargar, no al marchar.** Los triggers cuelgan de
  `order_items` (0039 · 0042), así que un encargue para mañana reserva el insumo
  hoy. Es defendible —el insumo está comprometido— pero puede dejar el stock de
  hoy en negativo (spec 099 ya lo permite). No se toca en esta spec.
- **Los pedidos viejos tienen la hora adentro de `kitchen_notes`** y no hay
  backfill posible (en la base hay `T`, `transfirio`, `a`). Al dejar de leer la
  nota, esos pedidos dejan de mostrarla en el board. Aceptable: son del día.

## Estado

**Implementada** (2026-08-27). Migración 0050 aplicada al cloud
(`tjfufswzsxfujcpoxapx`). `pnpm typecheck`, `pnpm build` y 1822 tests de unidad
en verde; los `*.integration` siguen rotos por el stack local apagado
(`supabase.auth.getClaims is not a function`), igual que antes de tocar nada.

| Commit | Qué entró |
|---|---|
| `c325bb6` | migración 0050 + tipos regenerados |
| `3f11e3d` | `marchAtForOrder` y la validación por `source` |
| `558c6fb` | la persistencia y la jornada del encargue de otro día |
| `d647778` | el papel sale, el estado espera (`skipStatusAdvance`) |
| `47d7fc3` | el cron: ventana desde la hora de cocina + avanzar al que ya imprimió |
| `760158b` | la hoja y las notas |
| `601c9b3` | «Próximos» encendido |
| `7ccfd66` | el papel del repartidor |
| `990c68c` | el banner de la comanda |
| `41d2461` | el chip «Programado» en «Nuevos» + la guarda del estado (FR-011) |

**Lo que cambió sobre la marcha:**

- **`skipStatusAdvance` ya existía** (spec 091, la venta de mostrador), así que
  separar el papel del estado no costó código nuevo — sólo usarlo.
- **`FR-006b` apareció implementando**: el trigger `set_order_daily_number` saca
  la jornada de `created_at`, así que el encargue de mañana se llevaba un número
  de hoy y ese día habría habido dos «#7» en el pase.
- **`FR-010` quedó a medias, y a propósito.** La mitad client-side está (la
  tarjeta en rojo, que es la que funciona *aunque el cron esté muerto*). La
  notificación interna server-side **no**: la emitiría el propio cron, así que no
  cubre el caso que importa. `orders.march_alerted_at` quedó creada para cuando
  se haga, desde un cron aparte o desde el board.
- **Regenerar los tipos destapó** que estaban viejos desde la 0049:
  `business_day` y `daily_number` son NOT NULL sin default de columna.
- **Se fueron tres props muertas** de la hoja (`scheduledSlots` y los dos leads
  por tipo): la grilla de chips era del checkout, y el staff escribe hora libre.

## Verificación

- `pnpm typecheck` · `pnpm test` · `pnpm build` en verde.
- **En vivo, con rol real de encargado** (nunca service_role):
  1. **Hoy**, 18:00: cocina 21:15, pedido 21:30 → la comanda **se imprime ya**,
     con `ENTREGAR 21:15`. El pedido **no** aparece en «Preparando»: está en
     «Próximos», marcado «comanda impresa».
  2. 20:35 → el pedido entra solo a «Preparando». No sale un segundo papel.
  3. **Mañana**, cocina 21:15 → **no se imprime nada**. Mañana 20:35 sale la
     comanda y el pedido pasa a «Preparando» en el mismo momento.
  4. Encargue a las 21:10 para cocina 21:15 → papel y estado en el acto.
  5. Pedido con tres sectores → las **tres** comandas llevan el banner.
  6. Mesa → comanda **sin** banner.
  7. El board dice `21:30`, no la nota ni «hace 40 min».
  8. El control de Ale trae la hora del pedido.
  9. Cargar sin horas → todo igual que hoy.
  10. Completar una sola hora → no deja guardar.
  11. Pedido web programado → misma ventana y mismo lead que antes.
  12. Cron caído → pasado `marchaAt`, aviso al encargado y tarjeta en rojo, una
      sola vez.
