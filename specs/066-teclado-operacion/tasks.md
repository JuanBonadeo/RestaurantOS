# Tasks — 066 · Operación keyboard-first

> **Nota (2026-08-03):** tildado retroactivamente. Estas tasks se implementaron y shippearon pero el archivo nunca se actualizó; el estado se reconstruyó desde el código y la issue cerrada. Lo que sigue sin tildar es lo que realmente falta (verify en vivo con rol real).


Issue [#103](https://github.com/gachetponzellini/RestaurantOS-app/issues/103).

## Lógica pura (TDD)

- [x] T1 · `src/lib/mozo/party-size-keys.ts` — `partySizeFromKey(key, current)`: `+`/`=` → +1 (tope 20), `-` → −1 (piso 1), `1`–`9` → absoluto, resto → `null`. Test primero (`party-size-keys.test.ts`).

## Resultados de búsqueda (FR-001 · FR-002 · FR-003)

- [x] T2 · `src/components/mozo/product-results-list.tsx` — lista de una columna, fila seleccionada con ring + `scrollIntoView({ block: "nearest" })`.
- [x] T3 · `pedir-client.tsx` — `SearchResults` pasa a usarla (borra la grilla propia).
- [x] T4 · `cargar-pedido-sheet.tsx` — separar búsqueda (lista) de catálogo por categoría (grilla).
- [x] T5 · `venta-rapida-panel.tsx` — ídem.

## Walk-in (FR-004 · FR-005 · FR-006)

- [x] T6 · `walk-in-modal.tsx` — extraer `WalkInForm` (formulario + atajos de teclado + foco en «Abrir mesa»); `WalkInModal` lo envuelve en el overlay del mozo y `WalkInPanel` en el panel del sidebar.
- [x] T7 · `salon-desktop.tsx` — `WalkInPanel` en la cadena de modos del `<aside>` (después de cobro/cuenta/pedir, antes del detalle); Esc y volver cierran.

## Detalle de mesa (FR-007)

- [x] T8 · `salon-desktop.tsx` — `TableDetail` enfoca la acción primaria al montarse (`preventScroll`).

## Cierre

- [x] T9 · `pnpm typecheck` + `pnpm test`.
- [ ] T10 · Verificar en vivo con el rol real (encargado) en `/admin/operacion → Mesas`.
- [x] T11 · Actualizar `wiki/features/mozo.md` + `wiki/log.md`, comentar y cerrar #103.
