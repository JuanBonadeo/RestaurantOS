-- ============================================================================
-- 0059 — El retiro del cierre es del corte, no del turno que empieza
--
-- Spec 130 dejó el retiro del cajón como una sangría de verdad (D3), escrita
-- 1 ms después del corte para que caiga en el período nuevo. La plata cierra:
-- apertura = lo contado, sangría por lo mismo, caja en $0. Lo que no cierra es
-- lo que se lee. El encargado de Golf abrió el turno y vio:
--
--     EN LA CAJA DEBERÍAS TENER   $0
--     $262.000 del corte anterior + movimientos del período
--     Movimientos del período:  Sangría 11:29 p. m. «cierre»   −$262.000
--
-- y entendió que el sistema le pedía $262.000 de saldo anterior. El total
-- estaba bien; abajo se narraba dos veces la misma plata —una como arrastre y
-- otra como la sangría que lo vacía— y eso es lo que se lee a la 1 de la
-- mañana. «Así no se presenta a confusión», pidió: el turno nuevo tiene que
-- arrancar en cero también en el relato.
--
-- `corte_id` le pone nombre a esa sangría. Con eso deja de ser un movimiento
-- del turno nuevo y pasa a ser la última línea del corte anterior: la app la
-- netea contra la apertura —el mismo sumando, del otro lado de la cuenta— así
-- que **`expected_cash_cents` no cambia en ningún caso**. Lo que cambia es que
-- la apertura queda en $0 y la lista del turno arranca vacía. El movimiento
-- sigue existiendo, visible y anulable en el libro (spec 070): no se borra
-- plata, se le corrige el dueño.
--
-- Quién lo escribe: la server action, justo después de `cerrar_caja_tx`. NO se
-- toca la función. Es el camino más caliente del sistema —corte, retiro, mesas
-- y rendiciones en una sola transacción— y reescribirla en caliente por una
-- etiqueta no vale el riesgo un miércoles a la noche con el salón abierto. El
-- modo de falla del update suelto es benigno: la plata ya quedó bien y lo único
-- que se pierde es el rótulo. Mudarlo adentro de la función queda para el
-- próximo deploy tranquilo.
--
-- Aditiva: una columna anulable y un índice parcial. Ninguna fila cambia de
-- monto.
-- ============================================================================

alter table caja_movimientos
  add column if not exists corte_id uuid references caja_cortes(id) on delete set null;

comment on column caja_movimientos.corte_id is
  'Spec 130 · El movimiento es parte de un cierre (el retiro del cajón), no del turno que arranca después. La app lo netea contra la apertura del período nuevo: no cambia el efectivo esperado, evita narrar la misma plata dos veces.';

-- Parcial: sólo el retiro del cierre lleva `corte_id`; el resto del libro es NULL.
create index if not exists caja_movimientos_corte_id_idx
  on caja_movimientos (corte_id)
  where corte_id is not null;

-- ── Los retiros que ya están escritos ───────────────────────────────────────
-- Dos clases de fila: la que escribe `cerrar_caja_tx` (1 ms después del corte,
-- motivo «Retiro del cierre de caja») y la que tipeó el encargado a mano antes
-- de que existiera el botón — el caso de Golf: la misma plata que contó, sacada
-- 4 minutos después con motivo «cierre». Las dos son el retiro del cierre y
-- ninguna es un movimiento del turno nuevo.
--
-- Predicado conservador: sangría viva, por **exactamente** lo contado en ese
-- corte, dentro de los 15 minutos posteriores. No toca montos: sólo escribe el
-- dueño. Idempotente por `corte_id is null`.
with retiros as (
  select distinct on (m.id) m.id as mov_id, k.id as corte_id
    from caja_movimientos m
    join caja_cortes k
      on k.caja_id = m.caja_id
     and m.created_at >  k.created_at
     and m.created_at <= k.created_at + interval '15 minutes'
     and m.amount_cents = k.closing_cash_cents
   where m.kind = 'sangria'
     and m.corte_id is null
     and m.cancelled_at is null
     and m.amount_cents > 0
   order by m.id, k.created_at desc
)
update caja_movimientos m
   set corte_id = r.corte_id
  from retiros r
 where m.id = r.mov_id;
