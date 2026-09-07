# 168 · El saldo de la Caja Mayor, y cómo se le mete plata

**Issue:** [#249](https://github.com/gachetponzellini/RestaurantOS-app/issues/249) ·
**Milestone:** Post-demo · Growth & hardening ·
**Estado:** ✅ implementada (2026-09-05)

**Input:** Juan, 2026-09-05, mirando lo que quedó de la spec 160: *"la caja mayor
desde dónde se podría visualizar?"*. La respuesta honesta era: desde ningún lado.

**Depende de**: [`160`](../160-la-caja-administrativa/spec.md) — creó la caja y le
mandó los pagos, pero **no construyó el ítem D5 de su propio alcance**.

---

## Por qué

La spec 160 declaró, en su D5 y en su Alcance:

> *«La administrativa se fondea con un `ingreso` manual, desde Proveedores»* ·
> *«Proveedores: el saldo de la caja administrativa + fondearla»*

**No se construyó.** Lo único que existe es que el *nombre* de la caja viaje hasta el
diálogo de pago, para el renglón «Sale de Caja Mayor».

Dos consecuencias, las dos reales hoy:

1. **La Caja Mayor arranca en $0 y sólo baja.** No hay forma de meterle plata desde
   la app. Al ritmo del Golf —7,6 órdenes de pago por día hábil, $317.805 de
   promedio— en un mes está en −$50M largos. La D7 de la 160 dice que el negativo no
   se bloquea, y sigue siendo correcta; pero esa decisión asumía que **existiera** el
   fondeo. Sin él el número no es un saldo: es la suma acumulada de todo lo pagado.
2. **La única forma de verla es el libro de movimientos**, filtrando por ella. No hay
   ninguna pantalla que muestre cuánta plata tiene.

### Por qué se escapó, que importa más que el bug

Ninguno de los **11 escenarios de aceptación** de la 160 miraba el saldo ni el
fondeo. El verify pasó en verde, con evidencia real, sobre un alcance que tenía un
ítem sin construir. La lección quedó escrita en esa spec: **los escenarios se
escriben cruzando el Alcance ítem por ítem** — uno sin escenario es uno que se puede
olvidar sin que nada falle.

## Las decisiones

**D1 · El saldo se calcula server-side, con una RPC.**

Es la única decisión con filo técnico acá. Una caja **sin cortes** se lee desde su
`created_at` hasta hoy, sin frontera, y **PostgREST trunca en 1.000 filas en
silencio** (`max_rows` en `supabase/config.toml`; el propio `caja/queries.ts` lo
documenta como footgun). A 7,6 movimientos por día hábil son **4-6 meses** hasta que
el saldo empiece a mentir hacia arriba, sin ningún error.

Es exactamente el bug que la spec 161 acaba de arreglar en las lecturas de
proveedores. No se reintroduce acá: `saldo_caja_administrativa` agrega en Postgres y
devuelve un número, no filas.

**D2 · Se fondea con el `registrarIngreso` que ya existe.**

La 160 ya dejó pasar `ingreso` y `sangria` sobre la caja administrativa a propósito:
es una caja de **efectivo real**, y bloquear el retiro no tiene sentido. No hace
falta una action nueva — hace falta un botón.

**D3 · Vive en Proveedores, arriba de las solapas.**

Es donde el encargado la usa. `/admin/caja` no sirve: su botón «Ver ahora» lleva al
board del arqueo, que esta caja no tiene, y listarla ahí obligaría a inventar una
tercera variante de esa ficha —los pills «Cobrando», «Cierra sola» y «Nunca se
cortó» no aplican a ninguna— por menos valor.

**D4 · El saldo negativo se muestra como lo que es, sin alarma.**

Va a estar en rojo la mayor parte del tiempo hasta que el local tome la costumbre de
fondearla, y eso **no es un error**: la caja mayor del Golf corre −$402M contra
+$123M desde 2018. Se muestra el número y punto. Nada de "⚠ saldo negativo" ni de
bloquear el pago — eso reintroduciría el modo de falla de la 160 una caja más arriba.

**D5 · El movimiento revalida donde se ve, no donde se hacía antes.**

`registrarIngreso` y `registrarSangria` sólo revalidan `/admin/operacion`, que es el
board del turno. Si el movimiento es sobre la administrativa, ese path no muestra
nada y los dos que sí —Proveedores y el libro— quedan viejos.

## Alcance

**Datos** — migración `0074`:
- RPC `saldo_caja_administrativa(p_business_id uuid)` → saldo en centavos, cantidad
  de movimientos vivos y fecha del último. Agregación server-side (D1).

**Server:**
- `getSaldoCajaAdministrativa(businessId)` en `caja/queries.ts`.
- `registrarIngreso` / `registrarSangria`: revalidar también Proveedores y el libro
  cuando la caja es administrativa (D5).

**UI:**
- Tarjeta arriba de las solapas de Proveedores: nombre, saldo, último movimiento, y
  botón **«Ingresar efectivo»** que reusa el modal de monto+motivo que ya existe.
- Enlace al libro filtrado por esa caja, para ver el detalle.

## Qué NO entra

- **El barrido de fin de turno → caja mayor.** Sigue siendo el modelo completo de
  MaxiRest (3.147 movimientos) y sigue tocando `cerrar_caja_tx`: spec propia.
- **Arquear o cortar la administrativa.** La 160 lo prohíbe en tres capas y así
  queda.
- **Bloquear por saldo negativo** (D4).
- **Listarla en `/admin/caja`** (D3).

## Escenarios de aceptación

*(Cruzados contra el Alcance ítem por ítem, que es lo que faltó en la 160.)*

1. **Dado** Proveedores, **entonces** se ve el **saldo** de la Caja Mayor sin entrar a
   ninguna otra pantalla. *(Cubre: la tarjeta.)*
2. **Dado** un ingreso de $500.000, **entonces** el saldo sube $500.000 y el
   movimiento queda en el libro con su motivo. *(Cubre: el fondeo, D2.)*
3. **Dado** un pago a proveedor de $200.000 después de ese ingreso, **entonces** el
   saldo queda en $300.000 — el saldo refleja las dos puntas. *(Cubre: la RPC.)*
4. **Dado** un movimiento **anulado**, **entonces** no cuenta para el saldo.
5. **Dado** que la caja tiene más de 1.000 movimientos, **entonces** el saldo sigue
   siendo correcto. *(Cubre D1 — se prueba contra la base, no por UI.)*
6. **Dado** un saldo negativo, **entonces** se muestra en rojo y **no bloquea** pagar
   ni fondear. *(Cubre D4.)*
7. **Dado** un ingreso hecho desde Proveedores, **entonces** la tarjeta se actualiza
   sola, sin recargar. *(Cubre D5.)*
8. **Dado** un mozo, **entonces** no ve la pantalla (gate de la #250) ni puede
   fondear. *(Cubre el permiso.)*

## Verificación

**Implementada y verificada el 2026-09-05.** En vivo en `demo` con el rol real
(Sofía, encargada). `pnpm typecheck` limpio y **2.529 unitarios en verde**; los 7
`*.integration.test.ts` fallan sin el stack local (ruido conocido). Migración `0074`
aplicada al cloud.

**1 · La tarjeta.** Arriba de las solapas de Proveedores, antes de la lista:

    Caja Mayor
    −$ 75.000
    De acá salen los pagos a proveedor: es una caja administrativa, no entra al
    arqueo del turno. Está en negativo porque salió más de lo que se le puso;
    cuando cargues efectivo, sube.
    Ver movimientos (1)    [Ingresar efectivo]

Arrancó en **−$75.000** — el rastro de los verifies anteriores. Es exactamente el
síntoma que esta spec vino a resolver: la caja sólo bajaba.

**2 y 7 · El fondeo, y que se vea solo.** Un ingreso de $500.000 con motivo: toast
«Ingreso registrado» y la tarjeta pasó a **$425.000** **sin recargar la página** — y
el párrafo del negativo desapareció solo.

**3 · Las dos puntas.** Un pago a proveedor de $125.000 inmediatamente después: la
tarjeta quedó en **$300.000**. Sube con el ingreso, baja con el pago.

**4 y 5 · La razón de ser de la RPC (D1).** Probado contra la base, en una
transacción que revierte: **1.500 movimientos** de $1.000 más **200 anulados de
$9.999.999 cada uno**.

    saldo RPC          = 180000000
    saldo real         = 180000000
    coinciden          = t
    movimientos vivos  = 1503  (>1000: t)

Con 1.503 filas vivas el saldo es exacto — leerlo por PostgREST habría devuelto
1.000 y mentido en silencio. Y los 200 anulados, que sumarían ~$2.000 millones, no
contaron.

**6 · El negativo no bloquea.** Con el saldo en −$75.000 se pudo fondear y pagar sin
ninguna traba: es lo que dice la D7 de la 160 y lo que hace MaxiRest.

**8 · El permiso.** `proveedores` está en `mozo: none, terminal: none` en la matriz
de secciones (gate de la #250), y `canMakeSangria` es admin/encargado, así que el
botón de fondear no se renderiza para nadie más.

**Rastro en `demo`:** el ingreso de $500.000 y el pago de $125.000 son de este
verify; la Caja Mayor quedó en $300.000, que es el primer saldo positivo que tuvo.

**Un refactor que salió del camino.** `MovimientoModal` —el formulario de monto +
motivo— vivía como función privada dentro de `caja-admin-board.tsx`. Se extrajo a
`components/admin/local/movimiento-modal.tsx` para que la tarjeta lo reuse: el
mismo freno de monto, el mismo motivo, la misma ergonomía. Copiarlo habría sido
tener dos formularios de plata que se separan con el primer cambio.
