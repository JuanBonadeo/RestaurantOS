-- ============================================================================
-- 0060 — Cobrar una mesa emite el comprobante (spec 147)
--
-- MaxiRest emitía por operación: el comprobante vivía en la propia apertura de
-- mesa (`mxape.cod_cpb` + `mxape.numero`), así que cerrar la mesa **era**
-- facturar y nadie tenía que acordarse. En RestaurantOS la emisión es explícita
-- desde la spec 086, y el resultado se ve en los datos de golf-jcr: 11 mesas
-- cobradas, 1 con intento de comprobante.
--
-- Dos columnas, las dos aditivas y apagadas por defecto:
--
--   businesses.afip_auto_emit  — el flag por negocio (D3). Apagado por defecto
--     a propósito: un negocio que hoy factura a mano no puede despertarse
--     emitiendo solo por un deploy. golf-house lo prende cuando su punto de
--     venta esté dado de alta en ARCA (hoy sus 14 invoices están todas en
--     `failed` por «EL PUNTO DE VENTA INFORMADO DEBE ESTAR DADO DE ALTA»).
--
--   invoices.auto_emitted      — de dónde nació el comprobante. La emisión
--     manual falla **en la cara del operador**, que ve el error en la pantalla;
--     la automática falla sin nadie mirando. El cron de reconciliación (spec
--     088) necesita esta columna para saber a cuál de las dos avisarle (D6).
--
-- Nada cambia de comportamiento por aplicarla: sin el flag prendido, el camino
-- es exactamente el de hoy.
-- ============================================================================

alter table businesses
  add column if not exists afip_auto_emit boolean not null default false;

comment on column businesses.afip_auto_emit is
  'spec 147 · Al saldarse una orden se encola la Factura B automáticamente. '
  'Requiere afip_cuit + afip_punto_venta; convive con afip_enabled.';

alter table invoices
  add column if not exists auto_emitted boolean not null default false;

comment on column invoices.auto_emitted is
  'spec 147 · El comprobante nació del cobro, no de un botón. Un fallo suyo '
  'dispara notificación interna (D6): nadie estaba mirando la pantalla.';
