# 147 · Cobrar una mesa emite el comprobante

**Issue:** [#223](https://github.com/gachetponzellini/RestaurantOS-app/issues/223) ·
**Milestone:** Post-demo · Growth & hardening ·
**Estado:** ✅ implementada (2026-09-03) — el código está y **apagado por defecto**;
prenderla en `golf-jcr` sigue **bloqueado por un trámite del cliente**, ver «Antes de implementar»

**Input:** Juan, 2026-09-03, sobre el flujo de cobro del encargado: *"si cobrás
una mesa común debería de facturarse no?"* → *"o sea que debería emitir
automáticamente, acá habría que copiar a MaxiRest"*.

**Depende de**: [`086`](../086-facturar-desde-el-cobro-del-encargado/spec.md) (la
decisión que esta spec revierte), [`088`](../088-facturar-sin-bloquear-la-caja/spec.md)
(la que hace esto posible: emisión async + cron reconciliador),
[`053`](../053-condicion-iva-receptor/spec.md) (los datos del receptor),
[`062`](../062-motor-de-cobro-unificado/spec.md) (`closeOrderIfFullyPaid`, el
punto donde engancha).

---

## Por qué

### La decisión que se revierte

La spec 086 lo dejó escrito como decisión de producto:

> *¿Factura automática al cobrar?* **No: explícita.** Igual que el mozo. La
> mayoría de las mesas no pide comprobante; emitir sin que lo pidan gasta
> numeración fiscal.

El argumento mezcla dos cosas distintas: **que el cliente no se lleve el papel no
es lo mismo que no haya que emitirlo.** La obligación de emitir es del que vende.
Y «gastar numeración» no es un costo real: la numeración es un correlativo, no un
recurso escaso.

El resultado está en los datos de `golf-jcr`: **11 mesas cobradas, 1 sola con
intento de comprobante.**

### Qué hacía MaxiRest, con números

El POS que se reemplaza emitía **por operación**, y el backup lo prueba. La tabla
`mxnum` (contadores de numeración por tipo) marca:

| Tipo | Qué es | Número alcanzado |
|---|---|---|
| B (PV 1) | Factura B, consumidor final | **166.681** |
| F (PV 1) | Ticket de control fiscal | **191.071** |
| A (PV 2) | Factura A, B2B | 2.046 |

Ratio B:A ≈ **40:1**. Y el dato de diseño que importa más que los volúmenes: en
MaxiRest el comprobante **vive en la propia apertura de mesa** —
`mxape.cod_cpb` + `mxape.numero`, con `tasaiva` al lado. Cerrar la mesa no era un
paso previo a facturar: **era** facturar. Por eso nadie tenía que acordarse.

### Por qué no se puede copiar el mecanismo

| | MaxiRest | RestaurantOS |
|---|---|---|
| Emisor | controlador fiscal **Hasar 250F**, local | **WSFE async** vía el gateway ARCA GPSF |
| Internet | no hace falta | sí |
| Tiempo hasta el comprobante | instantáneo (el hardware numera y firma) | **~28 min promedio, hasta ~85** (medido en spec 088) |
| Dónde vive el número | en la fila de la mesa | en `invoices`, que llega después |

Con un controlador fiscal, emitir al cerrar es gratis: es la misma impresora, en
el mismo gesto, sin red. Con WSFE no existe «emitir al cerrar» de forma síncrona
— existe **encolar** al cerrar.

Eso no invalida el pedido, lo precisa: **se copia el comportamiento (toda mesa
cobrada termina en comprobante), no el camino.** Y el terreno ya está preparado,
porque la spec 088 desacopló la caja de la emisión justamente para esto: la
pantalla no espera el CAE, un cron reconcilia, y las fallidas se ven.

### Nota al margen sobre «copiar a MaxiRest»

Lo que se copia es el **diseño** de MaxiRest, no lo que Golf tiene hoy andando:
su impresora fiscal lleva **9 meses rota** (25.811 errores en `ERROR_IMP_CPB.LOG`)
y en toda su historia registró **3 CAE** por WSFE. El local viene de un año sin
emitir bien. Ver [`wiki/negocio/competencia/maxirest/facturacion-afip.md`](../../../wiki/negocio/competencia/maxirest/facturacion-afip.md).

## ⚠️ Antes de implementar

**El punto de venta de `golf-jcr` no está habilitado en ARCA.** Las 14 `invoices`
del negocio están **todas en `failed`**, con el mismo rechazo:

    NO AUTORIZADO A EMITIR COMPROBANTES - EL PUNTO DE VENTA INFORMADO
    DEBE ESTAR DADO DE ALTA Y SER DEL TIPO RECE

Intentos: 1 el 12/08, 11 el 21/08, 2 el 03/09 — el último de hoy, con una mesa
adentro. **Cero comprobantes emitidos desde que el negocio salió a producción.**

Automatizar la emisión antes de resolver eso no arregla nada: convierte 14
fallos en **uno por cada mesa cobrada**, y los multiplica en silencio. Es un
trámite del cliente en el portal de AFIP (alta del punto de venta para
comprobantes electrónicos), no código.

**Cómo se resolvió (2026-09-03):** el bloqueo es sobre **prender**, no sobre
escribir. `afip_auto_emit` nace en `false` para todos los negocios (D3), así que
el código no cambia nada para nadie hasta que alguien mueve el switch. El código
está implementado y verificado en `demo`; **`golf-jcr` sigue con el flag apagado
y se prende recién cuando su punto de venta emita un CAE real.**

## Las decisiones

**D1 · Automático significa encolar, no esperar.** Al saldarse la orden
(`closeOrderIfFullyPaid`, spec 062) se encola la emisión y el cobro termina como
termina hoy. Nadie mira un spinner: la spec 088 ya estableció que la caja no
espera al CAE, y esta spec se apoya en eso en vez de reabrirlo.

**D2 · La emisión pasa a ser del server, no de un componente.** Hoy los cinco
callers de `emitInvoice` son `.tsx` — la emisión depende de que alguien tenga una
pantalla abierta y apriete. Encolar desde `closeOrderIfFullyPaid` la vuelve
consecuencia del cobro y no de un gesto, que es exactamente el cambio que se
pide.

**D3 · Es un flag por negocio, no una constante.** `businesses.afip_auto_emit`,
apagado por defecto. Un negocio que hoy factura a mano no puede despertarse
emitiendo solo por un deploy; y golf-house lo prende cuando el PV esté dado de
alta. Convive con `afip_enabled` y el gate `afipConfigured` que ya existen: si el
negocio no factura, esta spec no hace nada.

**D4 · El tipo por defecto es Factura B a consumidor final.** Es el 97 % del caso
real (ratio 40:1 en MaxiRest) y el único que se puede emitir **sin pedirle datos
a nadie**. La Factura A sigue siendo explícita: necesita CUIT y condición de IVA
(spec 053), o sea alguien tipeando. Una mesa que pide A se factura como hoy —
y por eso el botón manual **no se va**.

**D5 · Una orden, un comprobante.** Es el riesgo serio de automatizar: emitir dos
veces es un comprobante fiscal duplicado, que se arregla con nota de crédito y
llamada al contador. La emisión automática chequea que la orden no tenga ya una
`invoice` viva (`pending` o `completed`) y usa `Idempotency-Key` derivada del
`order_id`, no aleatoria. La spec 088 ya advirtió que la reconciliación
anti-duplicado del gateway es **por job**: un job nuevo no la hereda, así que la
guarda tiene que estar del lado de la app.

**D6 · Un fallo tiene que verse, y hoy no se ve.** Los 14 rechazos de golf-jcr se
descubrieron **consultando la base** — la spec 088 ya lo había dicho con dos, y
un mes después son catorce. Automatizar sin esto multiplica un problema invisible:
pasa de «alguien facturó y le falló» a «todas las mesas fallan y nadie se entera».
La emisión automática que termina en `failed` dispara notificación interna a
`encargado`/`admin` (spec 027) y la mesa queda marcada en Operación. **Sin esta
parte, la spec no se implementa: es la que evita que el automatismo empeore las
cosas.**

**D7 · No se imprime solo.** La spec 088 ya lo decidió y sigue valiendo: imprimir
sin que nadie esté mirando la comandera es papel tirado. Se emite solo, se
imprime a pedido.

**D8 · No se retro-factura lo ya cobrado.** Las mesas cobradas sin comprobante
quedan como están; emitir hoy comprobantes con fecha de hace un mes es una
decisión fiscal que no toma un deploy. Si hay que regularizar, lo dice el
contador del cliente.

## Alcance

- **Migración:** `businesses.afip_auto_emit boolean not null default false`.
- **`src/lib/billing/cobro-actions.ts`** — `closeOrderIfFullyPaid` encola la
  emisión cuando el negocio la tiene prendida, la orden no tiene comprobante vivo
  y hay `afipConfigured`. Best-effort: si el encolado falla, el cobro **igual se
  cierra** (la plata no depende de ARCA).
- **`src/lib/afip/emit-invoice.ts`** — una entrada server-side que no dependa del
  formulario, con la guarda de idempotencia de D5. Los cinco callers `.tsx`
  siguen como están.
- **`src/lib/afip/reconcile.ts`** — el cron que ya existe pasa a notificar cuando
  cierra una factura en `failed` que nació automática (D6).
- **UI de configuración** — el switch en la sección Facturación, al lado de los
  campos AFIP que ya están.
- **Operación** — la mesa/pedido con comprobante fallido se distingue. Reusa el
  patrón visual de `print_failed_at` (spec 033), que resuelve exactamente el
  mismo problema en la comanda.

## Qué NO entra

- **Retro-facturar** lo cobrado hasta hoy (D8).
- **Auto-imprimir** el comprobante (D7).
- **Emitir A automáticamente** — necesita datos del receptor que nadie tipeó (D4).
  Se cruza con el punto 3 del [ingest de la encargada](../../../wiki/sources/2026-09-03-audios-encargada-golf.md):
  `customers` todavía no tiene CUIT ni condición de IVA. Cuando eso exista, la A
  automática es una spec propia.
- **El alta del punto de venta en ARCA.** Es trámite del cliente y es la
  precondición, no el trabajo.
- **Reintentar solo una fallida.** La spec 088 lo dejó humano a propósito
  (`retryInvoice`), por el riesgo de duplicado. No cambia.

## Escenarios de aceptación

1. **Dado** un negocio con `afip_auto_emit` prendido y AFIP configurado,
   **cuando** se salda una mesa, **entonces** queda una `invoice` encolada para
   esa orden sin que nadie apriete nada, y el cobro cierra igual que siempre.
2. **Dado** ese mismo cobro, **cuando** el operador mira la pantalla, **entonces**
   no espera nada: la caja sigue disponible al instante.
3. **Dado** que el gateway rechaza la emisión, **entonces** el cobro **queda
   igual de válido** y aparece la notificación de comprobante fallido para
   encargado y admin.
4. **Dado** un negocio con el flag apagado, **entonces** todo funciona
   exactamente como hoy: el botón «Emitir comprobante» y nada automático.
5. **Dado** una orden que ya tiene una `invoice` `pending` o `completed`,
   **cuando** se vuelve a saldar o se reintenta el cierre, **entonces** **no** se
   encola una segunda (D5).
6. **Dado** una mesa que pide Factura A, **entonces** el flujo manual sigue
   disponible y es el que se usa.
7. **Dado** un negocio sin AFIP configurado, **entonces** el flag no hace nada y
   no se encola ninguna emisión.

## Cómo quedó

| Pieza | Dónde |
|---|---|
| Flag por negocio + origen del comprobante | `supabase/migrations/0060_cobrar_una_mesa_emite_el_comprobante.sql` |
| El motor de emisión, sin auth ni formulario | `src/lib/afip/emit-core.ts` (nuevo) |
| Los gates y la Factura B automática | `src/lib/afip/auto-emit.ts` (nuevo) |
| El gancho en el cobro | `src/lib/billing/cobro-actions.ts` · `closeOrderIfFullyPaid` |
| El aviso interno | `src/lib/notifications/events.ts` · `notifyInvoiceFailed` + `view.ts` |
| El fallo que llega tarde | `src/lib/afip/reconcile.ts` · `applyGatewayStatus` |
| El switch | `src/components/admin/settings/afip-config-form.tsx` |
| «Sin comprobante» en Operación | `src/lib/caja/queries.ts` + `caja-admin-board.tsx` |

Dos notas de diseño que la spec no anticipaba:

**El motor tuvo que mudarse de archivo.** `emit-invoice.ts` es `"use server"`, y
ahí **todo export es un endpoint público**. Exportar el motor para que lo llamara
el cobro habría publicado un action que emite comprobantes fiscales sin pasar por
`requireMozoActionContext`. Vive en `emit-core.ts`, que es `server-only`:
`emitInvoice` quedó como la puerta autenticada de tres líneas.

**La mesa no se puede marcar: al cobrarse queda `libre`.** El alcance pedía
distinguir «la mesa/pedido con comprobante fallido» en Operación, pero
`closeOrderIfFullyPaid` libera la mesa y una orden `dine_in` no entra al board de
Pedidos. La única lista de Operación donde el cobro sigue existiendo es
**Movimientos del período** de la tab Caja, y ahí va el badge. Un cobro se marca
cuando su orden tiene una factura `failed` y **ninguna viva**: el reintento que
sale con CAE lo apaga solo.

## Verificación

**Tests** (`pnpm test`, 2057 en verde): los seis gates de `auto-emit.test.ts`
—flag apagado, sin AFIP, cuenta que es toda propina, comprobante ya vivo (D5),
Factura B automática con la clave derivada del `order_id`, y el rechazo que se
reporta— más dos de `reconcile.test.ts` para el fallo que llega por el cron y la
automática que sí sale con CAE.

**En vivo en `demo`** (2026-09-03), como Sofía, encargada — el rol que cobra:

1. *Escenarios 1 y 2* · Mesa T12, $3.000 en efectivo. Se apretó **Confirmar** y
   nada más: quedó `factura_b` `authorized`, `auto_emitted: true`, con
   `idempotency_key = <order_id>:factura_b` (derivada, no random). La pantalla no
   esperó nada.
2. *Escenario 3* · Con el gateway apuntado a un puerto muerto, mesa T9 de
   $36.750: **el cobro cerró igual** (`closed` / `paid`, $36.750 acreditados) y
   la factura quedó `failed`. Saltó la notificación **«Sin comprobante · Mesa
   T9»** en la campana y el badge rojo en la fila del cobro, en Movimientos del
   período. La T12 —la que sí salió— quedó sin badge.
   De yapa quedó confirmado R-C1: la invoice declaró $35.000, no los $36.750
   cobrados. La propina no va a la base imponible.
3. *Escenarios 4 y 7* · Los cubren los tests; `golf-jcr` y `kcc` quedaron con el
   flag en `false`, que es el estado de todos los negocios tras la migración.

`demo` queda con `afip_auto_emit` **prendido** y en sandbox: es el negocio de
pruebas, así que cada mesa que se cobre ahí va a generar su Factura B fake.

    node scripts/magic-link.mjs sofia@demo.test "/demo/admin/operacion?tab=caja"

## Fuera de alcance que apareció en el camino

Un negocio **sin credencial del gateway no podía guardar nada** de la config
AFIP: el formulario manda siempre el `baseUrl` por defecto, eso entraba a la rama
de la credencial, no había fila que actualizar y todo el guardado moría en
«cargá la API key y el slug» — CUIT y punto de venta incluidos. Se descubrió al
no poder prender el switch nuevo en `demo`, que emite por sandbox y nunca va a
tener credencial. Arreglado en `config-actions.ts`: un `baseUrl` solo, sin
credencial cargada, ya no se toma por media credencial.
