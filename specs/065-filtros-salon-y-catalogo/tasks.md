# Tasks — 065 · Filtro por salón en el operativo + filtros persistidos en el catálogo

- [x] **T001** Tests rojos de [`use-sticky-filter.test.ts`](../../src/lib/ui/use-sticky-filter.test.ts): sin preferencia arranca en el fallback, respeta la guardada, valor guardado que ya no existe cae al fallback, `set` persiste, volver al fallback borra la clave, storage roto no rompe.
- [x] **T002** `src/lib/ui/use-sticky-filter.ts`: hook genérico `[value, setValue]` con clave de storage, fallback y **lista de opciones válidas** (firma estable, sin loops de effect); inicial sincrónico = fallback (sin mismatch de hidratación), preferencia aplicada en effect.
- [x] **T003** `local-query.ts`: `LocalComanda.floor_plan_id` (select `tables(label, floor_plan_id)` + mapeo).
- [x] **T004** Tests de [`salon-filter.test.ts`](../../src/lib/admin/salon-filter.test.ts) + [`counts.test.ts`](<../../src/app/[business_slug]/admin/(authed)/operacion/counts.test.ts>): los tres contadores con `salonId` (incluye comanda sin mesa y reserva sin mesa ni zona).
- [x] **T005** `src/lib/admin/salon-filter.ts`: `SALON_ALL`, `matchesSalon`, `reservaSalonId` (puros, compartidos entre tabs y pills); `counts.ts` los usa y acepta `salon`.
- [x] **T006** `operacion/page.tsx` + `getSalonOptions`: resolver los salones (id + nombre) y pasarlos a `LocalShell`.
- [x] **T007** `local-shell.tsx`: selector de salón persistido, visible sólo en Mesas / Comandas / Reservas, propagado a los tres paneles y a las pills.
- [x] **T008** `salon-desktop.tsx`: prop `pinnedPlanId` — fija el plano, esconde el selector interno y limpia la mesa seleccionada al cambiar.
- [x] **T009** `comandas-kanban.tsx`: filtro por salón compuesto con "solo fallidas" (kanban + saturación + alerta miran el mismo subconjunto) + aviso «N comandas de delivery / mostrador ocultas».
- [x] **T010** `admin-day-list.tsx`: prop `salonId`, filtrado por mesa → zona → sin zona, aplicado una vez arriba (KPIs, chips y lista no pueden discrepar).
- [x] **T011** `catalog-client.tsx` + `catalog-shell.tsx`: filtros categoría / estado / sector persistidos, «Limpiar filtros», vacío explicativo; búsqueda sin persistir.
- [x] **T012** `pnpm typecheck` + `pnpm lint` + `pnpm build` verdes; `pnpm test` 863 pass / 140 skip (los 16 archivos `*.integration.test.ts` fallan por falta del stack Supabase local — preexistente, no lo toca esta spec).
- [x] **T013** Wiki: [`features/admin.md`](../../../wiki/features/admin.md), [`features/comandas.md`](../../../wiki/features/comandas.md) y [`features/carta.md`](../../../wiki/features/carta.md).
- [ ] **T014** Verify en vivo con rol real (encargado de golf-jcr): elegir un salón, refrescar, chequear Mesas / Comandas / Reservas + el aviso de ocultas; y filtros del catálogo sobrevivientes a navegar a un producto y volver.
