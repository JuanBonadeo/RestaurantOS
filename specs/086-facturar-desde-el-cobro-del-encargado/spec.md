# Feature Specification: Facturar desde el cobro de mesa del encargado

**Feature Branch**: `086-facturar-desde-el-cobro-del-encargado`

**Created**: 2026-08-04

**Status**: ✅ Implementada

**Input**: Juan, 2026-08-04, probando ARCA en golf-jcr: *"no factura"* → *"es que no aparece la parte de emitir factura"* → *"pero si lo quiero hacer desde el encargado?"*.

**Issue**: #137

**Depende de**: [`006-cobro-y-propina`](../006-cobro-y-propina/spec.md) (el bloque de facturación post-cobro del mozo, que acá se comparte) · [`053-condicion-iva-receptor`](../053-condicion-iva-receptor/spec.md) (los datos del receptor que pide el formulario) · [`013-facturacion-arca-afip`](../../../wiki/specs/13-facturacion-arca-afip/spec.md) + su [addendum del gateway](../../../wiki/specs/13-facturacion-arca-afip/addendum-gateway.md) (el emisor async). **Hermana de #136**, que arregló el mismo síntoma en el mozo por otra causa.

## Contexto y problema

golf-jcr salió a producción con ARCA configurado y correcto —`afip_enabled`, modo producción, CUIT `30713234407`, punto de venta 1, credencial del gateway con `tenant_slug=golf`— y aun así la tabla `invoices` quedó **vacía** después de un día de mesas cobradas. En el gateway, el tenant `golf` registra **0 `invoice_jobs`**: nunca le llegó un pedido de emisión.

La causa no es config ni permisos: **la pantalla donde el encargado cobra no tiene UI de facturación**. `cobrar-desktop-client.tsx` son 627 líneas sin una sola ocurrencia de `factur|invoice|afip|comprobante`. Es el mismo componente que se monta embebido en el panel del salón, así que cubre los dos caminos por los que el encargado cobra una mesa.

Estaba asumido, no olvidado. `comprobante-fields.tsx:13-16` lo dice: *"facturar está en tres de los cuatro puntos de cobro (mozo, pedido y mostrador) — el único que no factura es el cobro de mesa del encargado"*. La suposición era que el encargado, si necesitaba emitir, iba a la sección **Facturación** del panel. Pero `permissions/sections.ts:74` le da `none` a esa sección, y su page-gate es `canManageBusiness` (admin / platform admin). El comentario que justifica ese `none` dice que el encargado emite *"en el flujo de cobro"* — la premisa es falsa, y las dos mitades del malentendido se tapan entre sí.

Resultado: **el encargado no tenía ninguna pantalla desde donde emitir un comprobante**. De los 4 pagos de golf-jcr del 2026-08-04, uno lo hizo una encargada real y tres un platform admin; los dos roles caen en esta pantalla.

## Decisiones de producto

| Pregunta | Decisión |
|---|---|
| ¿Nueva UI o la del mozo? | **La del mozo, compartida.** Se extrae `FacturacionSection` a `components/billing/` y la consumen los dos. El encargado pide los mismos datos de la misma forma, y las reglas de CUIT / condición IVA (spec 053) viven en un solo lugar. Mismo criterio que `ComprobanteFields` y `AnularComandaModal`. |
| ¿Factura automática al cobrar? | **No: explícita.** Igual que el mozo. La mayoría de las mesas no pide comprobante; emitir sin que lo pidan gasta numeración fiscal. El cobro de **pedido** (sin mesa) sí factura solo porque ahí el comprobante es el motivo del flujo. |
| ¿Qué pasa al terminar de cobrar? | La pantalla **no se cierra ni recarga** si el negocio factura. Es exactamente el bug de #136 en su versión desktop: la sección se monta con la misma condición que disparaba la salida. La salida pasa a ser el botón «Volver al salón», que ya existía. |
| ¿Y si el negocio no factura? | Todo queda como estaba: sin sección, y el cobro cierra y vuelve al salón como siempre. El gate es `afip_cuit && afip_punto_venta`, el mismo `afipConfigured` que usa el mozo. |
| ¿Se le da la sección Facturación al encargado? | **Fuera de alcance acá.** Es otra discusión (esa sección es config AFIP + libro de comprobantes, no emisión). Queda anotado como pendiente: hoy el encargado no puede repescar una mesa ya cobrada. |

## User Scenarios & Testing *(mandatory)*

### User Story 1 - El encargado cobra y factura (Priority: P1)

Como encargado, quiero emitir la factura apenas termino de cobrar la mesa, sin cambiar de pantalla ni pedirle a nadie que lo haga por mí.

**Independent Test**: con AFIP configurado, cobrar una mesa completa desde el panel (o desde el cobro embebido en el salón). Al saldarse, aparece «Mesa cobrada» y debajo «Emitir comprobante». Elegir Factura B y emitir → sale el CAE.

### User Story 2 - La pantalla espera (Priority: P1)

