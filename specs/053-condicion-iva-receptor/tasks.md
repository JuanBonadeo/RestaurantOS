# Tasks — 053 Condición de IVA del receptor (B con CUIT + fix hardcode)

> **Nota (2026-08-03):** tildado retroactivamente. Estas tasks se implementaron y shippearon pero el archivo nunca se actualizó; el estado se reconstruyó desde el código y la issue cerrada. Lo que sigue sin tildar es lo que realmente falta (verify en vivo con rol real).


TDD: la lógica pura (`condicionIvaFor`) y el guard de emisión arrancan con test rojo. Los tests de integración corren contra la DB cloud real (patrón `emit-invoice.integration.test.ts`: `@vitest-environment node`, seed de business + afip config + gateway credentials mockeadas / provider sandbox).

## Migración y tipos

- [x] **T001** Verificar el máximo real de `supabase/migrations/` (hay sesiones paralelas) y crear `00NN_condicion_iva_receptor.sql` con el siguiente número libre (esperado `0020`): `ALTER TABLE invoices ADD COLUMN condicion_iva_receptor smallint` + comment + CHECK `in (1,4,5,6) or null`.
- [x] **T002** Aplicar la migración al cloud (MCP `apply_migration`) + `pnpm db:types` → confirmar `condicion_iva_receptor` en `database.types.ts`.
- [x] **T003** `InvoiceRequest.condicionIvaReceptor?: CondicionIvaReceptor` en `src/lib/afip/types.ts` (`CondicionIvaReceptor` ya existe, no tocar).

## Lógica pura — TESTS PRIMERO

- [x] **T004** [test rojo] `gateway-payload.test.ts`: `condicionIvaFor(tipo, explicit)` — (a) explicit=6 → 6 para B y para A; (b) explicit ausente + A → 1; (c) explicit ausente + B → 5. Falla con la firma actual.
- [x] **T005** Implementar `condicionIvaFor(tipo, explicit)` en `gateway-payload.ts` + pasar `req.condicionIvaReceptor` en `buildGatewayPayload` (`:82`). T004 verde.
- [x] **T006** [test rojo→verde] `gateway-payload.test.ts`: el payload resultante lleva `condicion_iva` = el explícito cuando está, `doc_tipo=80` con CUIT / `99` sin CUIT.

## Server action `emit-invoice` — TESTS PRIMERO

- [x] **T007** [test rojo] Integración: `emitInvoice({ tipo:'factura_b', cuitReceptor, condicionIvaReceptor:6 })` → fila `invoices.condicion_iva_receptor=6` y el provider recibe `condicion_iva=6`. Falla hoy (blindaje rechaza B+CUIT).
- [x] **T008** [test rojo] `emitInvoice` B+CUIT **sin** `condicionIvaReceptor` → `actionError` claro, cero fila `pending`. (Define el nuevo guard.)
- [x] **T009** [test rojo] Regresión-guard: `emitInvoice` B **sin** CUIT → `condicion_iva=5`, `doc_tipo=99`, byte-idéntico a hoy. (Reusar/mirar `emit-invoice.integration.test.ts` existente — debe seguir verde sin editar.)
- [x] **T010** [test rojo] Validación: `condicionIvaReceptor` fuera de `{1,4,5,6}` → rechazo por Zod, no llega al provider.
- [x] **T011** Implementar en `emit-invoice.ts`: `EmitInput.condicionIvaReceptor` + Zod; **quitar** blindaje `186-190`; **nuevo guard** (B/NC-B + CUIT + sin condición → error); persistir en el `.insert` (`220-238`); pasar en el `enqueue` de emisión (`269-280`). T007–T010 verde.

## Retry y anulación (leen de la fila) — TESTS PRIMERO

- [x] **T012** [test rojo] `retryInvoice` sobre una fila con `condicion_iva_receptor=6` (forzar `failed`) → el segundo `enqueue` lleva `condicion_iva=6` (leído de la fila, no del tipo).
- [x] **T013** [test rojo] `anularFactura` de una B autorizada con `condicion_iva_receptor=6` → la NC-B se declara con `condicion_iva=6`.
- [x] **T014** [test rojo] Fila histórica (`condicion_iva_receptor=NULL`) → retry/anulación caen al default por tipo (A→1, B→5), sin romper.
- [x] **T015** Implementar el pass-through en `retryInvoice` (`~487-495`) y `anularFactura` (`~638-648`): `condicionIvaReceptor: <row>.condicion_iva_receptor ?? undefined`. T012–T014 verde.

## Fix del hardcode espejo (A)

- [x] **T016** [test rojo→verde] `emitInvoice({ tipo:'factura_a', cuitReceptor, condicionIvaReceptor:6 })` → `condicion_iva=6`; sin `condicionIvaReceptor` → `1` (retrocompat A). Cubierto por T004/T007 si se parametriza por tipo; si no, test dedicado.

## UI

- [x] **T017** `cobrar-client.tsx`: estado `condicionIva`, selector (RI/Monotributo/Exento/CF) visible cuando hay CUIT, default 1 en A / 6 en B; habilitar input de CUIT en tipo B; pasar `condicionIvaReceptor` a `emitInvoice` (`953-959`); reset al quitar CUIT.
- [x] **T018** `pedido-flash-dialog.tsx` (`:70`) e `invoice-detail-sheet.tsx` (`:115`): agregar selector cuando el flujo capture CUIT + pasar el campo. Sin CUIT → sin selector, sin regresión.

## Cierre

- [x] **T019** `pnpm typecheck` + `pnpm test` en verde (incluye `emit-invoice.integration.test.ts` sin tocar).
- [ ] **T020** **Verify en vivo** con rol real (encargado/mozo) contra el gateway en **sandbox**: emitir B con CUIT + Monotributo, confirmar que el comprobante declara la condición correcta; probar retry y anulación. Confirmar que B sin CUIT sigue igual.
- [x] **T021** Actualizar `wiki/features/facturacion.md` (condición de IVA del receptor) + `wiki/log.md`; nota en `wiki/decisions/` si corresponde.
- [x] **T022** Comentar en el issue [#51](https://github.com/gachetponzellini/RestaurantOS-app/issues/51): R-C6 cerrado, sin ítems pendientes → **cerrar #51**. Tildar tasks.

## Notas de QA (aprendidos a vigilar)

- **Persistencia obligatoria**: si `condicion_iva_receptor` no se guarda, el retry/NC re-introduce el bug. El test T012/T013 es el que lo caza.
- **Regresión del camino feliz**: el test de integración B-a-consumidor-final existente debe pasar **sin editarlo**. Si hay que tocarlo, algo cambió en el default → revisar.
- **Ningún caller sin cubrir**: los tres (`cobrar`, `pedido-flash`, `invoice-detail`) llaman `emitInvoice`. Dejar uno sin el selector, con CUIT habilitado, re-abre el agujero.
- **A verificar con Juan** (ver spec, Edge Cases): ¿se permite B con CUIT + Consumidor Final elegido a mano, o se fuerza una condición "identificada"? Y default del selector en B (¿Monotributo o pedir siempre elección explícita sin default?).
