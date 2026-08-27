# 128 · La observación de la tanda

**Issue:** [#199](https://github.com/gachetponzellini/RestaurantOS-app/issues/199) ·
**Milestone:** Post-demo · Growth & hardening

**Input:** Juan, 2026-08-27: *"me gustaría agregar una opción de un campo de
observación en común para todas las comandas que vayan a enviar"*.

## Por qué

Hoy el mozo tiene **una sola** forma de decirle algo a cocina: la nota del ítem
(`order_items.notes`, sale como `obs: …` pegada al plato). Sirve para «sin sal»,
y para nada más.

Lo que no tiene lugar es lo que vale para **el envío entero**:

| Lo que el mozo quiere decir | Dónde lo escribe hoy |
|---|---|
| «va todo junto, no saquen nada suelto» | en ningún lado |
| «la mesa tiene apuro, sale en 20» | en ningún lado |
| «hay un celíaco en la mesa» | repetido a mano en cada ítem |
| «los dos entrecots bien cocidos» | repetido a mano en cada ítem |

Repetirlo por ítem no es lo mismo: la parrilla lee su ticket y la fritera el
suyo, y ninguno de los dos se entera de que **el otro sector también está
cocinando para esa mesa**. Una indicación de coordinación tiene que salir igual
en los dos papeles o no sirve.

El campo existe para los pedidos online —`orders.kitchen_notes`, el banner
`ENTREGAR x`— pero es del **pedido**, lo escribe el encargado, y la spec 127 lo
está dejando explícitamente afuera del salón (D4: *«En una mesa no aparece»*).

## Las decisiones

**D1 · Es de la tanda, no de la mesa.** Se escribe al enviar, sale en todas las
comandas de **ese** envío, y el próximo envío arranca en blanco.

Es una indicación **de este momento** («va todo junto», «apuro»), no un atributo
del pedido. Si se arrastrara, el tercer envío repetiría una instrucción vieja
—«apuro» a las 21:40 cuando el apuro era a las 20:10— y cocina aprendería a no
leerla.

**D2 · Se guarda en la comanda, no en el pedido.** Columna nueva en `comandas`,
la misma copia en cada comanda del envío. Tres razones:

- La reimpresión (spec 035) vuelve a sacar el ticket **tal cual salió**: la
  observación tiene que viajar con la comanda, no con la orden.
- Una comanda anulada no puede arrastrar la observación de otra tanda.
- `orders.kitchen_notes` es del pedido entero y lo gobierna la 127. Meter acá la
  nota de una tanda sería reponer el enredo que esa spec está desarmando: un
  campo con dos dueños y dos significados.

**D3 · En el papel es contenido, no urgencia.** Sale debajo del encabezado
—sector, mesa, número— y arriba de los ítems, en doble alto y negrita, con
prefijo `OBS:`. **No** en el tamaño `xl`: ese tamaño está reservado para lo que
cambia el momento de salida (`ENTREGAR`, `ANULADA`, `REIMPRESION`). La
observación se lee cuando ya agarraste el ticket, no de lejos.

**D4 · No frena el envío.** Campo opcional y plegado. El camino feliz sigue
siendo un tap en «Enviar» sin pasar por ningún modal (principio 3: cero fricción
en hora pico).

**D5 · También se ve en pantalla.** La comanda en la pestaña de cocina muestra su
observación. Si sólo saliera en el papel, el sector que trabaja mirando la
pantalla no se entera de nada.

**D6 · 200 caracteres.** Suficiente para dos renglones de instrucción, y no tanto
como para que una observación se coma medio ticket y tape los platos.

## Qué se construye

### FR-001 · Una columna nueva

Migración **0051**:

| Columna | Qué guarda |
|---|---|
| `comandas.notes text null` | la observación del envío, repetida en cada comanda de la tanda |

### FR-002 · El ruteo la escribe

`createComandasForItems(service, orderId, itemsByStation)`
([`route-items.ts`](../../src/lib/comandas/route-items.ts)) —el **único** punto
donde nacen las comandas, lo usan el salón y los pedidos— suma un cuarto
argumento opcional `notes` y lo escribe igual en cada comanda que crea.

### FR-003 · La action la recibe

`enviarComanda` suma `notes?: string` al input: se recorta, se descarta si queda
vacío, se corta en 200 (D6) y pasa por el mismo `sanitize` que el resto del texto
que termina en una térmica. Sin `notes` el comportamiento es exactamente el de hoy.

### FR-004 · El papel

- El endpoint del print-agent suma `notes` al select de `comandas` y lo manda
  como `comanda_notes`. **Campo aditivo**: un agente viejo lo ignora e imprime el
  ticket de siempre.
- `buildTicketLines` lo imprime según D3, entre el encabezado y los ítems, con
  una línea de separación abajo.
- En una comanda **anulada** no sale: no hay nada que preparar.

### FR-005 · El mozo la escribe

En el pie de la columna de la mesa, **arriba** de «Enviar», un renglón plegado:

```
 💬 Observación para cocina                                    (plegado)
 ─────────────────────────────────────────────────────────────
 [ va todo junto, la mesa tiene apuro________________ ]  0/200
 Sale arriba de todo en las tres comandas de este envío.
```

- Plegado por default; se abre con un tap y se cierra vacío.
- Con texto cargado, el renglón muestra la observación en vez del rótulo, para
  que no se envíe a ciegas algo escrito hace diez minutos.
- **Se limpia al enviar** (D1), en el mismo lugar donde hoy se limpia el carrito.
- La pastilla dice a cuántos sectores va, con el ruteo que ya se calcula para el
  botón de enviar.

### FR-006 · La pantalla de cocina

La tarjeta de la comanda muestra su observación arriba de los ítems, con el mismo
`OBS:` del papel (D5).

## Qué NO cambia

- **`orders.kitchen_notes`** y su banner `ENTREGAR`: son del pedido y los gobierna
  la spec 127. Una mesa sigue sin banner.
- **La nota del ítem** (`order_items.notes`): sigue siendo la de «sin sal», pegada
  al plato.
- **El ticket de control** de Ale: la observación es para quien cocina.
- **El ruteo por sectores**, la idempotencia del envío y el `batch`.
- **Los pedidos online**: `confirmarPedido` no pasa `notes` en esta spec. La
  plomería queda lista (FR-002) por si se quiere después.

## Riesgos

- **Se puede usar como cajón de sastre.** Un mozo puede escribir «sin sal» ahí en
  vez de en el ítem, y esa observación viaja a los tres sectores. Se mitiga con
  el texto de ayuda, no con una validación: es más barato un papel de más que un
  campo que rechaza.
- **Ocupa papel en cada ticket del envío.** Con 200 caracteres a doble alto son
  hasta ~9 renglones. Es el precio de que la instrucción llegue a todos los
  sectores; el límite existe para acotarlo.

## Verificación

- `pnpm typecheck` · `pnpm test` · `pnpm build` en verde.
- **En vivo, con rol real de mozo** (nunca service_role):
  1. Mesa con platos de dos sectores + observación → **las dos** comandas salen
     con el mismo `OBS:`, debajo del encabezado y arriba de los ítems.
  2. Enviar sin observación → ticket idéntico al de hoy, sin renglón de más.
  3. Segundo envío en la misma mesa → el campo arranca **vacío** y la comanda
     nueva no repite la observación de la tanda anterior.
  4. Reimpresión de la comanda con observación → sale con la observación.
  5. Anular esa comanda → el ticket `ANULADA` no la lleva.
  6. La pestaña de cocina muestra la observación en la tarjeta.
  7. Pegar 500 caracteres → se guarda cortado en 200, sin error.
