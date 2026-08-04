# Tasks — 078 · Anular la comanda desde el panel de la mesa

Issue [#119](https://github.com/gachetponzellini/RestaurantOS-app/issues/119). Ver [`spec.md`](spec.md).

Todo es UI + una columna más en dos queries. Sin migración, sin server actions nuevas.

## Extraer el modal

- [x] T1 · `src/components/shared/anular-comanda-modal.tsx` **(nuevo)** — FR-002. Va a `shared/` porque lo consumen dos superficies (`admin/local` y `mozo`), como `price-override-modal`. Sale tal cual de `comandas-kanban.tsx` (mismo copy, mismo pending, misma `cancelarComanda`), pero parametrizado por primitivas (`comandaId`, `stationName`, `batch`, `origen`) en vez de por el tipo `LocalComanda` del kanban.
- [x] T2 · `comandas-kanban.tsx` — borrar la copia local y consumir el compartido, armando `origen` con la misma regla de hoy (mesa / nombre del cliente / «Pedido online»).

## Datos: `cancelled_at` hasta la card

- [x] T3 · `src/app/[business_slug]/admin/(authed)/operacion/data.ts` — sumar `cancelled_at` al select de `comandas` y al mapeo a `SalonOrderRef` (FR-004).
- [x] T4 · `src/app/[business_slug]/mozo/page.tsx` — lo mismo para la vista del mozo.
- [x] T5 · `salon-desktop.tsx` — `cancelled_at` en el tipo `SalonOrderRef.comandas` (es el tipo que comparten page ↔ cliente).

## La acción en la card

- [x] T6 · `order-summary-card.tsx` — `ComandaSummary.cancelled_at`; `getComandaDisplayStatus` pasa a tres estados (`activa` / `cerrada` / `anulada`) y deriva de la comanda entera, no del `status` suelto (FR-004). El contador del encabezado y `allComandasDelivered` ignoran las anuladas.
- [x] T7 · `order-summary-card.tsx` — prop `canAnular`; `ComandaRow` muestra el `⋯` con **Anular comanda** sólo si `canAnular && status !== "entregado" && !cancelled_at` (FR-001/003/004). Al confirmar: toast + `router.refresh()`.
- [x] T8 · `salon-desktop.tsx` (`TableDetail`) y `mozo-client.tsx` — pasar `canAnular={canCancelItem(role)}` (FR-003).
- [x] T8b · `lib/comandas/mesa-demora.ts` — `tableDelay` saltea las anuladas, con `cancelled_at` opcional en `DelayComanda` (FR-005). Apareció implementando: sin esto la mesa queda con demora infinita apenas se anula.

## Tests

- [x] T9 · `src/components/mozo/order-summary-card.test.tsx` **(nuevo)** — la acción aparece para encargado sobre una comanda activa; **no** aparece con `canAnular={false}`, ni sobre una entregada, ni sobre una anulada; la anulada se pinta **Anulada** y sin Entregar; confirmar con motivo llama a `cancelarComanda` con `(slug, id, motivo)`; motivo vacío no llama.
- [x] T9b · `mesa-demora.test.ts` — una comanda anulada no genera demora (FR-005).

## Cierre

- [x] T10 · `pnpm typecheck` + `pnpm test` + `pnpm lint` en verde.
- [x] T11 · Commit `feat(salon): …` con `Closes #119`, tildar tasks, actualizar la feature page del brain y loggear.
- [ ] T12 · Verify en vivo con rol real (encargado) — anular desde Mesas y confirmar el ticket ANULADA en la comandera.