Como encargado, quiero que la pantalla no se me cierre sola apenas cobro, porque cargar un CUIT lleva más de un segundo y medio.

**Independent Test**: cobrar el total. Verificar que la pantalla se queda, que el cartel dice «Emití el comprobante o volvé al salón», y que la salida es el botón.

### User Story 3 - Local que no factura (Priority: P2)

Como mozo/encargado de un local sin AFIP, quiero que el cobro siga siendo de un solo paso.

**Independent Test**: sin `afip_cuit` / `afip_punto_venta`, cobrar una mesa. No aparece nada de facturación y la pantalla vuelve al salón como antes.

## Requisitos

- **FR-001** Con la mesa cobrada y AFIP configurado, el cobro del encargado muestra la sección de emisión de comprobante — en la página `/admin/mesa/[id]/cobrar` y en el panel embebido del salón.
- **FR-002** La sección es el mismo componente que usa el mozo (`components/billing/facturacion-section.tsx`), incluyendo el ciclo async del gateway: emitir → `pending` → polling → CAE, y reintento si falla.
- **FR-003** Al cerrarse la orden con AFIP configurado, la pantalla **no** navega ni refetchea. Un refetch la mataría igual que navegar: `getCuentaForTable` exige la orden `open`, así que devolvería "no hay cuenta".
- **FR-004** Sin AFIP configurado, el comportamiento previo se conserva exactamente (sin sección; cierre automático al cobrar).
- **FR-005** El estado que habilita la sección es el **cierre de la orden según el server** (`lifecycle_status !== 'open'`, o el `orderClosed` que devuelve el pago) — **nunca** `totalPending === 0`. Una orden **abierta con total 0** (mesa sin ítems, todo anulado, descuento del 100%) da saldo cero sin que nadie haya pagado y **no se cierra sola nunca** (`closeOrderIfFullyPaid` exige `total_cents > 0`): con el gate por suma del cliente se ofrecería emitir un comprobante fiscal de una mesa impaga.
- **FR-006** Con la orden cerrada no se listan las sub-cuentas ni se ofrece el panel de cobro: los splits vienen de `init` y quedaron viejos (no hay refetch, FR-003), así que mostrarían «Cobrar» habilitado sobre una mesa ya cobrada. Por lo mismo el total pagado se deriva del cierre, para que la barra y el gate de «Anular cobro» no mientan.
- **FR-007** El panel embebido también recibe el comprobante ya emitido. No alcanza con el guard del server: es por **tipo** (`invoices_order_tipo_active_uq`), así que sin este dato se podría emitir una Factura A sobre una orden que ya tiene una B. La query corre sólo si el negocio factura.

## Fuera de alcance

- Dar la sección **Facturación** al encargado (`sections.ts`) y sumarla al nav mobile.
- Facturar una orden **ya cerrada** (hoy no hay pantalla: `getCuentaForTable` filtra `open`). Es el mismo agujero que impide repescar las 4 mesas de golf-jcr ya cobradas.
- Botón "Facturar" en el detalle de un pedido pagado sin comprobante.

## Notas de implementación

Un review adversarial del diff (22 agentes) encontró **4 defectos reales en la primera versión**, todos corregidos antes de commitear:

1. **El gate era `totalPending === 0`** — matemática del cliente, violando el FR-005 que esta misma spec había escrito. Reproducido: una orden abierta con `total_cents: 0` renderizaba «Mesa cobrada» + «Emitir Factura B». → FR-005.
2. **Splits stale.** Al quedarse en la pantalla sin refetch, las sub-cuentas de `init` seguían mostrando «Cobrar» habilitado sobre la mesa ya cobrada, y «Anular cobro» desaparecía (su gate es `totalPaid > 0`) justo cuando más se necesita. → FR-006.
3. **Ventana de doble comprobante** en el panel embebido, que no traía el `existingInvoice`. → FR-007.
4. **Una nota de crédito se pintaba como «Factura B»**: `getInvoiceForOrder` no filtra por tipo y una factura anulada deja su NC `authorized`. Ahora la etiqueta sale de un mapa por tipo (bug preexistente del cobro del mozo, arreglado de paso al compartir el componente).

Quedan dos guards que corresponden al server y no a esta UI: `emitInvoice` lee `lifecycle_status` y no lo valida, y no rechaza `facturableCents <= 0`. Anotado como defensa en profundidad pendiente.

## Verify

- `pnpm typecheck` ✅ · `pnpm test` ✅ **1387 unitarios** (11 nuevos; los 16 archivos `*.integration` fallan por falta de stack local, igual que antes del cambio) · `pnpm build` ✅ · `pnpm lint` sin problemas nuevos.
- Tests nuevos: `components/billing/facturacion-section.test.tsx` (6) y `admin/(authed)/mesa/[id]/cobrar/cobrar-desktop-client.test.tsx` (5, incluido el de la orden abierta con total 0).
- **Pendiente de verificación en vivo con el rol real** (encargado de golf-jcr): emitir un comprobante de prueba y confirmar que aparece en `invoices` y en el gateway.
