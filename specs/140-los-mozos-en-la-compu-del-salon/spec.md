# 140 · Los mozos en Operación, desde la compu del salón

**Issue:** [#211](https://github.com/gachetponzellini/RestaurantOS-app/issues/211) ·
**Milestone:** Post-demo · Growth & hardening ·
**Estado:** **spec** — sin implementar.

**Input:** Juan, 2026-09-02: *"como en la etapa 1, los mozos no van a tener su
propio movil, van a manejar todo de una computadora en comun distinta a la del
encargado, habria que armar como un rol intermedio que pueda ver el panel como
un encargado, pero que no tenga los mismos permisos"*. Y después: *"el fichaje
que también lo puedan manejar, para ficharse desde esa compu"*.

**Depende de**: [`138`](../138-asignar-mesa-desde-el-plano/spec.md) (distribuir
mozos desde el plano — es de donde sale la asignación mesa→mozo que acá pasa a
ser la fuente de la atribución), [`139`](../139-el-cierre-en-papel/spec.md) (la
rendición obligatoria, que depende de que la atribución sea correcta),
[`07`](../../../../wiki/specs/07-caja-rendicion-mozos/spec.md) (la rendición y
`caja_user_assignments`), [`14`](../../../../wiki/specs/14-multi-local-y-deploy-onsite/dashboard-y-permisos.md)
(la matriz de secciones por rol, §B).

---

## Por qué

En golf-house la Etapa 1 arranca sin móviles para los mozos. Van a operar desde
una computadora común del salón, distinta de la del encargado. Es el flujo que
ya conocen de MaxiRest: el mozo toma el pedido en papel, camina hasta la
terminal y lo carga.

Hoy no pueden. Hay dos gates encima:

1. El layout de `admin/(authed)` redirige a `/mozo` a **todo** rol `mozo`, de
   una, para todas las páginas del panel
   ([`layout.tsx:31`](<../../src/app/[business_slug]/admin/(authed)/layout.tsx>)).
2. `/operacion` repite el chequeo con un whitelist propio de admin/encargado
   ([`operacion/page.tsx:39`](<../../src/app/[business_slug]/admin/(authed)/operacion/page.tsx>)).

La superficie del mozo es `/mozo`, cuatro pantallas pensadas para un teléfono en
la mano. En una PC de escritorio compartida por seis personas eso no es lo que
hace falta: hace falta el plano del salón, que es donde se ve de quién es cada
mesa.

## Lo que ya está construido

Esta spec es más chica de lo que parece, porque el trabajo pesado ya está hecho.

**La matriz ya lo dice.** `sections.ts` declara desde hace rato:

```ts
operacion: { admin: "full", encargado: "full", mozo: "limited", personal: "none" }
```

([`sections.ts:63`](../../src/lib/permissions/sections.ts)). Alguien ya modeló
"el mozo ve Operación, recortada". La celda es **letra muerta**: el layout
redirige antes de que `canSee` llegue a evaluarse. `"limited"` no se lee nunca
para esta sección.

**El plano ya sabe qué es un mozo.** `salon-desktop.tsx` gatea por rol acción por
acción, y contempla el caso explícitamente:

| Control | Gate | Qué le pasa al mozo |
|---|---|---|
| Distribuir mozos | `canDistribuir={canAssignMozo(role)}` | se esconde |
| Venta rápida | `canVentaRapida={canCargarPedido(role)}` | se esconde |
| Transferir mesa | `role !== "mozo" \|\| pedirTable.mozo_id === currentUserId` | sólo su mesa |
| Trasladar mesa | `canMoveTable(role)` | se esconde |
| Anular mesa | `canTransitionMesa(role, "ocupada", "libre")` | se esconde |

**El fichaje ya es la pantalla de fichar.** El tab Fichaje de Operación no es una
vista de supervisión: es el numpad con PIN, el mismo mecanismo que `/fichar`
(`Numpad`, `PinDisplay`, `clockPunch(slug, pin)` en
[`fichaje-tab.tsx`](../../src/components/admin/local/fichaje-tab.tsx)). Y
`business_users.pin` char(4), único por negocio, ya existe y ya se usa. O sea:
lo que Juan pide —que se fichen desde esa compu— sale gratis con sólo dejar el
tab visible.

**Los 28 helpers de `can.ts` ya distinguen `mozo`** acción por acción: descuento
≤10% contra ≤25%, no anula, no corrige cobros, no hace corte ni sangría, no
confirma pedidos entrantes, no toca precios. La matriz de permisos que hacía
falta está escrita desde el Bloque 1.

Por eso **no se crea un cuarto rol** (D1). Lo único que falta es la puerta.

---

## Decisiones

### D1 · Se reusa `mozo`, no se crea un rol nuevo

El pedido original era "un rol intermedio". Pero el rol intermedio ya existe:
es `mozo` con acceso de escritorio. Un cuarto rol arrastraría el CHECK de
`business_users_role_check`, `is_business_staff()` en RLS, el tipo
`BusinessRole`, las 18 filas de `sections.ts`, los 28 helpers de `can.ts` y los
role-pickers de alta e invitación — todo para llegar a una columna que ya está
llena.

Un rol nuevo se justificaría sólo si esta persona necesitara algo que el mozo
hoy **no** puede (confirmar pedidos entrantes, anular ítem post-envío, cargar
delivery) sin darle caja ni rendición. No es el caso de Etapa 1.

**Consecuencia:** cero migraciones. Esta spec no toca la base.

### D2 · Qué significa `limited` en Operación

| Tab | Mozo | Por qué |
|---|:---:|---|
| Salón (plano) | ✅ | Su pantalla de trabajo. Es lo que reemplaza "mis mesas" |
| Comandas | ✅ | Ver qué salió de lo que mandó |
| Reservas | ✅ | `canManageReservations` ya incluye al mozo (decisión 2026-06-15) |
| Fichaje | ✅ | Fichar desde la terminal — pedido explícito |
| Pedidos | ❌ | Delivery / mostrador: `canConfirmOrder` y `canCargarPedido` son del encargado |
| Caja | ❌ | Cortes, sangrías, arqueo. `canHacerCorte` = encargado |
| Rendición | ❌ | Es el acto de supervisión sobre el mozo, no del mozo. `canRendirMozo` = encargado |

Rendición merece una nota: no se oculta sólo por permiso, sino porque en una
terminal compartida **"lo mío" no existe**. La sesión es de la máquina, no de
la persona. Un tab que dijera "tu rendición" mostraría la de todos juntos.

### D3 · El gate pasa de blacklist a `canSee`

El layout hoy pregunta "¿sos mozo? afuera". Pasa a preguntar "¿podés ver esta
sección?", que es lo que `sections.ts` ya sabe contestar. Con eso el mozo entra
a Operación y sigue afuera de las otras 17 secciones sin escribir una condición
nueva por página.

Los dos whitelists explícitos que quedan —`/operacion` y las pantallas desktop
de mesa (`admin/mesa/[id]/{pedir,cuenta,cobrar}`)— se alinean al mismo criterio.
Ojo con estas últimas: hoy rebotan al mozo a `/mozo/mesa/[id]/pedir`, su versión
móvil. Desde la terminal eso lo sacaría del panel a mitad de la carga.

### D4 · `canCargarPedido` se parte en dos

Hoy es un solo helper para dos cosas distintas, y en el plano gobierna si tocar
una mesa abre la carga directa
([`salon-desktop.tsx:1237`](../../src/components/admin/local/salon-desktop.tsx)).
Su docstring habla del pedido de mostrador *sin mesa* (spec 054), pero el plano
lo usa para el pedido *de mesa*.

Con el gate abierto y el helper cerrado, el mozo entra al plano y **sólo puede
mirar** — el propio comentario del código lo dice: *"Sin permiso de carga
tampoco: para ese rol el detalle es lo único que hay"*. Sería abrirle la puerta
a una pantalla de sólo lectura.

Se separan: cargar pedido **de mesa** (mozo sí) y cargar pedido **de mostrador /
delivery sin mesa** (encargado, como está).

### D5 · La mesa manda en la atribución

Esta es la decisión que sostiene todo lo demás, y la que hoy **no** se cumple.

La premisa de Etapa 1 es que la plata de cada mesa es del mozo asignado a esa
mesa: se distribuye al iniciar el turno y se puede reasignar. Eso es lo que hace
que la rendición siga teniendo sentido con una sola cuenta en la terminal.

El código hoy no funciona así. `deriveAttributedMozo` busca **primero** el
`loaded_by` del último ítem activo, y sólo cae al `mozo_id` de la mesa si no
encuentra ninguno
([`cobro-actions.ts:130`](../../src/lib/billing/cobro-actions.ts)). Y `loaded_by`
se escribe siempre con `ctx.userId`, el que opera
([`comandas/actions.ts:609`](../../src/lib/comandas/actions.ts)).

Con la terminal compartida, `loaded_by` es **siempre** la cuenta de la PC. Como
toda mesa cobrada tiene al menos un ítem cargado, el fallback a la mesa no se
alcanza nunca. Y la rendición se arma filtrando exactamente por ese campo:

```
.from("payments").select("method, amount_cents, tip_cents")
  .eq("attributed_mozo_id", mozoId)
```

([`caja/queries.ts:504`](../../src/lib/caja/queries.ts), vía
`getRendicionPendienteMozo`). El resultado sería que **la rendición de cada mozo
da $0** y toda la recaudación del turno queda atribuida a un solo usuario
fantasma: la terminal. Las propinas de `getTodayTips` van al mismo lugar.

Se invierte la prioridad: **si la mesa tiene `mozo_id`, gana la mesa**;
`loaded_by` queda como fallback para lo que no tiene mesa (mostrador, delivery).
Es coherente con el modelo que ya existe — `orders.mozo_id` es el snapshot
inmutable de quién abrió, y `tables.mozo_id` es el mutable que refleja las
transferencias (ver el comentario en
[`comandas/actions.ts:465`](../../src/lib/comandas/actions.ts)).

Efecto lateral bueno: arregla un caso que **ya muerde hoy**, sin terminal
compartida. Cada vez que el encargado carga un ítem desde el panel, la propina de
esa mesa pasa a atribuirse al encargado.

---

## Alcance

1. Layout `admin/(authed)`: blacklist → `canSee`.
2. Page-gates de `/operacion` y de `admin/mesa/[id]/{pedir,cuenta,cobrar}`.
3. `LocalShell`: filtrar `TABS` por rol según D2.
4. `can.ts`: partir `canCargarPedido` (D4).
5. `deriveAttributedMozo`: la mesa manda (D5).

## No-objetivos

- **Cuarto rol.** D1.
- **Migraciones / RLS.** Nada de esto toca la base.
- **Login por PIN en la terminal antes de cargar o cobrar.** El mecanismo existe
  (`business_users.pin`) y sería el equivalente exacto del código de MaxiRest,
  pero con D5 la atribución ya queda resuelta por la asignación de mesa. Se
  evalúa después, si el local pide identificar quién tipeó además de a quién se
  le atribuye.
- **La app `/mozo`.** Sigue igual, para cuando haya móviles.

## Riesgos

- **El plano en una pantalla compartida no tiene "mis mesas".** El mozo ve todo
  el salón, con las mesas de todos. Los gates por rol impiden que *opere* las
  ajenas (transferir sólo la propia), pero no que las *vea*. Para Etapa 1 es
  probablemente lo correcto —es la misma foto que tenían en MaxiRest— pero hay
  que confirmarlo con el local antes de dar la spec por buena.
- **D5 cambia comportamiento existente.** Toda mesa con `mozo_id` asignado pasa a
  atribuir por mesa aunque otra persona haya cargado los ítems. Es el
  comportamiento buscado, pero cambia números respecto de hoy: conviene mirar
  qué mesas de `golf-jcr` tienen `mozo_id` nulo antes de aplicarlo.

## Verificación

Con el rol real, nunca service_role. Magic link:

```
node scripts/magic-link.mjs pedro@demo.test "/demo/admin/operacion"
```

1. Pedro (mozo) entra a `/demo/admin/operacion` y ve el plano. No lo redirige.
2. Ve Salón, Comandas, Reservas, Fichaje. No ve Pedidos, Caja, Rendición.
3. Escribiendo `?tab=caja` a mano tampoco entra.
4. Sigue rebotado en `/demo/admin`, `/demo/admin/reportes` y el resto.
5. Toca una mesa libre → abre la carga de pedido (D4).
6. En una mesa ajena no ve Transferir; en la propia sí.
7. Ficha con su PIN desde el tab Fichaje.
8. Carga y cobra una mesa asignada a Lucía; el cobro queda atribuido a **Lucía**,
   y aparece en la rendición pendiente de Lucía, no en la de Pedro (D5).
