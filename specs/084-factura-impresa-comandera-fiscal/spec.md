# Feature Specification: Factura impresa en la comandera fiscal

**Feature Branch**: `084-factura-impresa-comandera-fiscal`

**Created**: 2026-08-04

**Status**: ✅ Implementado (2026-08-04) — migración 0035 aplicada al cloud, `pnpm typecheck` en verde, `pnpm test` 1369 pass (16 archivos rojos = `*.integration.test.ts` sin stack local, cero assertions fallidas). **Pendiente:** T019 (botón al cobrar, esperando spec 062), T021–T023 — incluido el **verify del QR contra la impresora real**. Issue [#133](https://github.com/gachetponzellini/RestaurantOS-app/issues/133). Milestone: Post-demo · Growth & hardening.

**Input**: Pedido de Juan 2026-08-04 — *"ahora lo mismo que hiciste para imprimir esto, habría que hacerlo para imprimir las facturas, cuando el encargado toque manualmente, para esto habría que configurar la comandera fiscal"*. Decidido con Juan (misma fecha): botón **en el detalle de la factura y al cobrar**, y **una comandera fiscal por caja**.

Tercera de la familia: [063](../063-comanda-de-control-delivery/) (control de pedido) → [080](../080-cuenta-impresa-para-el-cliente/) (cuenta) → ésta. Comparte `print_jobs` y el pipeline del print-agent.

## Contexto y problema

La factura ya se **emite** contra ARCA (gateway propio, spec 3 + reemplazo de TusFacturas) y queda en `invoices` con todo lo que la hace válida: `cae`, `cae_vencimiento`, `punto_venta`, `numero`, `tipo_comprobante`, los importes discriminados y —clave— la `qr_url` de ARCA que persiste la migración [0003](../../supabase/migrations/0003_afip_gateway.sql).

Lo que **no** existe es imprimirla. Hoy el comprobante vive en pantalla y en el `pdf_url` del gateway. El cliente que pide factura se va sin papel, o alguien la manda por mail.

## Decisiones de diseño

### D1 — La factura se **renderiza**, no se imprime el PDF del gateway

`invoices.pdf_url` existe, pero una térmica ESC/POS no imprime un PDF: recibe bytes de texto y comandos, no un documento. Así que el ticket fiscal se arma con el mismo renderer que los otros dos, tomando los datos de `invoices`.

### D2 — El QR de ARCA se imprime como QR de verdad, no como URL

Un comprobante electrónico argentino lleva el **QR de ARCA** (RG 4892). Escribir la URL en texto no cumple: el QR tiene que ser escaneable.

ESC/POS tiene comandos nativos de QR (`GS ( k`, funciones 165/167/169/180/181), así que se agrega un tipo de línea `qr` al renderer y `renderEscPos` emite esos bytes. **El agente del local no se toca**: ya imprime `content_escpos_b64` tal cual, y esto son más bytes en el mismo stream.

⚠️ **Riesgo a verificar en vivo:** las térmicas viejas sin soporte de `GS ( k` ignoran la secuencia y salen sin QR. Hay que probarlo contra la impresora real de golf antes de darlo por bueno (T-verify).

### D3 — Comandera fiscal **por caja**

Pedido de Juan. `cajas.fiscal_printer_*`. La caja sale de la factura: `invoices.payment_id` → `payments.caja_id`. Si la factura no tiene pago asociado (`payment_id` es nullable), cae a la **caja por defecto** del negocio (`cajas.is_default`, migración 0025). Sin comandera en la caja resuelta, no imprime y el encargado se entera en el acto.

### D4 — `print_jobs` suma `kind = 'factura'` y apunta a la factura, no a la orden

`print_jobs.order_id` pasa a ser nullable y se suma `invoice_id`, con un check que obliga a que cada `kind` tenga su objetivo:

```sql
check (
  (kind in ('control','cuenta') and order_id  is not null) or
  (kind = 'factura'             and invoice_id is not null)
)
```

Una factura puede no tener orden (nota de crédito, comprobante suelto), así que colgarla de `order_id` sería mentira.

## ⚠️ Gap legal conocido (fuera del alcance técnico de esta spec)

Un ticket fiscal argentino tiene que llevar datos del **emisor** que hoy **no guardamos**: ingresos brutos, fecha de inicio de actividades y domicilio comercial fiscal. En `businesses` sólo hay `afip_cuit`, `name` y `address`.

Esta spec imprime **todo lo que sí tenemos** (razón social, CUIT, punto de venta y número, tipo, fecha, importes, CAE + vencimiento, QR, datos y condición IVA del receptor). El ticket que sale **no es todavía un comprobante completo** según la normativa: le faltan esos tres campos.

Cerrarlo es agregar tres columnas a `businesses` y tres inputs en Ajustes → Facturación. **No lo hago acá porque son datos fiscales reales del cliente que hay que pedirle a Martín**, y meter placeholders en un comprobante sería peor que no imprimirlo. Queda como issue aparte y **bloqueante para usar esto en producción con clientes reales**.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — El encargado imprime la factura recién emitida (Priority: P1)

Como **encargado**, termino de cobrar la mesa 12 con Factura B. Apenas ARCA la autoriza, toco «Imprimir factura» y sale en la comandera fiscal de mi caja, con el QR, para dársela al cliente que está esperando.

**Acceptance**:
1. El botón aparece al terminar de cobrar, cuando la factura quedó `authorized`.
2. Sale en la comandera fiscal de **la caja del pago** de esa factura.
3. El ticket lleva el QR de ARCA escaneable.
4. Una factura `pending` o `failed` **no** se puede imprimir — el botón lo dice.

### User Story 2 — Reimprimir una factura de más temprano (Priority: P1)

Como **encargado**, el cliente vuelve al rato y pide la factura de nuevo. La busco en Facturación, abro el detalle y toco «Imprimir factura».

**Acceptance**:
1. El botón está en el detalle de la factura, en Facturación.
2. Se puede tocar las veces que haga falta.
3. De la segunda en adelante el ticket sale marcado **«REIMPRESIÓN»**. Es una copia del mismo comprobante, no uno nuevo: el número y el CAE son los mismos.

### User Story 3 — El encargado configura la comandera fiscal de cada caja (Priority: P2)

Como **encargado**, en Ajustes → Operación del local le pongo a cada caja la IP de su comandera fiscal.

**Acceptance**:
1. Una fila por caja, con IP + puerto + switch, junto al resto de las comanderas.
2. Caja sin IP = esa caja no imprime facturas, y el error lo dice con el nombre de la caja.
3. Solo admin/encargado.

## Requisitos funcionales

- **FR-001** `cajas.fiscal_printer_ip / _port / _enabled`.
- **FR-002** `print_jobs.kind` admite `factura`; `order_id` pasa a nullable y se suma `invoice_id`, con el check de D4.
- **FR-003** `resolveFiscalPrinter`: caja del pago de la factura → si la factura no tiene pago, caja por defecto del negocio → si esa caja no tiene comandera o está apagada, null.
- **FR-004** Action `imprimirFactura(invoiceId, slug)`: gate admin/encargado (`canManageBusiness`), exige `status = 'authorized'`, scope por `business_id`, resuelve la comandera **antes** de insertar y nombra la caja en el error.
- **FR-005** El job se marca `reprint` si ya hay un `print_job` de `kind='factura'` para esa factura.
- **FR-006** `renderEscPos` soporta líneas de tipo `qr` y emite los comandos `GS ( k` nativos; `renderPlain` cae a la URL en texto.
- **FR-007** El ticket lleva: razón social + CUIT del emisor, tipo + punto de venta + número, fecha, receptor (CUIT/razón social/condición IVA) cuando está, detalle de importes con IVA discriminado **sólo** en las A, total, CAE + vencimiento, y el QR.
- **FR-008** El `GET /api/print-agent` resuelve la comandera de los jobs `factura` y saltea los que no tienen destino.

## Éxito medible

- **SC-001** Imprimir dos veces la misma factura produce dos jobs; el segundo sale marcado reimpresión, con el mismo número y CAE (test).
- **SC-002** Una factura `pending` o `failed` se rechaza (test).
- **SC-003** La factura sale en la comandera de la caja de su pago; sin pago, en la de la caja por defecto (test).
- **SC-004** El stream ESC/POS contiene la secuencia de QR con la `qr_url` de la factura (test sobre los bytes).
- **SC-005** El agente no se recompila.
- **SC-006** `pnpm typecheck` + `pnpm test` en verde.

## Fuera de alcance

- Los tres campos fiscales del emisor que faltan (ver el gap de arriba) — issue aparte, bloqueante para producción.
- Imprimir automáticamente al autorizar. Juan pidió manual.
- Imprimir el `pdf_url` del gateway (una térmica no imprime PDFs).
- Notas de crédito con un formato propio: por ahora usan el mismo ticket con su tipo.
