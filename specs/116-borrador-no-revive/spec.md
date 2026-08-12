# 116 · El borrador no revive lo ya enviado

**Issue:** [#179](https://github.com/gachetponzellini/RestaurantOS-app/issues/179) ·
**Milestone:** Post-demo · Growth & hardening

## Por qué

El pedido en armado se guarda en un borrador local por mesa
(`mozo-cart:<slug>:<tableId>`, spec 055 / #81) para que salir de la carga y
volver no te haga cargar todo de nuevo. Reportado por Juan: después de enviar,
al abrir la mesa otra vez los productos recién mandados **seguían ahí**, listos
para enviarse de nuevo.

Son dos bugs, y los dos terminan en comida de más en la cocina.

### 1 · El borrador sobrevive al envío

`handleSend` saca del carrito lo enviado y, en el **mismo commit**, llama a
`onSent` — que en el salón cierra la carga y desmonta el panel. El borrador se
persistía desde un `useEffect` sobre `cart`, así que al desmontarse el efecto
nunca llegaba a ver el carrito vacío. Poner la escritura adentro del updater de
`setCart` tampoco alcanza: React descarta las actualizaciones de estado de un
componente que se está yendo, y el updater ni se invoca.

### 2 · El carrito se arrastra entre mesas

Desde el keep-alive (specs 101 / 114) el panel **no se desmonta** al cambiar de
mesa. La hidratación sólo pisaba el carrito si la mesa nueva tenía borrador; sin
borrador quedaba el de la mesa anterior, apuntando a la mesa equivocada.

## Qué se construye

- `guardarBorrador(items)` — un solo escritor del borrador, que usan el efecto de
  persistencia y `handleSend`.
- Al enviar, el borrador se escribe **sincrónico**, antes de `onSent`. Los ítems
  que quedan se calculan desde un `cartRef` (espejo del carrito) y no desde el
  closure, para no perder las líneas agregadas *durante* el envío — FR-009 de la
  spec 055 sigue valiendo.
- La hidratación por mesa **siempre** reemplaza el carrito: sin borrador, vacío.

## Verificación

1. `pedir-client.borrador.test.tsx` — dos tests de regresión, uno por bug.
2. En vivo, con rol real: cargar dos ítems en la mesa 5, enviar, reabrir la mesa
   → el carrito arranca vacío y la comanda está en «Lo pedido».
3. Cargar un ítem en la mesa 5 **sin** enviar, tocar la mesa 6 en el plano → la 6
   abre vacía; volver a la 5 → el ítem sigue ahí.
