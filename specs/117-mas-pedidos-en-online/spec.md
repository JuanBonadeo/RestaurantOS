# 117 · Pedido online: los más pedidos, como en la mesa

**Issue:** [#180](https://github.com/gachetponzellini/RestaurantOS-app/issues/180) ·
**Milestone:** Post-demo · Growth & hardening

## Por qué

Pedido de Juan: «que lo de categorías sea igual que en mesa».

El panel del salón, sin búsqueda, muestra **los más pedidos** — el selector de
categorías se fue en la spec 111, fase 5. La hoja de pedidos online seguía con un
`<select>` y mostraba la categoría activa, así que las dos superficies abrían
mostrando cosas distintas. La spec 115 unificó el shell y dejó esto anotado como
lo que faltaba.

## Qué se construye

- La hoja guarda `topProductIds` — que `loadPedirCatalog` ya devolvía y la hoja
  tiraba — y su `browse` pasa a ser los más pedidos, con el mismo fallback que el
  salón: sin historial, la carta entera antes que una pantalla en blanco.
- Se van el `<select>` y el estado `activeCategory`.
- Aparece el mismo encabezado «Principales más pedidos» que en la mesa.

El buscador no cambia: sigue siendo el mismo `useProductSearch` sobre la carta
completa, con el índice de teclado corriendo sobre lo que esté a la vista
(spec 073).

## Verificación

1. `pnpm typecheck` + `pnpm test` en verde.
2. En vivo: abrir «Cargar pedido» → se ven los más pedidos con su encabezado, sin
   selector de categoría; escribir «cafe» → resultados; ↓/↑/Enter siguen andando
   en las dos listas.
