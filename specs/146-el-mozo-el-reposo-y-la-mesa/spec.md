# 146 · El mozo se elige desde la mesa, el reposo del panel es el buscador, y «La mesa» no se esconde

**Issue:** [#220](https://github.com/gachetponzellini/RestaurantOS-app/issues/220) ·
**Milestone:** Post-demo · Growth & hardening ·
**Estado:** implementada, verificada en vivo (2026-09-03)

> El número salió 146 y no 145: otra sesión tomó el 145 (*«de qué menú viene el
> plato»*, [#221](https://github.com/gachetponzellini/RestaurantOS-app/issues/221))
> mientras ésta se escribía.

**Input:** la **encargada de Golf**, 2026-09-03, en nueve audios mandados
*mientras usaba el sistema* (triage completo en
[`wiki/sources/2026-09-03-audios-encargada-golf.md`](../../../wiki/sources/2026-09-03-audios-encargada-golf.md),
puntos 4 y 5) + Juan sobre la misma pantalla.

- *"Si yo abro una mesa que no tiene un mozo asignado, no encuentro dónde poner
  el mozo. Me da solamente la opción de distribuir los mozos, y no quiero
  distribuir los mozos […] no necesito distribuir los mozos en la semana, porque
  estoy con uno solo."* (11:43)
- *"Me parece más simple entrar en la mesa, elegir el mozo y ya empezar a
  comandar, que tener que distribuir el mozo, elegir la mesa, salir y entrar en
  la mesa nuevamente."* (11:44)
- *"La parte esta que dice hoy, el menú del día, menú ejecutivo — eso a mí me
  resulta molesto, porque me confunde. Prefiero tener solamente el buscador,
  buscar lo que necesito […] no sé si habrá alguna manera de sacarlo."* (11:53)
- Juan: *"el sidebar de /operacion, en una pantalla mediana, la parte de «La
  mesa» se esconde y aparece un botón para verla, y eso está mal: no debería
  esconderse nunca. Hay que acomodarlo para que se vean siempre las dos
  partes."* Y sobre el mozo: *"reutilizaría el modal que ya hay para elegir
  mozo, pero que sea teclado-friendly, como el sidebar: flechitas y Enter."*

Tres cosas de la misma pantalla, encontradas en la misma pasada. Van juntas
porque las tres tocan el panel del salón y dos de ellas el mismo archivo.

---

## Por qué

### A · El caso «un solo mozo» no está contemplado

Hay dos caminos para poner un mozo en una mesa y ninguno es el que ella
necesita:

- **Distribuir mozos** ([`asignar-mozos-panel.tsx`](../../src/components/mozo/asignar-mozos-panel.tsx))
  es una paleta: elegís un mozo y pintás el salón. Está pensada para **repartir**
  —ver a todos a la vez con su contador de mesas— y es lo correcto para un
  viernes con seis mozos. Con **uno solo** no hay nada que repartir, y encima
  obliga al rodeo que ella describe: abrir la paleta, pintar la mesa, cerrar,
  volver a entrar a la mesa.
- **Transferir mozo** ([`transfer-table-modal.tsx`](../../src/components/mozo/transfer-table-modal.tsx),
  spec 079) es lo que está usando como workaround — *"tuve que poner como que
  transfería el mozo"*. Y no es lo que quiere hacer: transferir es sacarle la
  mesa a alguien, con notificación al destino. Ella quiere **asignar**, la
  primera vez, sobre una mesa que no tiene dueño.

Falta la tercera puerta: la mesa que ya tiene abierta. El panel de carga —donde
está parada cuando se da cuenta de que falta el mozo— **ni siquiera dice de
quién es la mesa**.

La spec 079 dejó a Distribuir explícitamente afuera de su alcance porque ahí el
objetivo es ver a todos a la vez. Esto no la contradice: suma una entrada, no
cambia las que hay.

### B · El reposo del panel arranca con 270px de tarjetas

En el panel del salón (`embedded`) los menús del día encabezan el catálogo
**siempre**; en la pantalla del mozo, en cambio, viven sólo en la pestaña «Más
pedidos». La diferencia sale de una condición:

```ts
!isSearching && (embedded || activeTab === TOP_TAB_ID) && dailyMenus.length > 0
```

Con la tarjeta de menú (imagen de 96px + nombre + precio + pasos) más el cartel
de «Principales más pedidos», el estado de reposo del panel son ~270px de cosas
que ella no pidió, antes del primer producto. Al escribir en el buscador ya
desaparecen: lo que le molesta es el reposo.

**Lo que hay que resolver bien no es sacarlas.** Es la misma pantalla desde la
que carga los menús ejecutivos todos los mediodías —su trabajo diario— y el
buscador **no los encuentra**: `useProductSearch` mira productos, y un
`daily_menu` no es un producto. Sacar las tarjetas a secas le cambia una queja
por otra peor: el menú del día sin ninguna puerta.

### C · «La mesa» está escondida en todas las pantallas reales

Las dos columnas del panel de carga entran a partir de **672px de panel**
(`@2xl`, spec 115). Abajo de eso la columna de la mesa no se apila: se **oculta**
(`hidden @2xl:flex`) y aparece una pastilla «La mesa» que la abre encima de la
carga.

Medido en vivo, con el panel expandido (spec 122):

| Viewport | Ancho del panel | ¿Dos columnas? |
|---|---|---|
| 1024–1279 | 480 | no |
| 1280 | ~628 | no |
| 1400 | ~648 | **no** — por 24px |
| 1600 | ~740 | sí |

O sea: en la notebook del salón la mesa está escondida **siempre**, y el umbral
se cumple recién en un monitor grande. Lo que se escribió como «modo angosto»
terminó siendo el modo normal.

Y es la mitad que importa: ahí están lo enviado, lo que falta mandar, el total y
«Cobrar». Depender de acordarse de abrir una pastilla para ver el pedido que se
está cargando es exactamente lo que el principio de **cero fricción en hora
pico** no quiere.

---

## Las decisiones

### Parte A · El mozo se elige desde la mesa

**D-A1 · Un solo modal, dos modos, dos actions.** El modal de elegir mozo es
uno solo y el modo sale del estado de la mesa:

| La mesa | Título | Action | Elegir | Auditoría | Notifica |
|---|---|---|---|---|---|
| sin mozo | «Asignar mozo» | `assignMozoToTable` | **confirma** (un paso) | `assignment` | no |
| con mozo | «Transferir mozo» | `transferTable` | marca; confirma el CTA | `transfer` | sí, al destino |

En `asignar` no hay CTA ni motivo: tocar (o Enter sobre) el mozo **es** la
acción, que es el paso de más que el pedido vino a sacar. En `transferir` sigue
habiendo dos pasos, como en la 079: hay un motivo opcional que escribir y al
destino le llega una notificación.

El teléfono del mozo abre siempre en `transferir`, aunque la mesa no tenga
dueño: el mozo no puede asignar (`canAssignMozo`) pero sí **tomar** una mesa
libre, y ese self-claim vive en `transferTable`.

No se unifican las dos actions: asignar **no es** una transferencia. No hay de
quién sacar la mesa, no hay motivo que escribir, y mandarle a un mozo la
notificación «te transfirieron la mesa 12» cuando nunca la tuvo es ruido en el
teléfono de alguien que está laburando. Las dos actions ya existen con sus
permisos y su auditoría (`canAssignMozo` / `canTransferTable`): lo que falta es
la puerta, no el server.

**D-A2 · El modal se maneja con el teclado, como el resto del panel.** La lista
es una zona de `useRovingList` (spec 075): ↑/↓ mueven el **foco real**, Enter
sobre la fila hace lo del modo —asigna, o marca el destino—, Esc cierra. Desde
la última fila, ↓ sigue al motivo (en `transferir`). El buscador de mozos sigue apareciendo
recién a partir de 7 candidatos (spec 079 · FR-002) y ↓ desde el input entra a
la lista, igual que el buscador de productos.

El foco arranca en la primera fila (o en el buscador, si está). En el teléfono
del mozo **no** hay autofoco: el teclado virtual se come justo la lista que
venís a mirar (era el comentario de la 079, y sigue valiendo). Va por prop
`conTeclado`, que prende la superficie: el salón sí, el teléfono no.

**D-A3 · La puerta nueva es una pastilla en el header de la mesa.** Al lado del
estado, donde ya viven «Ocupada · 24 min · Orden #7 · 2 personas», entra el
mozo: **«Sin mozo»** o el nombre, en su color. Es un botón para quien puede
asignar (`canAssignMozo`: admin, encargado, terminal) y un rótulo para quien
no. Aparece en las dos superficies del panel:

- el **panel de carga** (`pedir-client.tsx` embebido), que es donde está parada
  cuando lo necesita: entrar a la mesa, tocar «Sin mozo», elegir, y seguir
  comandando sin salir;
- el **detalle de la mesa** (`TableDetail`), donde hoy la pastilla del mozo
  existe pero sólo cuando **hay** mozo — justo al revés de cuando hace falta.

**D-A4 · La mesa libre también se asigna.** El gate de «Transferir mozo» pide
`estado !== "libre"`, y está bien: no se transfiere una mesa que no tiene nada.
Pero desde la spec 111 la mesa **se abre con el primer envío**, así que mientras
ella carga el primer pedido la mesa está `libre` — es exactamente el momento del
audio. La pastilla no mira el estado: mira si hay mozo.

**D-A5 · Optimista, como el pintado.** La asignación pinta el plano y la
leyenda en el acto por el overlay que ya usa la transferencia
(`setOverlay({ [tableId]: { mozo_id } })`), y si el server rechaza vuelve atrás.
Sin esto habría que esperar el refetch para ver el nombre debajo de la mesa
(spec 143).

**D-A6 · «Distribuir mozos» no se toca.** Sigue siendo la herramienta de
repartir el salón, con su paleta, su contador y su «Limpiar». Desasignar
(dejar la mesa sin mozo) también sigue viviendo ahí: el modal elige mozo, no lo
saca.

### Parte B · El reposo del panel es el buscador

**D-B1 · En el panel, el menú del día es una línea, no una tarjeta.** Se cae el
`embedded ||`: la tarjeta grande queda para la pantalla del mozo, que es donde
sirve para mostrarle el plato al cliente. En el panel del salón, el menú del día
se ve como una fila compacta —«Menú del día · Menú Ejecutivo · $35.000»— con la
misma altura que un producto. Un tap abre el asistente igual que antes.

No se van del todo, y es a propósito: es la única puerta al menú ejecutivo del
mediodía y sacarla cambiaría una queja por otra peor. Una fila de 36px no es
«la parte esta que me confunde»; 270px de tarjetas, sí.

**D-B2 · Y ahora se buscan.** «menu», «ejecutivo», «ejec» encuentran los menús
del día en los resultados, arriba de los productos. Es la mitad que faltaba: hoy
el buscador —lo único que ella dice querer— no puede llegar al menú del día ni
tipeando el nombre exacto. La búsqueda es la misma de siempre (sin acentos,
tokens en cualquier orden) y además matchea contra «menú del día», para que la
palabra funcione aunque el negocio los llame «Ejecutivo».

Enter desde el buscador sigue siendo de los **productos** (`results[0]`): al
menú del día se llega con ↓ y Enter. Cambiar eso significaría que la misma tecla
a veces agrega un ítem y a veces abre un asistente de cuatro pasos.

**D-B3 · El cartel de «Principales más pedidos» pasa a ser un rótulo.** En el
panel, el bloque ámbar de tres líneas («Principales más pedidos / Lo que más
sale en los últimos 30 días») se convierte en el mismo rótulo chico en
mayúsculas que usan las demás secciones. Es la misma razón: en la pantalla donde
se carga a las apuradas, un cartel que explica de dónde sale la lista se lee una
vez en la vida y ocupa lugar todos los días.

**D-B4 · Nada de esto es configurable por negocio.** Se evaluó un flag: es una
columna, una migración, un control en el panel y una pregunta más para el que da
de alta un negocio, para resolver una diferencia que —una vez que el menú del
día se busca— no le cambia el trabajo a nadie. Si otro encargado pide la tarjeta
grande en el panel, ahí se discute el flag con dos casos, no con uno.

### Parte C · «La mesa» no se esconde nunca

**D-C1 · Las dos columnas entran desde 600px de panel** (era 672). Es el número
que hace que la tabla de arriba tenga «sí» en todas las filas que existen en la
vida real: con 600, un viewport de 1280 —la notebook del salón— ya muestra las
dos partes.

**El reparto lo hace el contenido, no un porcentaje duro.** El 46% con techo de
520 sigue escrito, pero en un flex row le gana el `flex-1`, y eso es a
propósito: la columna de carga tiene piso —la fila de «Personas», con sus seis
chips, no baja de ~390px— así que un 46% duro a 620 de panel la desbordaba. Con
`flex-1` cada columna arranca en lo que necesita (mesa ~227, carga ~393) y el
sobrante se reparte parejo, así que la mesa crece con la pantalla hasta su techo
de 520.

El umbral es uno solo y vive en el shell (`ANCHO_DOS_COLUMNAS`), que es lo que
mantiene al panel del salón, la hoja de pedidos online y la venta rápida
cambiando juntos (spec 115). También lo lee `useAnchoDePanel`, así que ⌘Enter
sigue sabiendo cuántas columnas hay en pantalla.

**D-C2 · Abajo de 600 se apila, no se esconde.** En un panel angosto la columna
de la mesa deja de ser una hoja que tapa la carga y pasa a ser una franja
**debajo** del catálogo, con su propio scroll y con techo (45% del alto) para no
aplastar al buscador. Es el modo `apilada` que ya usa la venta rápida, y por la
misma razón que allá: el total y el botón no pueden depender de que te acuerdes
de abrir otra vista.

Va abajo y no arriba porque el buscador manda: en esta pantalla se entra a
tipear. El orden del DOM queda carga → mesa, y a partir de 600 la mesa vuelve a
la izquierda con `order-1` —el patrón que ya usan la hoja online y la venta
rápida—. De paso el orden de tabulación pasa a coincidir con la cadena de
teclado (buscador → catálogo → carrito), que hasta ahora iban al revés.

**D-C3 · La pastilla «La mesa» se va.** Con las dos partes siempre visibles no
tiene qué mostrar. Es la única pieza de UI que esta spec borra.

**D-C4 · La hoja de pedidos online hereda el umbral, no el apilado.** Su columna
izquierda es cliente + entrega + carrito, y su paso «datos» es una vista
alternativa a propósito, no una mitad. Hereda los 600px (es el mismo shell) y
nada más.

---

## Alcance

### Nuevo

- `src/components/mozo/elegir-mozo-modal.tsx` — `ElegirMozoModal`, el modal
  único de D-A1/D-A2 (modos `asignar` / `transferir`, lista con roving, Esc,
  buscador ≥7). Reemplaza a `transfer-table-modal.tsx`.
- `src/lib/mozo/daily-menu-search.ts` — `filterDailyMenus(menus, query)`: puro,
  mismo normalizador tolerante que el resto, con el alias «menú del día»
  (D-B2).

### Tocado

- `src/components/mozo/transfer-table-modal.tsx` — **se elimina**; sus dos
  call-sites pasan al modal nuevo.
- `src/components/mozo/panel-de-carga.tsx` — `ANCHO_DOS_COLUMNAS` 672 → 600 y
  el umbral de las clases (`@2xl:` → `@min-[600px]:`); `ColumnaLateral` acepta
  el techo de la franja apilada (D-C1/D-C2).
- `src/app/[business_slug]/mozo/mesa/[id]/pedir/pedir-client.tsx` — pastilla del
  mozo en el header (D-A3); `menusVisibles` sin `embedded ||` + filtrado por
  búsqueda (D-B1/D-B2); la columna de la mesa pasa a `apilada` y detrás de la de
  carga en el DOM; se va `verLoPedido` y su pastilla (D-C3).
- `src/components/admin/local/salon-desktop.tsx` — abre el modal nuevo en los
  dos modos, pastilla del mozo en `TableDetail` (D-A3), overlay optimista
  (D-A5).
- `src/app/[business_slug]/mozo/mozo-client.tsx` — el modal nuevo en modo
  `transferir`, sin autofoco (`conTeclado: false`).
- `src/components/mozo/mesa-column.tsx` — el umbral nuevo, y el vacío deja de
  decir «buscá un producto **a la derecha**»: con la mesa apilada, la carga está
  arriba.
- `src/components/admin/cargar-pedido-sheet.tsx` — el umbral nuevo. En la
  práctica no cambia nada: la hoja mide 448 (`max-w-md`) o 900 (`xl`), nunca
  entre 600 y 672.
- `src/components/admin/local/venta-rapida-panel.tsx` — el umbral nuevo, y el
  `flex-1` que antes ponía el shell pasa a pedirlo ella por `className` (su
  columna se reparte el ancho por contenido, la mesa no). Efecto lateral
  buscado: la venta rápida también entra en dos columnas a 1280, donde antes se
  apilaba.
- `src/components/skeletons/mesa-route-skeleton.tsx` — el umbral nuevo y la
  misma forma apilada, para que el esqueleto no prometa un layout y entregue
  otro.

### Tests

- `elegir-mozo-modal.test.tsx` — ↑/↓ mueven el foco y Enter confirma; modo
  asignar llama `assignMozoToTable` y no muestra motivo; modo transferir llama
  `transferTable` con el motivo; el buscador aparece a partir de 7 y ↓ entra a
  la lista; el elegido que se cae del filtro no se manda (FR-003 de la 079);
  Esc cierra. Hereda lo que probaba `transfer-table-modal.test.tsx`.
- `daily-menu-search.test.ts` — acentos, tokens en cualquier orden, el alias
  «menú del día», y que no matchee cualquier cosa.
- `pedir-client.menu-del-dia.test.tsx` — en el panel, en reposo, el menú del día
  es una fila y no la tarjeta; tipear «ejec» lo trae y «coca» no; ↓ desde el
  buscador llega y Enter abre el asistente.
- `pedir-client.mozo.test.tsx` — el header dice «Sin mozo» y abre el modal; con
  mozo dice el nombre; con rol `mozo` no es botón.
- `pedir-client.dos-columnas.test.tsx` — la mesa se renderiza sin abrir nada y
  no existe ningún botón «La mesa» (el de C, y falla contra el código viejo).

Sin migración: no toca datos.

---

## Verificación

`pnpm typecheck` y `pnpm test` en verde: 2016 unitarios, 0 fallas fuera de los
21 `*.integration.test.ts`, que piden el stack local.

En vivo en `demo`, con la sesión de **Sofía (encargada)** —el rol del pedido, no
admin— a **1280×800**, que es la pantalla donde la mesa estaba escondida:

- Mesa libre (R19) y mesa ocupada (T12): el panel abre con **las dos partes** a
  la vista y sin ninguna pastilla «La mesa». Panel 620 = carga 393 + mesa 227.
- El header dice «Sin mozo» → abre «Asignar mozo · Mesa R19» con el foco puesto
  en la primera fila; ↓ ↓ mueven el foco; elegir a Pedro deja *«Mozo
  asignado.»*, la pastilla pasa a «Pedro Mozo» y **el plano escribe «Pedro»
  debajo de R19 sin recargar** (el overlay optimista), con la leyenda pasando de
  34 a 33 mesas sin asignar.
- Volver a tocar la pastilla con la mesa ya asignada abre «Transferir mozo ·
  Mesa R19», sin Pedro entre los candidatos y con el motivo — la 079 intacta.
- En reposo el catálogo arranca en el buscador: «MENÚ DEL DÍA» es un rótulo con
  una fila («Menú Ejecutivo · $ 35.000») y «MÁS PEDIDOS» también es un rótulo.
- Tipear «ejec» trae el menú del día **y** el producto homónimo; ↓ desde el
  buscador cae en la fila del menú.
- A **1120×800** (panel 480) la mesa queda apilada abajo, con el total y
  «Cobrar» a la vista, y sigue sin haber nada que abrir a mano.

**Lo que no se pudo ejercitar en vivo:** `Enter` sobre la fila enfocada. El
navegador automatizado manda la tecla —llega al botón, sin `preventDefault`— pero
no dispara la activación nativa que hace el click, y le pasa igual a los caminos
de teclado que ya estaban andando (Enter sobre un producto del catálogo, spec
075). Queda cubierto por los tests y por el click, que corre exactamente el mismo
handler.

## Nota de proceso

El `git rm` de `transfer-table-modal.*` de esta sesión quedó **staged** cuando
otra sesión, trabajando sobre el mismo working tree, commiteó su spec 145: su
commit `2081e51` se llevó las dos bajas de archivo. El árbol queda bien recién
con este commit, que trae el reemplazo. Es el riesgo conocido de las sesiones en
paralelo sobre el mismo repo; se anota, no se reescribe historia ya pusheada.
