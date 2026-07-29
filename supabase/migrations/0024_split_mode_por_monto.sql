-- ============================================================================
-- 0024 — Dividir la cuenta por monto de dinero
--
-- Suma `por_monto` al check de `order_splits.split_mode`. Es el cuarto modo,
-- junto a `por_personas` / `por_items` / `por_comensal`: el mozo carga cuánto
-- pone cada uno ("yo pongo $10.000") y el remanente queda como última
-- sub-cuenta.
--
-- Cambio aditivo: sólo amplía el dominio permitido. No hay filas que migrar ni
-- backfill — los splits existentes siguen siendo válidos.
-- ============================================================================

alter table "public"."order_splits"
  drop constraint if exists "order_splits_split_mode_check";

alter table "public"."order_splits"
  add constraint "order_splits_split_mode_check"
  check (
    "split_mode" = any (
      array['por_personas'::text, 'por_items'::text, 'por_comensal'::text, 'por_monto'::text]
    )
  );
