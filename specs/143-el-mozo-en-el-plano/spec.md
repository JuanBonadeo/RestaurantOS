# 143 · El mozo con nombre en el plano, Ctrl+Enter que envía, y la terminal que no refrescaba

**Issue:** [#215](https://github.com/gachetponzellini/RestaurantOS-app/issues/215) ·
**Milestone:** Post-demo · Growth & hardening ·
**Estado:** implementada y verificada en vivo (2026-09-02)

**Input:** Juan, 2026-09-02, mirando Operación:

- *"vamos a acomodar algo de los planos que se ven en operación, el tema de los
  mozos, que quedó medio inentendible: cambiar ese badge por poner el nombre del
  mozo abajo de la mesa, en una letra legible… y si hay dos mozos con el mismo
  nombre, que ponga la inicial del apellido, por ejemplo juan c, juan b, con
  mayúsculas y puntos"*
- *"para enviar las comandas a cocina debería ser con ctrl + Enter, no está
  funcionando eso"*
- *"al asignar los mozos, no aparecen en el plano hasta recargar, eso está mal"*

Tres cosas distintas encontradas en la misma pasada sobre la misma pantalla.

## Por qué

**El badge.** El mozo asignado se marcaba con un círculo de iniciales en la
esquina inferior derecha de la mesa: «JB». Dos letras no son un nombre — para
saber de quién era la mesa había que bajar a la leyenda de colores y volver. En
un plano de 70 mesas eso no se hace en hora pico. Y el círculo, además, le comía
la esquina a la mesa, que es donde vive el resto de la información.

**El atajo.** `⌘/Ctrl+Enter → enviar la comanda` está publicado en la ayuda de
atajos del salón (la tecla `?`), así que el encargado lo prueba. No andaba, por
dos motivos independientes:

1. Escuchaba con un `onKeyDown` de React sobre el div del panel. Eso sólo se
   entera si el foco está adentro del árbol, y en el salón el foco se va del
   panel todo el tiempo: un click al plano, un click al aire, un botón que se
   desmonta. Sin foco adentro, la tecla no llegaba a ningún lado — y sin ninguna
   señal de por qué.
2. El buscador se quedaba con el `Enter` sin mirar los modificadores: tipeabas
   tres letras, apretabas Ctrl+Enter y el buscador **agregaba el primer
   resultado** antes de que el atajo enviara. Te ibas a cocina con un producto
   que nadie pidió.

**La terminal congelada.** `requireOperacionContext` —el gate de las siete
actions de datos de `/admin/operacion`— tenía la lista de roles escrita a mano:
admin o encargado. La spec 140 sumó `terminal` (la compu del salón) y actualizó
la matriz de secciones, que es la que lee el page-gate… pero no esta lista. La
terminal entraba a la página y **todos** sus refetch volvían «No tenés permisos
para esta operación». Como `refetchSalon` se traga el error a propósito (es un
refresh de fondo: un plano vacío en medio del servicio es peor que uno de hace
dos segundos), el síntoma no era un cartel sino un plano **congelado**: asignabas
los mozos, la DB los guardaba, y la pantalla seguía igual hasta recargar. Justo
en la máquina donde se distribuyen los mozos.

## Las decisiones

**D1 · El nombre va escrito, debajo de la mesa.** No un badge, no una inicial:
el nombre, afuera del dibujo de la mesa y derecho. El color es el del mozo (el
mismo de su punto en la leyenda) pero dos escalones más oscuro —un 500 sirve
para un punto, no para una letra chica— y con halo blanco, para que se lea
también sobre la foto de fondo del salón.

**D2 · El desempate es progresivo y por grupo.** Con un solo Juan la mesa dice
«Juan», aunque el apellido esté cargado: agregar «B.» a todo el mundo es ruido.
Cuando dos comparten el nombre de pila —y sólo entre ellos— aparece la inicial
del apellido en mayúscula con punto: «Juan B.» / «Juan C.». Si además comparten
la inicial, se suman las que faltan («Juan P. L.» / «Juan P. R.») y, como último
recurso, el nombre completo. Dos nombres idénticos quedan idénticos: no se
inventa un dato que no está.

**D3 · El nombre no rota con la mesa.** El `translate` y el `rotate` de la mesa
van en grupos separados: el nombre cuelga del primero. Una mesa girada 90° no
deja el nombre acostado.

**D4 · El nombre no le gana al número de la mesa.** Su tamaño se cuelga del
rótulo de la mesa (75 %) con piso de 9 y techo de 13: en las mesas de 45 pt del
plano real el proporcional solo quedaba ilegible, y en las grandes el nombre
gritaba más que el número.

**D5 · El atajo escucha en el documento.** No en el div del panel. Anda desde
donde estés, que es lo que promete la ayuda de atajos. Se corta con un modal
propio abierto (alta de producto, menú del día, cancelar ítem), con un envío en
vuelo, y con un diálogo de afuera encima.

**D6 · `Ctrl/⌘+Enter` no es del buscador.** Su handler de `Enter` ahora deja
pasar la tecla cuando viene con modificador.

**D7 · El gate de las actions sale de la matriz, no de una lista.** Una sola
fuente de verdad: si `sectionAccess("operacion", rol)` abre la página, sus datos
también. Las tabs que la terminal no ve (caja, rendición, pedidos de mostrador —
spec 140 · D2) piden explícitamente acceso `full`.

**D8 · Un refetch que falla deja rastro.** Sigue sin toast (es de fondo), pero
va a la consola: un error de permisos no es transitorio, se repite en cada
refetch y congela la pantalla sin que nadie se entere. Eso fue exactamente lo que
faltó para ver este bug.

## Alcance

### Nuevo

- `src/lib/mozo/mozo-short-name.ts` — `buildMozoShortNames(mozos)`: `user_id` →
  cómo se llama en el plano. Puro y testeado (D2). Los mozos sin nombre cargado
  quedan afuera del mapa: mejor una mesa sin rótulo que una que diga «?».

### Tocado

- `src/lib/mozo/colors.ts` — la paleta suma `ink` (el 700 de cada color) y
  `mozoInkColor(userId)`, para escribir en vez de pintar.
- `src/components/mozo/floor-plan-viewer.tsx` — `mozoInitial` → `mozoLabel` +
  `mozoInk`; fuera el círculo de iniciales; el nombre debajo de la mesa; el
  `transform` partido en `place` / `spin` (D3).
- `src/components/admin/local/salon-desktop.tsx` — arma los nombres cortos y se
  los pasa al plano; la leyenda usa el mismo rótulo que la mesa (con el nombre
  completo en el `title`); `refetchSalon` loguea el error (D8).
- `src/components/mozo/product-search-box.tsx` — `Enter` con modificador sube
  (D6).
- `src/app/[business_slug]/mozo/mesa/[id]/pedir/pedir-client.tsx` — el atajo pasa
  a un listener de documento (D5).
- `src/app/[business_slug]/admin/(authed)/operacion/actions.ts` —
  `requireOperacionContext` mira `sectionAccess`; `soloSupervision` para caja,
  rendición y pedidos (D7).

### Tests

- `mozo-short-name.test.ts` — 9 casos del desempate (D2).
- `floor-plan-viewer.test.tsx` — el nombre debajo, con el color del mozo, sin el
  círculo viejo; que no rote; mesa sin mozo sin rótulo.
- `pedir-client.enviar-teclado.test.tsx` — envía con el foco afuera; desde el
  buscador envía y no agrega; con un envío en vuelo no manda dos veces. Los tres
  fallan contra el código viejo.
- `tab-data-actions.test.ts` — la terminal refresca salón/reservas/fichaje y
  sigue sin poder leer caja ni rendición.

Sin migración: no toca datos.

## Verificación en vivo

`demo`, negocio de pruebas, con la sesión de la **terminal del salón** (el rol
donde estaba el bug):

- El plano rotula «Sofía», «Diego», «Pedro» debajo de las mesas, cada uno en su
  color.
- Distribuir mozos → pintar T6 con Pedro → «Listo»: el nombre queda en el plano y
  la leyenda suma «Pedro Mozo · 1 mesa». Sin recargar.
- Carga de la mesa: tipear «Coca» y apretar Ctrl+Enter no agrega nada; con el
  foco en el `body` (después de un click al aire) el atajo manda la comanda
  («Enviado · 1 comanda»).

## Queda afuera (anotado)

Una mesa asignada al usuario `terminal` se rotula «Mozo» en la leyenda y sin
nombre en el plano: `getMozosByBusiness` filtra por `admin|encargado|mozo` y la
terminal no está. Es preexistente y es territorio de la spec 140 (la regla de
atribución), no de ésta.
