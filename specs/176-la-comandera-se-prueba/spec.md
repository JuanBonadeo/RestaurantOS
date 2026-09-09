# 176 · La comandera se prueba

**Issue:** [#284](https://github.com/gachetponzellini/RestaurantOS-app/issues/284) ·
**Milestone:** Post-demo · Growth & hardening ·
**Estado:** ✅ implementado

**Depende de**: `051` (el server pre-renderiza el ticket y el agente es un relay:
sin eso, un papel nuevo obligaba a recompilar el .exe del local), `063`/`080`/`084`
(la familia `print_jobs`, de la que esto es el quinto `kind`) y `124` (el alcance
de impresoras por agente, que también filtra la prueba).

---

## Por qué

Hoy, para saber si la IP que cargaste en Ajustes es la de la parrilla, hay que
marchar un pedido de verdad e ir a mirar la cocina. En la instalación on-site
—golf, y ahora KCC— eso es un ida y vuelta del salón a cada impresora, por cada
sector, cada salón (cuentas) y cada caja (fiscal). Y cuando no sale el papel, no
se distingue **qué** falló: ¿la IP está mal, la impresora está apagada, o el
print-agent de la PC del local ni siquiera está corriendo?

## Qué es

Un botón **«Probar»** en cada fila de comandera de *Ajustes → Operación del
local*: sectores, control de pedido, cuentas (negocio y por salón) y fiscal (por
caja). Imprime un papel chico que dice `PRUEBA`, el nombre de la comandera, la
IP:puerto a la que se mandó, el negocio, la hora del local y quién apretó.

Tres decisiones que hacen la diferencia:

1. **Prueba la IP TIPEADA, no la guardada.** Cuando estás cazando la IP correcta
   no querés guardar una config que quizás está mal para recién después probarla.
   El botón se habilita apenas hay algo en el campo.
2. **Contesta.** Después de encolar, la UI pollea el estado y dice una de tres
   cosas: «salió el papel», «el agente no pudo imprimir — connect ECONNREFUSED
   …» (el motivo real que reportó el agente) o «nadie levantó la prueba: revisá
   que el print-agent esté corriendo». Son tres problemas distintos y ahora se
   distinguen sin abrir logs.
3. **Caduca a los 5 minutos.** Una prueba es una pregunta que se hace mirando la
   impresora. Si el agente está caído, el papel **no** tiene que salir media hora
   más tarde, en medio del servicio, al lado de las comandas.

## Cómo

`print_jobs` con `kind = 'prueba'` (migración `0098`): viaja por el **mismo**
pull que comandas, controles, cuentas, facturas y cierres, con su `comanda_id`,
su `printer_ip` y su `content_escpos_b64` ya renderizado. **El .exe instalado en
el local no se toca.**

Es el único kind cuyo destino viaja en la fila (`test_printer_ip`,
`test_printer_port`, `test_label`) en vez de resolverse por configuración —
justamente porque lo que se prueba es una IP que puede no estar guardada. El
`print_jobs_target_check` se extiende con esa rama en vez de aflojarse.

De paso, `print_jobs.last_error` guarda el motivo que el agente ya mandaba en el
POST y hasta ahora se descartaba: para la prueba, el motivo **es** el resultado.

**SSRF:** la IP pasa por `isValidPrinterHost` —el mismo guard que ya cierra el
camino cloud→LAN del print-agent: sólo rangos privados RFC1918, o un hostname que
el agente resuelve en su red. Sin eso, esto sería «conectate a esta dirección y
escribí estos bytes» a pedido. Permiso: `canManageBusiness` (admin), el mismo que
ya rige configurar las comanderas.

## Archivos

- `supabase/migrations/0098_la_comandera_se_prueba.sql`
- `src/lib/print/test-ticket.ts` (+ test) — el papel.
- `src/lib/print/test-print-actions.ts` — encolar + consultar estado.
- `src/app/api/print-agent/route.ts` — `buildPrintableTestTickets` + `last_error`.
- `src/components/admin/settings/test-print-button.tsx` — el botón, en los 4 forms.

## Verificado en vivo

Negocio `demo`, como `admin@demo.test`, 2026-09-09: la prueba se encola con la IP
tipeada sin guardar; el GET del agente la entrega con el ticket renderizado;
`result:"failed"` muestra el motivo en pantalla; `result:"ok"` cierra con «Salió
el papel en Parrilla».
