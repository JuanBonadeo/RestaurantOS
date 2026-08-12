# 121 · «Cargar pedido» a la columna «Nuevos»

**Issue:** [#185](https://github.com/gachetponzellini/RestaurantOS-app/issues/185) ·
**Milestone:** Post-demo · Growth & hardening

## Por qué

Cargar un pedido a mano (spec 054) es de las acciones más frecuentes del board
—es el encargue telefónico— y el botón estaba en una barra chica arriba del
kanban, con `size="sm"`, del tamaño de un control secundario. Pedido de Juan:
que se vea.

## Qué se construye

- El botón se va a la **cabecera de la columna «Nuevos»**, arriba de las
  tarjetas: ancho completo de la columna, alto 56 px, en el azul que ya
  identifica a esa columna. Queda donde el pedido va a aparecer — cargás y el
  resultado sale justo abajo.
- La barra de arriba queda sólo con «Activar sonido» y **sólo mientras el sonido
  esté bloqueado**: una vez activado se va entera, en vez de dejar una franja
  vacía sobre el board.

No cambia nada del flujo: abre el mismo `CargarPedidoSheet`, con los mismos
props.

## Verificación

1. `pnpm typecheck` + `pnpm test` en verde.
2. En vivo: el botón se ve arriba de «Nuevos», ocupa la columna y abre la hoja.
   Con el sonido activado, la barra de arriba no deja hueco.
