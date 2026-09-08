-- ────────────────────────────────────────────────────────────────────────
-- 0092 — la Factura A elegida sobrevive al rodeo por Mercado Pago
--
-- El operador tilda «Factura A», carga el CUIT del cliente empresa y cobra con
-- MP. La elección se perdía en el camino: el ramal de MP en `CobroForm` retorna
-- ANTES del `onSubmit`, que es el único lugar donde el comprobante se valida y
-- se adjunta. `iniciarPagoMp` ni siquiera tiene el campo en su input, y el
-- webhook —que es quien cierra la orden cuando MP acredita— llama a
-- `closeOrderIfFullyPaid` con tres argumentos: sin comprobante.
--
-- Resultado: sale la B a consumidor final, y para el cliente empresa eso es
-- crédito fiscal que no computa. Recuperarlo cuesta una nota de crédito más una
-- A nueva, o sea dos trámites y una conversación incómoda.
--
-- El problema de fondo es que entre el cobro y el cierre hay un salto de
-- proceso: el que elige (el navegador del operador) y el que emite (el webhook,
-- minutos después, sin pantalla) no comparten memoria. La elección tiene que
-- viajar por la base, que es lo único que sobrevive al salto.
--
-- Va en `orders` y no en `payments` porque el que la consume es el cierre de la
-- ORDEN: `closeOrderIfFullyPaid` ya la tiene cargada y no necesita buscar cuál
-- de los pagos traía la elección. Se limpia sola al cerrarse, así que un cobro
-- posterior sobre la misma mesa no hereda la decisión del anterior.
--
-- Hallazgo: issue #274 · 3
-- ────────────────────────────────────────────────────────────────────────

alter table public.orders
  add column if not exists comprobante_elegido jsonb;

comment on column public.orders.comprobante_elegido is
  'Comprobante que el operador eligió al cobrar, cuando el cobro se completa fuera de la pantalla (Mercado Pago). Lo lee el webhook al cerrar la orden y se limpia ahí mismo. Null = la B automática de la spec 147.';
