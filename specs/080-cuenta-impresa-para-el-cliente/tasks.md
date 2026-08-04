# Tasks: 080 — Cuenta impresa para darle al cliente

Leyenda: `[ ]` pendiente · `[x]` hecho.

## Datos
- [x] **T001** Migración `0034_print_jobs_y_cuenta_impresa.sql`: tabla `print_jobs` con `kind` + índice único **parcial** sobre `order_id` sólo para `kind='control'` + índices de pull y de reimpresión + RLS (FR-001).
- [x] **T002** Migrar `control_tickets` → `print_jobs` (`insert … select`) y dropearla (FR-002).
- [x] **T003** `businesses.cuenta_printer_*` y `floor_plans.cuenta_printer_*` (FR-003).
- [x] **T004** Aplicar al cloud vía MCP + tipos generados. Verificado: las 2 filas de control migraron.

## Resolución de comandera
- [x] **T005** `print/cuenta-printer.ts`: `resolveCuentaPrinter` puro (salón apagado → nada · salón con IP → salón · salón sin IP → negocio · ninguna → nada) (FR-004). Módulo aparte del action porque en un archivo `"use server"` todo export tiene que ser async.
- [x] **T006** Tests de los 7 caminos, incluido el del salón apagado con el negocio prendido (SC-003).

## Render
- [x] **T007** `print/cuenta-ticket.ts`: `CuentaTicketData` + `buildCuentaTicketLines` + `buildCuentaTicketContent`, reusando los primitivos de `ticket.ts` (FR-007).
- [x] **T008** Tests de render: mesa/salón/detalle · TOTAL destacado · descuento con motivo · pago parcial muestra «Pagado» y «RESTA» · propina incluida vs. aviso de que no lo está · marca de reimpresión · pie de no-factura · ASCII.

## Emisión
- [x] **T009** Action `imprimirCuenta(tableId, slug)`: gate de mozo, defensa cross-tenant vía `floor_plans`, exige orden abierta con total > 0, resuelve la comandera **antes** de insertar y devuelve error nombrando el salón (FR-005).
- [x] **T010** Marca `reprint` contando los `print_jobs` de `kind='cuenta'` previos de esa orden (FR-006, SC-001).

## Print-agent
- [x] **T011** `GET`: `buildPrintableCuentaTickets` suma las cuentas pendientes al array `comandas`, con `station_name: "CUENTA"` y la comandera resuelta por salón; saltea las que no tienen destino (FR-009).
- [x] **T012** `GET`/`POST` de control migrados a `print_jobs` filtrando por `kind`; `handleControlTicketReport` → `handlePrintJobReport`, que ahora sirve a los dos tipos (SC-004: el contrato con el agente no cambia de forma).
- [x] **T013** Tests de 063 adaptados a `print_jobs`, en verde sin cambiar lo que asertan.

## Configuración
- [x] **T014** `setCuentaPrinter` (negocio) y `setFloorPlanCuentaPrinter` (salón, scopeado por `business_id`), reusando `StationPrinterInput`.
- [x] **T015** `CuentaPrintersForm` en Ajustes → Operación del local: fila del local + una por salón, cada una diciendo si tiene la suya, si hereda o si está apagada (FR-009, US3).

## Cliente
- [x] **T016** Botón «Imprimir cuenta» en la pantalla de la cuenta del mozo, arriba de «Dividir cuenta», con toast distinto para impresión y reimpresión (US1).

## Cierre
- [x] **T017** `pnpm typecheck` + `pnpm test` en verde (1278 pass; los 16 archivos rojos son `*.integration.test.ts` que no levantan por `ECONNREFUSED 127.0.0.1:54321` — el stack local apagado, no hay assertions fallidas).
- [ ] **T018** Actualizar `wiki/features/cobros.md` / `pedidos.md`; log en `wiki/log.md`.
- [ ] **T019** Verify en vivo con el print-agent: configurar la comandera de un salón, abrir una mesa, «Imprimir cuenta», y tocarlo de nuevo para ver la marca de reimpresión.
