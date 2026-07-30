# Tasks — 074 · Opciones que habilitan (o no) otros grupos del menú del día

Sin issue todavía. Ver [`spec.md`](spec.md).

## Datos

- [ ] T1 · Migración `0033_menu_grupos_condicionales.sql` — `daily_menu_components.blocks_choice_group_ids uuid[] not null default '{}'`. Aplicar al cloud vía MCP `apply_migration` + `pnpm db:types` (⚠️ el CLI no está linkeado: regenerar tipos por MCP, ver memoria `db-types-cli-no-linkeado`).

## Lógica pura (TDD — primero el test)

- [ ] T2 · `src/lib/mozo/daily-menu-steps.ts` — `activeChoiceGroups(groups, selections)`: punto fijo sobre los bloqueos de lo elegido. `buildMenuSteps` pasa a recibir las selecciones (FR-003). Tests: sin bloqueos = comportamiento actual; opción que bloquea el grupo siguiente; opción que bloquea dos; cadena de dos niveles; bloqueo de un grupo ya elegido.
- [ ] T3 · `src/lib/mozo/daily-menu-steps.ts` — `pruneBlockedSelections(groups, selections)` (FR-004): borra de `selections` todo lo que quedó en un grupo inactivo. Invariante a testear: aplicar dos veces da lo mismo (idempotente).
- [ ] T4 · `src/lib/orders/combo-choices.ts` **(nuevo)** — `validateComboChoices(components, selectedChoices)`: exactamente una por grupo activo (cierra D-MDR-4, D-GCM-5), ninguna de un grupo bloqueado, cada opción en su grupo. Casos: grupo faltante, grupo duplicado, elección de grupo bloqueado, payload vacío en menú sin grupos, opción inexistente. **Toca plata → test primero.**

## Server (FR-006)

- [ ] T5 · `combo-pricing.ts` — `resolveComboUpcharge` se apoya en `validateComboChoices` (o la llama antes) para que ningún grupo bloqueado aporte `extra_price_cents`.
- [ ] T6 · Enganchar en los **dos** caminos: `comandas/actions.ts` (mozo) y `orders/persist-order.ts` (web/delivery). Rechazo = orden entera, sin persistir nada.

## Admin (FR-001, FR-002)

- [ ] T7 · `daily-menus/schemas.ts` — `blocks_choice_group_ids` en `DailyMenuComponentInput`; `superRefine` en `DailyMenuInput`: sólo grupos posteriores por `sort_order`, con el mensaje de FR-002.
- [ ] T8 · Editor del menú del día — checks por opción, uno por grupo posterior, rotulados con `choice_group_label`. Tildado por default.
- [ ] T9 · Warning (no bloqueo) cuando un grupo queda bloqueado por **todas** las opciones de un grupo anterior — mismo criterio que `warnGarnishModifierGroups`.

## Mozo y carta pública (FR-003, FR-004, FR-005, FR-007)

- [ ] T10 · `daily-menu-wizard.tsx` — pasos recalculados en vivo, progreso sobre los grupos activos, prune al volver atrás y cambiar.
- [ ] T11 · `menu.ts` + formulario del menú del día en `(public)` — misma función pura, mismo condicionamiento para el cliente final.
- [ ] T12 · Resumen final, `daily_menu_snapshot` y comanda: el grupo bloqueado no aparece (FR-007).

## Cierre

- [ ] T13 · `pnpm typecheck` + `pnpm test` en verde.
- [ ] T14 · Verificar en vivo con el **rol real** (encargado y mozo), no service_role: menú con Principal + Guarnición donde una opción la bloquea; cargar, enviar comanda, ver la impresión y la cuenta.
- [ ] T15 · Actualizar `wiki/features/menu-del-dia.md` (nueva decisión D-MDR-7 o serie D-GCM), `wiki/log.md`, crear la issue y cerrarla.
