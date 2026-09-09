-- El agente de impresión reporta su versión (issue #278).
--
-- Cuando golf avisó que la nota de cocina no salía en la comanda, el server
-- mandaba el ticket bien y el sospechoso era el .exe instalado en la PC del
-- local — pero no había forma de saber qué versión corría: el latido sólo
-- decía "estoy vivo". Hubo que deducirlo cruzando fechas de commit contra las
-- notas del setup.
--
-- Nullable a propósito y sin default: NULL significa "agente anterior a este
-- cambio", que es información —la card lo muestra como versión desconocida y
-- sugiere reinstalar—, no un dato faltante que haya que rellenar.
alter table public.print_agent_status
  add column if not exists agent_version text;

comment on column public.print_agent_status.agent_version is
  'Versión que el print-agent declara en cada latido (fecha de release, ej. 2026-09-09). NULL = agente viejo que todavía no la reporta.';
