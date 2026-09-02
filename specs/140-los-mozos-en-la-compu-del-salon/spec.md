# 140 · La terminal del salón

**Issue:** [#211](https://github.com/gachetponzellini/RestaurantOS-app/issues/211) ·
**Milestone:** Post-demo · Growth & hardening ·
**Estado:** **spec v2** — sin implementar. La v1 resolvía esto reusando el rol
`mozo`; se descartó, ver [D1](#d1--sí-va-un-rol-nuevo-terminal).

**Input:** Juan, 2026-09-02. Primero: *"como en la etapa 1, los mozos no van a
tener su propio movil, van a manejar todo de una computadora en comun distinta a
la del encargado, habria que armar como un rol intermedio que pueda ver el panel
como un encargado, pero que no tenga los mismos permisos"*. Después: *"el fichaje
que también lo puedan manejar, para ficharse desde esa compu"*, *"la cuenta de
mozo compartido, deberia de poder manejar todas las mesas, es como un encargado
pero que no tiene tantos privilegios"*, y por último *"es que capaz se usan las
dos cosas al mismo tiempo, capaz hay que hacer un rol nuevo"*.

**Depende de**: [`138`](../138-asignar-mesa-desde-el-plano/spec.md) (distribuir
mozos desde el plano), [`139`](../139-el-cierre-en-papel/spec.md) (rendición
obligatoria), [`07`](../../../../wiki/specs/07-caja-rendicion-mozos/spec.md)
(rendición y `caja_user_assignments`),
[`14`](../../../../wiki/specs/14-multi-local-y-deploy-onsite/dashboard-y-permisos.md)
(matriz de secciones por rol, §B).

---

## Por qué

En golf-house la Etapa 1 arranca sin móviles para los mozos: van a operar desde
una computadora común del salón, distinta de la del encargado. Es el flujo que ya
conocen de MaxiRest — el mozo toma el pedido en papel, camina hasta la terminal y
lo carga.

Hoy no pueden. El layout de `admin/(authed)` redirige a `/mozo` a todo rol `mozo`
([`layout.tsx:31`](<../../src/app/[business_slug]/admin/(authed)/layout.tsx>)) y
`/operacion` repite el chequeo con un whitelist propio
([`operacion/page.tsx:39`](<../../src/app/[business_slug]/admin/(authed)/operacion/page.tsx>)).
La superficie que tienen, `/mozo`, son cuatro pantallas pensadas para un teléfono
en la mano. En una PC compartida por seis personas lo que hace falta es el plano
del salón.

## Lo que ya está construido

**La matriz ya lo anticipaba.** `sections.ts` declara
`operacion: { …, mozo: "limited", … }` ([`sections.ts:63`](../../src/lib/permissions/sections.ts)) —
celda letra muerta, porque el layout redirige antes de que `canSee` se evalúe.

**El plano ya gatea por rol.** `salon-desktop.tsx` esconde «Distribuir mozos»
(`canAssignMozo`), «Venta rápida» (`canCargarPedido`), trasladar (`canMoveTable`)
y anular (`canTransitionMesa`) según quién mira.

**El fichaje ya es la pantalla de fichar.** El tab Fichaje de Operación no es una
vista de supervisión: es el numpad con PIN, la misma mecánica que `/fichar`
([`fichaje-tab.tsx`](../../src/components/admin/local/fichaje-tab.tsx)). Y
`business_users.pin` char(4) único por negocio ya existe y ya se usa. Lo que Juan
pidió —que se fichen desde esa compu— sale con dejar el tab visible.

---

## Decisiones

### D1 · Sí va un rol nuevo: `terminal`

La v1 de esta spec proponía reusar `mozo` y no crear un rol. El argumento era que
`can.ts` ya distingue al mozo acción por acción y `sections.ts` ya tenía la celda
`limited`. Se cae por lo que planteó Juan: **las dos cosas pueden convivir en el
mismo negocio al mismo tiempo** — mozos con teléfono y la terminal compartida.

Con eso, cualquier solución basada en el rol `mozo` (o en un flag por negocio,
que era la D6 de la v1) le aplica también a los mozos con móvil, que es justo lo
que no se quiere.

Pero el argumento decisivo es otro, y es de datos. Toda la app lista "los mozos"
así:

```ts
.from("business_users").select("user_id, full_name, role")
  .in("role", ["admin", "encargado", "mozo"])     // getMozosByBusiness
```

([`mozo/queries.ts:30`](../../src/lib/mozo/queries.ts)). Esa lista alimenta la
paleta de «Distribuir mozos» del plano y el selector de mozo. Y
`getRendicionesPendientesTodosLosMozos` hace lo mismo con
`.in("role", ["mozo", "encargado"])`
([`caja/queries.ts:543`](../../src/lib/caja/queries.ts)).

Si la cuenta compartida tuviera rol `mozo`, **aparecería como una persona más**:
en la paleta para asignarle mesas —y asignarle una mesa es mandarle la plata a su
rendición (D5)— y en el panel de rendiciones pendientes del encargado. La
terminal no es una persona: es un puesto. Un rol propio la deja afuera de esas
listas **sin tocar una sola query**.

**Nombre:** `terminal`. Choca de refilón con el "terminal de tarjeta" del
glosario (que en el producto se dice *posnet*), así que se puede ajustar —
`puesto`, `salon_compartido`. La spec usa `terminal`.

**Costo real.** Más chico de lo que parece: de los 28 helpers de `can.ts`, 22 son
`admin || encargado` y el rol nuevo cae en `false` por default, que es lo
correcto. Sólo 6 lo mencionan o hay que abrirlos: `canApplyDiscount`,
`canTransitionMesa`, `canTransferTable`, `canManageReservations`,
`canCargarPedido` (D4) y `canAssignMozo` (D7).

**Migración `0057`:** sumar `'terminal'` al CHECK de `business_users_role_check` y
al `role in (…)` de `is_business_staff()`. No se toca `notification_preferences`
ni `notifications` — la terminal no recibe notificaciones dirigidas: las lee el
encargado.

### D2 · Qué ve la terminal en Operación

| Tab | `terminal` | Por qué |
|---|:---:|---|
| Salón (plano) | ✅ | Su pantalla de trabajo |
| Comandas | ✅ | Ver qué salió de lo que se mandó |
| Reservas | ✅ | Es agenda de salón, la misma razón por la que el mozo la tiene |
| Fichaje | ✅ | Que el personal fiche con su PIN desde esa compu |
| Pedidos | ❌ | Delivery / mostrador: es del encargado |
| Caja | ❌ | Cortes, sangrías, arqueo |
| Rendición | ❌ | Es el acto de supervisión **sobre** el mozo, no del mozo |

En `sections.ts` la terminal queda `operacion: "limited"` y `none` en las otras 17
secciones.

### D3 · El gate pasa de blacklist a `canSee`

El layout hoy pregunta "¿sos mozo? afuera". Pasa a preguntar "¿podés ver esta
sección?", que es lo que `sections.ts` ya sabe contestar. Los dos whitelists
explícitos —`/operacion` y `admin/mesa/[id]/{pedir,cuenta,cobrar}`— se alinean al
mismo criterio. Ojo con estos últimos: hoy rebotan al mozo a su versión móvil, lo
que desde la terminal la sacaría del panel a mitad de la carga.

`ensureMozoAccess` suma `terminal` a su whitelist: la terminal no usa `/mozo`,
pero comparte componentes que pasan por ahí.

### D4 · `canCargarPedido` se parte en dos

Hoy es un solo helper para dos cosas distintas. Su docstring habla del pedido de
mostrador *sin mesa* (spec 054), pero el plano lo usa para decidir si tocar una
mesa abre la carga
([`salon-desktop.tsx:1237`](../../src/components/admin/local/salon-desktop.tsx)).

Con el gate abierto y el helper cerrado, la terminal entra al plano y **sólo
puede mirar** — el propio comentario lo dice: *"para ese rol el detalle es lo
único que hay"*. Se separan: cargar pedido **de mesa** (terminal sí) y cargar
pedido **de mostrador / delivery sin mesa** (encargado, como está).

### D5 · La mesa manda en la atribución

La decisión que sostiene todo lo demás, y la que hoy **no** se cumple.

La premisa es que la plata de cada mesa es del mozo asignado a esa mesa: se
distribuye al iniciar el turno y se puede reasignar. Eso es lo que hace que la
rendición siga teniendo sentido con una sola cuenta operando.

El código no funciona así. `deriveAttributedMozo` busca **primero** el
`loaded_by` del último ítem activo y sólo cae al `mozo_id` de la mesa si no
encuentra ninguno ([`cobro-actions.ts:130`](../../src/lib/billing/cobro-actions.ts)).
Y `loaded_by` se escribe siempre con `ctx.userId`, el que opera
([`comandas/actions.ts:609`](../../src/lib/comandas/actions.ts)).

Con la terminal, `loaded_by` es **siempre** la misma cuenta. Como toda mesa
cobrada tiene al menos un ítem, el fallback a la mesa no se alcanza nunca. Y la
rendición se arma filtrando exactamente por ese campo
(`.eq("attributed_mozo_id", mozoId)`, [`caja/queries.ts:504`](../../src/lib/caja/queries.ts)):
la rendición de cada mozo daría **$0** y la recaudación entera quedaría atribuida
a la terminal.

Se invierte: **si la mesa tiene `mozo_id`, gana la mesa**; `loaded_by` queda de
fallback para lo que no tiene mesa. Es coherente con el modelo que ya existe —
`orders.mozo_id` es el snapshot inmutable de quién abrió, `tables.mozo_id` el
mutable que refleja transferencias.

Efecto lateral bueno: arregla un caso que **ya muerde hoy**. Cada ítem que el
encargado carga desde el panel le pasa a él la propina de esa mesa.

### D6 · La terminal opera todas las mesas

Juan: *"deberia de poder manejar todas las mesas"*. Hoy hay dos capas que dicen
lo contrario, las dos atadas a `role === "mozo"`:

- **UI** — `role !== "mozo" || table.mozo_id === currentUserId` esconde
  «Transferir» en toda mesa ajena
  ([`salon-desktop.tsx:1844` y `:2880`](../../src/components/admin/local/salon-desktop.tsx)).
- **Server** — `canTransferTable` le exige al mozo ser origen (`fromMozoId ===
  ctx.userId`) o reclamarla para sí ([`mozo/actions.ts:708`](../../src/lib/mozo/actions.ts)).

Con el rol nuevo esto se resuelve solo: las dos condiciones preguntan por `mozo`,
y `terminal` no lo es. `canTransferTable` suma `terminal` al lado de
admin/encargado, y los gates de UI pasan a preguntar por el rol que restringe, no
por el que habilita.

Y el rol mozo queda intacto para Etapa 2, cuando cada uno tenga su teléfono y
"mi mesa" vuelva a significar algo. Eso es precisamente lo que el flag por negocio
de la v1 no podía dar.

### D7 · La terminal asigna mozo a las mesas

En la v1 esto quedaba abierto, porque con rol `mozo` significaba darle a una
cuenta compartida el poder de mover plata entre personas. Con `terminal` la
respuesta se aclara: **es el puesto de coordinación del salón**, y si no puede
asignar, cada walk-in que se sienta necesita al encargado en la otra máquina para
decir de quién es la mesa — fricción justo en hora pico.

`canAssignMozo` suma `terminal`. El rol `mozo` sigue sin poder (se auto-asigna por
walk-in, CU-09 R2).

Lo que se pierde: el audit log de la asignación va a decir siempre "terminal", no
qué persona la hizo. Es el costo de la cuenta compartida y se acepta para Etapa 1;
el camino para recuperarlo es el PIN por acción (No-objetivos).

---

## Alcance

1. Migración `0057`: `'terminal'` en `business_users_role_check` y en
   `is_business_staff()`.
2. `BusinessRole` + `sections.ts`: columna nueva según D2.
3. Layout `admin/(authed)`: blacklist → `canSee`. Page-gates de `/operacion` y
   `admin/mesa/[id]/{pedir,cuenta,cobrar}`. `ensureMozoAccess`.
4. `LocalShell`: filtrar `TABS` por rol.
5. `can.ts`: los 6 helpers de D1 — `canCargarPedido` (D4), `canTransferTable` y
   los gates de UI del plano (D6), `canAssignMozo` (D7), y revisar
   `canApplyDiscount`, `canTransitionMesa`, `canManageReservations`.
6. `deriveAttributedMozo`: la mesa manda (D5).
7. Role-pickers de alta e invitación: que se pueda crear la cuenta.

## No-objetivos

- **RLS más allá de `is_business_staff()`.** Las policies existentes ya cubren al
  rol nuevo por esa función.
- **Login por PIN antes de cargar o cobrar.** El mecanismo existe
  (`business_users.pin`) y sería el equivalente exacto del código de MaxiRest,
  pero con D5 la atribución de la plata ya queda resuelta por la asignación de
  mesa. Se evalúa después, si el local quiere además saber quién tipeó.
- **La app `/mozo`.** Sigue igual, para cuando haya móviles.
- **Que la terminal aparezca en listas de mozos.** Es lo que D1 evita a propósito:
  no se le asignan mesas ni se le pide rendición.

## Riesgos

- **Una identidad para seis personas.** El audit log de todo lo que pase por esa
  PC va a decir "terminal". Queda el «a quién se le atribuye» (D5), que es lo que
  importa para la plata, pero se pierde el «quién lo hizo».
- **D5 cambia comportamiento existente.** Toda mesa con `mozo_id` pasa a atribuir
  por mesa aunque otra persona haya cargado los ítems. Es lo buscado, pero cambia
  números respecto de hoy: conviene mirar cuántas mesas de `golf-jcr` tienen
  `mozo_id` nulo antes de aplicarlo, porque para esas la atribución seguiría
  cayendo en `loaded_by`.
- **Coexistencia sin probar.** El escenario "mozos con móvil + terminal en el
  mismo turno" es el que motiva el rol, pero no se va a poder probar de verdad
  hasta que existan los móviles. Los tests tienen que cubrirlo aunque el local
  todavía no lo use.

## Verificación

Con el rol real, nunca service_role. Hace falta crear una cuenta `terminal` en el
negocio demo (no existe hoy).

```
node scripts/magic-link.mjs terminal@demo.test "/demo/admin/operacion"
```

1. Entra a `/demo/admin/operacion` y ve el plano. No la redirige.
2. Ve Salón, Comandas, Reservas, Fichaje. No ve Pedidos, Caja, Rendición.
   Escribiendo `?tab=caja` a mano tampoco entra.
3. Sigue rebotada en `/demo/admin`, `/demo/admin/reportes` y el resto.
4. Toca una mesa libre → abre la carga de pedido (D4).
5. Transfiere una mesa asignada a Lucía, sin ser origen (D6).
6. Distribuye mesas desde el plano (D7).
7. Ficha con el PIN de Pedro desde el tab Fichaje.
8. Carga y cobra una mesa asignada a Lucía: el cobro queda atribuido a **Lucía**
   y aparece en su rendición pendiente, no en la de la terminal (D5).
9. **La terminal no aparece** en la paleta de «Distribuir mozos» ni en el panel de
   rendiciones pendientes del encargado (D1).
10. Pedro (rol `mozo`) sigue exactamente como hoy: entra a `/mozo`, ve sus mesas,
    y `/demo/admin/operacion` lo sigue rebotando.
