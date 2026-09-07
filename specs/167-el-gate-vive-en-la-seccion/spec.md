# 167 · El gate vive en la sección

**Issue:** [#250](https://github.com/gachetponzellini/RestaurantOS-app/issues/250) ·
**Milestone:** Post-demo · Growth & hardening ·
**Estado:** ✅ implementada (2026-09-07)

**Input:** encontrado al cerrar [#247](https://github.com/gachetponzellini/RestaurantOS-app/issues/247),
buscando por qué `proveedores/page.tsx` era la única página de plata sin gate de
sección. No era la única: era la que se notó.

**Depende de**: `140` (el rol `terminal`, que abrió el panel a un puesto del
salón), `142` (la Ayuda del mozo, que abrió el panel al mozo), `153` (que movió
media sección Caja de lugar), `032` (`conversaciones/layout.tsx`, que es el
patrón que esta spec generaliza).

**Número:** la 161 a la 166 están reservadas en los títulos de las issues
#242–#248. Esta salió después y toma el 167.

---

## Por qué

**El panel dejó de tener una puerta y nadie repartió las llaves.**

El layout de `admin/(authed)` era una barrera dura: si no eras admin, afuera.
Dos specs la abrieron por buenas razones —la **142** le dio la Ayuda al mozo, la
**140** le dio Operación al `terminal`— y las dos delegaron la defensa en cada
página. `sections.test.ts` lo dice explícitamente:

> *«Ahora la guía es suya, así que el panel lo deja pasar — y cada otra página
> lo sigue rebotando por su propio gate.»*

El contrato es correcto. El problema es que **la mitad de las páginas no cumple
su parte**, y no hay nada que lo verifique.

### Medido en vivo, con el JWT real de un mozo (`pedro@demo.test`, `demo`)

Tipeando la URL, sin ningún truco:

| URL | Qué se ve |
|---|---|
| `/demo/admin/clientes` | **19 clientes** con nombre, **teléfono**, **DNI/email**, cuánto gastó y cuántos pedidos hizo cada uno |
| `/demo/admin/catalogo` | «Productos e inventario» con las solapas **Costos (108)**, Insumos (122), Stock (108) |
| `/demo/admin/promociones` | pasa |
| `/demo/admin/campanas` | pasa |
| `/demo/admin/salones` | pasa |
| `/demo/admin/reservas` y `/reservas/configuracion` | pasa |
| `/demo/admin/pedidos/historial` | pasa |
| `/demo/admin/stock/configurar` | pasa |
| `/demo/admin/menu-del-dia` | pasa (redirige a `catalogo`) |

Las mismas tres verificadas con **`terminal@demo.test`**: idénticas. El rol
`terminal` es el peor caso — es un puesto **físicamente compartido** en el
salón, sin nadie sentado adelante.

Las que sí rebotan: `chatbot`, `conversaciones`, `cajas`, `operacion/cierres`,
`operacion/movimientos`, `facturacion/entidades`, y `proveedores` desde la #247.

En la matriz de `sections.ts`, `clientes` y `catalogo` están en `mozo: "none"`.
**La matriz dice la verdad; las páginas no la consultan.**

Alcance: golf-jcr **35 usuarios no-manager de 42**, kcc **49 de 50**.

### Por qué no alcanza con poner `canSee` en las que faltan

Tres razones, todas medidas:

**1 · No es un olvido puntual, es la ausencia de un lugar.** Hay **cuatro**
mecanismos de gate conviviendo, y ninguno es el oficial: `canSee(...)` en la
página, `sectionAccess(...) === "none"` en la página, el gate en el layout de la
sección (`conversaciones/`, `configuracion/`), y `canManageBusiness(ctx)`.

**2 · El modo de falla real es la página que se agrega después.** `reservas/`
tiene tres páginas y ninguna gatea; `configuracion/` tiene cinco y **ninguna
gatea tampoco** — pero está cubierta, porque su **layout** lo hace. Esa es la
diferencia entre las dos carpetas, y es exactamente la propiedad que hay que
generalizar: un gate en el layout cubre las páginas que todavía no existen.

**3 · Una guarda que se llama y se tira compila igual.**
`stock/configurar/page.tsx:22` hace **`void canManageBusiness(ctx)`**. Parece
defendida, no defiende nada, y ningún grep la distingue de una que sí.

Y hay una cuarta, de método: **un barrido estático no sirve como plan**. El que
hice para abrir la issue daba 29 candidatas e incluía `operacion/movimientos`,
que rebota perfecto porque es un `permanentRedirect` a una página que sí gatea.
Al revés, contaba a `stock/configurar` como defendida. La lista buena se saca
abriendo las URLs con el rol real, que es como salió la tabla de arriba.

## Las decisiones

**D1 · El gate va en el `layout.tsx` de la sección, no en la página.**

No es un invento: es lo que la spec 32 ya hizo en `conversaciones/layout.tsx` y
lo que sostiene a `configuracion/` con sus cinco páginas sin gate propio. Esta
spec lo vuelve la regla en vez de la excepción afortunada.

La propiedad que se compra es la única que importa a largo plazo: **cubre las
páginas que todavía no existen**. `reservas/configuracion/page.tsx` se agregó
después de la 140 y nadie se acordó de gatearla; con el layout puesto, habría
nacido cubierta.

Es además lo idiomático de Next: el layout de una subrama corre antes que
cualquier página de esa subrama, en el server, y no hay forma de saltearlo.

**D2 · Una carpeta = una sección, escrita, no derivada.**

Cada layout nombra su sección con un literal. Nada de derivar la sección del
nombre de la carpeta: el mapeo **no es 1:1** y fingir que lo es esconde los
casos raros. Los que no coinciden, sacados del sidebar, que es el mapeo
canónico:

| Carpeta | Sección | Por qué |
|---|---|---|
| `caja/` | `cajas` | la 153 renombró la ruta a singular, la sección quedó en plural |
| `mesa/` | `operacion` | el detalle de mesa del admin (ya gatea así) |
| `stock/` | `catalogo` | se fusionó en «Productos e inventario» (`?tab=stock`) |
| `menu-del-dia/` | `catalogo` | redirige ahí |
| `empleados/`, `usuarios/` | `rrhh` | redirigen ahí |
| `cajas/` | `cajas` | redirige a `caja/` |

**D3 · Los gates que ya están en las páginas se quedan.**

Son inocuos, y varios hacen **más** que gatear: `chatbot/page.tsx` usa el
`"limited"` para renderizar el panel recortado, y `salones/page.tsx` pasa
`canManage` al componente. Sacarlos sería un refactor con riesgo y sin premio.
La única que se toca es la que miente: el `void canManageBusiness(ctx)` de
`stock/configurar`.

**D4 · El test recorre las carpetas; no busca un string.**

Un test que grepee `canSee` reproduce el error que cometí al abrir la issue:
cuenta `operacion/movimientos` como agujero y `stock/configurar` como defendida.
El test enumera las **carpetas de sección** bajo `(authed)` y exige que cada una
tenga su layout con gate, con una allowlist chica y justificada. Así el que
falla no es «faltó una llamada» sino «apareció una sección sin puerta», que es
el modo de falla real.

**D5 · El destino del rebote se calcula: es la primera superficie que el rol
efectivamente ve.**

`/{slug}/admin` si ve el dashboard, `/{slug}/admin/operacion` si ve Operación, y
si no `/{slug}/mozo`. Por construcción no puede haber ciclo: sólo se devuelve un
destino que el rol ve, y nunca la sección que se acaba de rechazar.

> **Corregido al implementar.** Acá decía «redirige a `/{slug}/admin`, como las
> demás», copiando lo que hacen `rrhh` y `reportes`. **Colgó el navegador en un
> ciclo infinito** apenas se probó con un mozo:
>
>     GET /demo/admin → GET /demo/admin/operacion → GET /demo/admin → …
>
> El dashboard rebota a Operación a quien no lo ve, y `operacion/layout.tsx`
> rebotaba de vuelta al dashboard. Antes eso no podía pasar porque quien cortaba
> la cadena era `operacion/page.tsx` mandando a `/mozo` — y **un layout corre
> antes que su página**, así que ese corte dejó de existir justo por mudar el
> gate al layout. El bug es hijo directo de D1, y ningún test unitario lo habría
> visto: apareció en el verify, en el segundo en que el navegador se quedó
> girando. Ahora la invariante «nunca mando a un lugar del panel que el rol no
> vea» está escrita como test.

## Alcance

**Layouts nuevos** (con el gate de D1), en las carpetas que hoy no tienen
ninguno o cuyo layout no gatea:

`ayuda/`, `caja/`, `cajas/`, `campanas/`, `catalogo/`, `chatbot/`, `clientes/`,
`empleados/`, `facturacion/`, `menu-del-dia/`, `mesa/`, `operacion/`,
`pedidos/`, `promociones/`, `proveedores/`, `reportes/`, `reservas/`, `rrhh/`,
`salones/`, `stock/`, `usuarios/`.

`configuracion/` y `conversaciones/` ya gatean en su layout: se dejan como
están (`configuracion/` con `canManageBusiness`, que es admin-only y más
restrictivo que su celda).

**Server:** el `void canManageBusiness(ctx)` de `stock/configurar/page.tsx`.

**Tests:** el recorrido de D4, más los casos por rol de las secciones que hoy
están abiertas.

**No se toca** — si el diff los toca, el diseño está mal: `sections.ts` (la
matriz ya dice la verdad), `can.ts`, el layout de `(authed)` (su gate
`hasAnySection` sigue siendo el correcto: es la puerta del panel, no la de cada
sección), y las páginas que ya gatean.

## Qué NO entra

- **Mover el gate al middleware.** Es el único lugar que conoce la ruta sin
  ayuda, pero necesitaría consultar `business_users` en **cada request** para
  saber el rol. La spec 104 sacó a propósito el hop de red del middleware
  (`getClaims()` en vez de `getUser()`) y su matcher cubre toda la app.
- **Reagrupar las rutas por nivel de acceso** (`(admin-only)/`, `(manager)/`).
  Cierra la clase de verdad, pero mueve 55 archivos y rompe todos los links.
- **La RLS de las tablas que están detrás.** Estas páginas leen con service
  role, así que la RLS ni se evalúa — arreglarla no cerraría nada de lo que esta
  spec cierra. Donde hacía falta de verdad se hizo aparte (#247).
- **Revisar la matriz.** Si `clientes` debe seguir siendo `mozo: none` es otra
  discusión; esta spec hace que la matriz **se cumpla**, no la cambia.
- **Las superficies fuera de `/admin`** (`/mozo`, `/fichar`, las públicas).

## Escenarios de aceptación

1. **Dado** un mozo con sesión, **cuando** tipea `/{slug}/admin/clientes`,
   **entonces** no ve un solo teléfono: rebota antes de que la página consulte.
2. **Ídem** para `catalogo`, `promociones`, `campanas`, `salones`, `reservas`,
   `reservas/configuracion`, `pedidos/historial`, `stock/configurar` y
   `menu-del-dia`.
3. **Dado** el `terminal`, **entonces** rebota igual que el mozo en todas ellas
   —y sigue entrando a Operación, que es lo suyo.
4. **Dado** el encargado, **entonces** entra a todo lo que su celda dice que ve,
   y `configuracion` y `reportes` le siguen estando cerradas.
5. **Dado** el admin, **entonces** no se entera de nada: ninguna pantalla cambia.
6. **Dado** el `"limited"` del chatbot para el encargado, **entonces** sigue
   viendo el panel recortado — el layout deja pasar y la página decide.
7. **Dada** una carpeta de sección nueva sin layout con gate, **entonces** el
   test falla nombrándola.
8. **Dado** `/{slug}/admin/cajas` (el link viejo del sidebar), **entonces**
   sigue redirigiendo a `caja/` y el encargado llega a su historial.
9. **Dado** un mozo en `/{slug}/admin/ayuda`, **entonces** entra: la Ayuda es
   suya desde la 142, y esta spec no se la saca.

## Verificación

**Implementada y verificada el 2026-09-07.** En vivo en `demo` con los cuatro
roles reales, entrando por magic link. `pnpm typecheck` limpio y **2.504
unitarios en verde**; los 7 `*.integration.test.ts` fallan sin el stack Supabase
local (ruido conocido, ninguno tocado por esta spec).

**Escenarios 1 y 2 — las nueve que estaban abiertas.** Con `pedro@demo.test`
(mozo), tipeando cada URL y leyendo `location.pathname` al final de la cadena:

    /demo/admin/clientes               → /demo/mozo
    /demo/admin/catalogo               → /demo/mozo
    /demo/admin/promociones            → /demo/mozo
    /demo/admin/campanas               → /demo/mozo
    /demo/admin/salones                → /demo/mozo
    /demo/admin/reservas/configuracion → /demo/mozo
    /demo/admin/pedidos/historial      → /demo/mozo
    /demo/admin/stock/configurar       → /demo/mozo
    /demo/admin/menu-del-dia           → /demo/mozo

Antes de la spec, las nueve **renderizaban**. `clientes` mostraba los 19
clientes del demo con teléfono y DNI; `catalogo`, las solapas Costos (108),
Insumos (122) y Stock (108).

**Escenario 3 — el terminal.** Con `terminal@demo.test`, `clientes`, `catalogo`
y `stock/configurar` rebotan a `/demo/admin/operacion` — no a `/mozo`, porque
Operación **sí** es suya, y ahí lo deja. Es el rol que más importa: es un puesto
físicamente compartido en el salón.

**Escenario 4 — el encargado.** Con `sofia@demo.test`: entra a `clientes`,
`catalogo` y `caja`; `reportes` y `configuracion` la rebotan a
`/demo/admin/operacion`, que es lo que su celda dice.

**Escenarios 5 y 8 — el admin.** Con `admin@demo.test`, ninguna pantalla cambió:
`reportes`, `configuracion`, `clientes` y el dashboard entran igual que antes. Y
el link viejo `/demo/admin/cajas` sigue redirigiendo a `/demo/admin/caja`.

**Escenario 6 — el `"limited"` sobrevive.** Sofía entra a `/demo/admin/chatbot`
y ve **sólo** «Activá o pausá el asistente de WhatsApp del local» con el
toggle — sin el prompt ni el tester. El layout deja pasar; la página decide el
recorte. Es la prueba de D3: si el layout hubiera absorbido la decisión, acá se
habría perdido el matiz.

**Escenario 9 — la Ayuda sigue siendo del mozo.** Pedro entra a
`/demo/admin/ayuda` y se queda ahí. Es el control positivo que muestra que el
gate discrimina en vez de cerrar todo.

**Escenario 7 — el test.** `section-gate.test.ts` recorre las carpetas: contra
el `HEAD` previo habría reportado **21 de 23 sin puerta** (sólo `configuracion/`
y `conversaciones/` tenían layout con gate).

**El bug que encontró el verify.** La primera versión redirigía siempre a
`/{slug}/admin` y colgó al mozo en un ciclo infinito entre el dashboard y
Operación — el rastro quedó en los logs del dev server, 8 pares de `GET`
alternados antes de que lo cortara. Ver D5. Es la mejor defensa de este verify:
el ciclo no rompía ningún test unitario, ni el typecheck, ni se veía leyendo el
diff.
