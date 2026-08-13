# 123 · Venta rápida con el panel de carga

**Issue:** [#187](https://github.com/gachetponzellini/RestaurantOS-app/issues/187) ·
**Milestone:** Post-demo · Growth & hardening

## Por qué

Pedido de Juan: «la parte de venta rápida debería ser como agregar un ítem en una
mesa o en un pedido».

Venta rápida ya reusaba las piezas chicas —`ProductSearchInput`,
`ProductResultsList`, `ProductModal`, `useCartZone`, el teclado de la 073— pero
armaba su propio layout de una columna: el catálogo arriba y la venta apretada en
una franja al pie. Cargar un ítem se sentía distinto según dónde estuvieras, que
es justo lo que la spec 115 vino a terminar.

## Qué se construye

- **El shell compartido** (`PanelDeCarga` + `ColumnaLateral` + `ColumnaDeCarga`):
  la venta y el cobro a la izquierda, buscar y agregar a la derecha. Tercera
  pantalla en usarlo, después de la mesa y los pedidos online.
- **Los más pedidos sin búsqueda**, como la mesa (spec 111, fase 5) y los pedidos
  online (spec 117). Se va el `<select>` de categorías y el estado
  `activeCategory`; entra `topProductIds`, que `loadPedirCatalog` ya devolvía y
  acá también se tiraba. Con el mismo fallback: sin historial, la carta entera.

### `ColumnaLateral` suma `modoAngosto`

| Valor | Qué hace cuando no entran las dos columnas | Quién lo usa |
|---|---|---|
| `"encima"` (default) | Se abre tapando la carga; `abierta` la controla | mesa, pedidos online |
| `"apilada"` | Se queda en el flujo, **debajo** de la carga | venta rápida |

La diferencia no es cosmética: en la mesa y en la hoja son dos vistas de lo mismo
y alternar tiene sentido. En venta rápida el total y «Cobrar» son el final del
camino feliz — esconderlos detrás de un toggle es pedirle al que cobra que se
acuerde de abrir otra vista con el cliente esperando.

## Qué NO cambia

**Nada del cobro.** Misma `cobrar()`, misma idempotencia por `requestId` (issue
#58), misma emisión de factura, mismas cajas y ajustes. Esto es layout.

## Verificación

1. `pnpm typecheck` + `pnpm test` en verde.
2. **En vivo, con rol real y plata de verdad** — es lo que falta y no es
   opcional: abrir venta rápida, cargar, cobrar, y confirmar contra la caja que
   el movimiento quedó igual que antes.
3. Con el panel ancho (≥672px), dos columnas. Con el panel en 480, la venta
   queda abajo y se ve el total sin scrollear el catálogo.
