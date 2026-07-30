# Tasks — 068 · Un solo bloque de cliente y un solo buscador de productos

- [x] **T001** `catalog-query.ts`: `show_online` en `CatalogProduct` + en el select de `getCatalogForMozo`. Sin migración: la columna ya existe (`boolean not null default true`, verificado por SQL contra el cloud).
- [x] **T002** `src/components/shared/customer-fields.tsx` (nuevo): buscador + nombre + teléfono con la regla de la spec 067 adentro (teléfono bloqueado con cliente elegido, «Quitar» para soltarlo). Controlado por el caller; el "hay cliente elegido" vive adentro.
- [x] **T003** `customer-search-field.tsx`: prop `autoFocus` (FR-002).
- [x] **T004** `walk-in-modal.tsx`: usa `CustomerFields`, foco en el cliente. Se elimina el foco inicial en «Abrir mesa» de la spec 066 FR-005 (ver nota).
- [x] **T005** `new-reservation-modal.tsx`: usa `CustomerFields`, foco en el cliente, y se borra su buscador propio. Enter crea la reserva (el modal ya era un `<form>`; el buscador sólo se queda con Enter si hay un resultado marcado).
- [x] **T006** `src/components/mozo/product-search-box.tsx` (nuevo): `useProductSearch` (filtrado + teclado + filtro de la web) y `ProductSearchInput`. Hook + input en vez de un componente que envuelva todo, porque en las tres pantallas el buscador vive en un header fijo y los resultados en el área que scrollea.
- [x] **T007** Filtro «va / no va a la web» sobre `show_online`, persistido por máquina + superficie (`useStickyFilter`, spec 065). Sólo se muestra si el catálogo tiene de los dos tipos.
- [x] **T008** `venta-rapida-panel.tsx`, `cargar-pedido-sheet.tsx` y `pedir-client.tsx` (las dos vistas: sidebar/full y `CatalogoStep`) usan el buscador compartido. Se borran los tres `onKeyDown` copiados y los tres filtrados propios.
- [x] **T009** `cargar-pedido-sheet.tsx`: usa `CustomerFields` y se borra su buscador de clientes propio (`clienteQuery` / `clienteResults` / `clienteLoading` / `clientePicked`).
- [x] **T010** `pnpm typecheck` + `pnpm lint` + `pnpm build` verdes; `pnpm test` 894 pass / 140 skip (los 16 `*.integration.test.ts` fallan por falta del stack Supabase local — preexistente).
- [x] **T011** Wiki: [`features/mozo.md`](../../../wiki/features/mozo.md), [`features/pedidos.md`](../../../wiki/features/pedidos.md), [`features/reservas.md`](../../../wiki/features/reservas.md).
- [ ] **T012** Verify en vivo con rol real: abrir mesa (foco en cliente, Enter abre), nueva reserva (foco en cliente, Enter crea, Enter con resultado marcado elige), y el filtro de carta web en las tres pantallas de carga.

## Notas

- **Revierte parte de la spec 066 FR-005.** El foco al abrir mesa pasa de «Abrir mesa» al campo Cliente. Enter sigue abriendo la mesa (Enter en un input de un `<form>` dispara el submit), pero los atajos `1`-`9` / `+` / `−` no aplican mientras se escribe el nombre. Decisión explícita de Juan.
- Dos warnings de lint en `pedir-client.tsx` (`CatalogSuperCategory` sin usar y un `eslint-disable` de más) son **preexistentes**: se verificó lintando la versión de `HEAD`. No se tocan.
