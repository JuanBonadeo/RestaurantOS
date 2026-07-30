-- Spec 067 · El plano puede mostrar el nombre del cliente sentado.
--
-- Opción POR SALÓN (no por negocio): un complejo puede querer nombres en el
-- salón de socios y números en la terraza de paso. Se edita junto con el resto
-- del plano (`saveFloorPlan`).
--
-- Apagada por defecto: los planos existentes siguen mostrando número de mesa +
-- tiempo abierto, exactamente como hoy.

alter table "public"."floor_plans"
  add column if not exists "show_customer_name" boolean not null default false;

comment on column "public"."floor_plans"."show_customer_name" is
  'Spec 067: si es true, las mesas OCUPADAS de este plano muestran sólo el nombre del cliente sentado (sin número de mesa ni tiempo abierto). Las mesas libres siguen mostrando su número, y una mesa ocupada sin nombre conocido cae al render de siempre — la opción nunca deja una mesa sin etiqueta.';
