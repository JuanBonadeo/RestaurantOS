# Feature Specification: Cocina no miente

**Feature Branch**: `095-cocina-no-miente`

**Created**: 2026-08-05

**Status**: ✅ Implementada · falta verificación en vivo

**Issue**: #147

**Fuente**: [auditoría de estados de pedidos](../../../wiki/analyses/estados-de-pedidos-auditoria.md) — H-14, H-28, H-32, H-36, H-37, H-50, H-54.

## Contexto y problema

Siete defectos con la misma forma: **la pantalla de cocina y las comanderas siguen mostrando e imprimiendo cosas que ya se anularon o se cobraron.** Ninguno es de plata directamente, pero todos erosionan lo mismo — que el cocinero pueda confiar en la pantalla.

| | Qué pasaba |
|---|---|
| **H-32** | `getActiveComandas` filtraba sólo por `comandas.status`, **sin cutoff temporal** (a diferencia de la columna de entregadas) y el cobro no cierra comandas. La pantalla acumulaba tickets de mesas que pagaron hace días: en una semana «En preparación» tenía 40 comandas fantasma y **el cocinero dejaba de mirarla**. |
| **H-28** | El ACK del print-agent ni siquiera seleccionaba `cancelled_at`: **el acuse de que se imprimió el ticket «ANULADA» era lo que movía la comanda de `pendiente` a `en_preparacion`**. En el cloud había 6 comandas con `cancelled_at` y **5 en `en_preparacion`**. |
| **H-14** | `getComandasByOrder` no traía `cancelled_at`, así que en la app del mozo la tanda anulada mostraba el botón verde sin ningún cartel. El mozo lo tocaba y la comanda aparecía en «Entregadas». **El estado imposible ya existía en producción** (`cancelled_at` + `status='entregado'` + `delivered_at`). |
| **H-36** | Encolar la reimpresión era un gesto de **UI**: sólo el modal «Editar comanda» del kanban encadenaba `solicitarReimpresion`. Desde la app del mozo o la pantalla de cuenta no se tocaba nada, así que cocina se quedaba con el papel colgado, preparaba el plato y lo mandaba. |
| **H-37** | `imprimirCuenta` exige `lifecycle='open'` **al encolar**, pero el armador del GET no lo repetía y ningún write-site cancela filas de `print_jobs`. Reponían el papel media hora después y salía la cuenta de una mesa anulada, con el total viejo. |
| **H-54** | Lo mismo con la comandera fiscal: se anulaba la factura, se emitía la NC, y después salía el ticket de la anulada **con CAE y QR**. |
| **H-50** | `marcarComandaEntregada` pisaba el `kitchen_status` de ítems cancelados. El mismo archivo aplicaba dos criterios: `advanceItemKitchenStatus` sí los excluye. |

## Decisiones de producto

| Pregunta | Decisión |
|---|---|
| ¿El filtro de comandas activas se hace por tiempo o por estado de la cuenta? | **Por estado de la cuenta** (`orders.lifecycle_status = 'open'`). Un cutoff temporal es arbitrario y esconde el problema real: la comanda de una mesa cobrada no tiene nada que hacer en cocina, tenga 5 minutos o 5 días. |
| ¿La reimpresión se encola desde la UI o desde el server? | **Desde el server**, en la action. Que dependiera del componente es por qué existían tres caminos de cancelación y sólo uno avisaba. `cancelarComanda` ya lo hacía bien; esto empareja los otros dos. |
| ¿El armador del GET vuelve a validar lo que el encolado ya validó? | **Sí.** El job vive en la cola indefinidamente y el mundo cambia mientras tanto — es la diferencia entre validar al encolar y validar al servir. |

## Requisitos

- **FR-001** `getActiveComandas` filtra `orders.lifecycle_status = 'open'` **y** `cancelled_at is null`.
- **FR-002** El ACK del print-agent no promueve una comanda anulada: limpia sólo los flags laterales.
- **FR-003** `getComandasByOrder` trae `cancelled_at`, y `marcarComandaEntregada` rechaza una comanda anulada en el server.
- **FR-004** `marcarComandaEntregada` no pisa el `kitchen_status` de ítems cancelados.
- **FR-005** Helper `encolarReimpresionDeItem` en `comandas/reprint.ts`, usado por `cancelarItem` (kanban) y `cancelarItemEnCuenta`. Best-effort: no puede tumbar la cancelación, que es lo que el encargado pidió.
- **FR-006** El armador de `print_jobs kind='cuenta'` exige `orders.lifecycle_status = 'open'`.
- **FR-007** El armador de `print_jobs kind='factura'` exige `invoices.status = 'authorized'`.

## Verify

- `pnpm typecheck` ✅ · `pnpm test` ✅ **1609 tests, 0 rojos** con stack local · eslint limpio.
- Tests nuevos: `cocina-no-miente.integration.test.ts` (4, contra Postgres real) — las comandas de una mesa cobrada y de una anulada salen del kanban, una comanda anulada no aparece, y la cuenta de una mesa anulada no se sirve al print-agent.

**Lo que NO está verificado:**

- **Nada en vivo con el print-agent.** Todo lo de papel sale del código del endpoint, no de la PC del local. El caso que más conviene mirar es H-37/H-54: **reponer papel con jobs viejos en cola** y confirmar que no sale nada que no corresponda.
- **El badge «ANULADA» en la app del mozo no se agregó.** El server ya rechaza (FR-003), así que el estado imposible no se puede volver a crear, pero el mozo todavía ve el botón verde y se entera por el error. Falta la UI.
- **H-28 no tiene test propio**: el handler del print-agent necesita el harness del endpoint (auth por API key + payload del agente). La rama es de tres líneas y está leída, no ejercitada.
- **Las 5 comandas del cloud con `cancelled_at` + `en_preparacion` siguen así.** El fix corta el camino que las produce; no las limpia. Salen solas del kanban por FR-001, así que no molestan — pero el dato queda sucio.
