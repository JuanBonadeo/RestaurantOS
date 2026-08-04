# Tasks: 084 — Factura impresa en la comandera fiscal

Leyenda: `[ ]` pendiente · `[x]` hecho.

## Datos
- [x] **T001** Migración `0035_factura_impresa_comandera_fiscal.sql`: `print_jobs.kind` admite `factura`, `order_id` pasa a nullable, se suma `invoice_id` y el check que obliga a cada kind a apuntar a lo suyo (FR-002).
- [x] **T002** `cajas.fiscal_printer_ip / _port / _enabled` (FR-001).
- [x] **T003** Aplicar al cloud vía MCP + tipos generados.

## Render
- [x] **T004** Soporte de **QR nativo** en `ticket.ts`: `Line.qr`, `escPosQr()` con los comandos `GS ( k` (165/167/169/180/181), y `renderPlain` cayendo a la URL (FR-006).
- [x] **T005** `print/factura-ticket.ts`: emisor, tipo + código de ARCA + `0003-00001234`, fecha, receptor con condición IVA, IVA discriminado sólo en las A, total, CAE + vencimiento y el QR (FR-007).
- [x] **T006** Tests de contenido: código por tipo · A discrimina / B no · CAE y vencimiento · «(sin CAE)» · receptor vs. consumidor final · reimpresión con el mismo número y CAE · notas de crédito.
- [x] **T007** Tests **sobre los bytes** del stream: la secuencia de QR está presente con la URL, `pL`/`pH` valen `len+3` en little-endian (el bug clásico de ESC/POS), y sin `qr_url` no se emite ninguna secuencia (SC-004).

## Resolución de comandera
- [x] **T008** `print/fiscal-printer.ts`: `resolveFiscalPrinter(caja)` puro, **sin fallback al negocio** — el papel fiscal sale donde está el que cobra (FR-003).
- [x] **T009** Tests: caja con IP · apagada · sin IP · sin caja · puerto default.

## Emisión
- [x] **T010** Action `imprimirFactura(invoiceId, slug)`: gate `canManageBusiness`, exige `status='authorized'` con mensaje distinto para `pending`, scope por `business_id`, resuelve la comandera antes de insertar y nombra la caja en el error (FR-004).
- [x] **T011** `resolveCajaForInvoice`: caja del pago → si la factura no tiene pago, caja por defecto (`is_default`).
- [x] **T012** Marca `reprint` contando los `print_jobs` de `kind='factura'` previos de esa factura (FR-005).

## Print-agent
- [x] **T013** `buildPrintableFacturaTickets` en el `GET`, con `station_name: "FISCAL"`; saltea los jobs sin destino (FR-008).
- [x] **T014** **Aislar las tres familias de papel** (`safePrintables`): un bug armando control / cuenta / factura ya no puede dejar a cocina sin comandas. Salió de un fallo real de los tests de 063 al sumar esta rama.
- [x] **T015** Mock de los tests de 063 hecho consciente del `kind` (el `GET` ahora consulta `print_jobs` tres veces).

## Configuración
- [x] **T016** `setCajaFiscalPrinter`, scopeada por `business_id`, reusando `StationPrinterInput`.
- [x] **T017** `FiscalPrintersForm` en Ajustes → Operación del local: una fila por caja activa, marcando cuál es la de por defecto.

## Cliente
- [x] **T018** Botón «Imprimir factura» en el detalle de Facturación, sólo en `authorized`, con toast distinto para copia (US2).
- [ ] **T019** Botón al terminar de cobrar, cuando la factura queda autorizada (US1 ac. 1). **Pendiente**: el panel de cobro lo está reescribiendo otra sesión (spec 062), así que engancharlo ahí ahora sería pisarse.

## Cierre
- [x] **T020** `pnpm typecheck` + `pnpm test` en verde (1369 pass; los 16 archivos rojos son `*.integration.test.ts` que no levantan por `ECONNREFUSED 127.0.0.1:54321`, stack local apagado).
- [ ] **T021** Actualizar `wiki/features/facturacion.md`; log en `wiki/log.md`.
- [ ] **T022** ⚠️ **Verify en vivo del QR**: probar contra la térmica real de golf que la secuencia `GS ( k` sale como QR escaneable. Una impresora vieja sin soporte la ignora y el comprobante sale sin QR.
- [ ] **T023** ⚠️ Bloqueante de producción: los tres datos fiscales del emisor que faltan — issue [#134](https://github.com/gachetponzellini/RestaurantOS-app/issues/134).
