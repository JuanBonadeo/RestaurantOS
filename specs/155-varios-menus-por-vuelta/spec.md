# 155 · Cargar varios menús del día de una, por vuelta de mesa

**Issue:** [#232](https://github.com/gachetponzellini/RestaurantOS-app/issues/232) ·
**Milestone:** Post-demo · Growth & hardening ·
**Estado:** 📋 propuesta (2026-09-03) — sin implementar

**Input:** Juan, 2026-09-03: *"faltaría para que pueda cargar varios menús al mismo
tiempo, como que cargue primero todas las bebidas, después todos los platos y así"*.

Cierra el **punto 15** del [ingest de la encargada](../../../wiki/sources/2026-09-03-audios-encargada-golf.md):

> *"Cuando te quiero poner un menú ejecutivo […] no me deja poner dos de una."* (13:04)
>
> *"Estaría bueno que se pueda seleccionar todo junto, porque si no es medio
> engorroso, recién lo estuve haciendo."* (13:14)

**Depende de**: [`072`](../072-menu-del-dia-por-pasos/spec.md) (el asistente por
pasos que se generaliza), [`074`](../074-grupos-condicionales-menu-del-dia/spec.md)
(los grupos condicionales — el nudo de esta spec),
[`083`](../083-modificadores-en-el-menu-del-dia/spec.md) (los modificadores del
producto elegido), [`029`](../../../wiki/specs/29-menu-del-dia-opciones-con-adicional/)
(el adicional por opción, que define cuánto sale cada línea).

---

## Por qué

### Lo que hoy significa «cantidad 2»

El asistente tiene **un solo mapa de selecciones para toda la sesión**, y la
cantidad al final ([`daily-menu-wizard.tsx`](../../src/components/mozo/daily-menu-wizard.tsx)):

    const [selections, setSelections] = useState<DailyMenuSelections>(new Map())
    const [quantity, setQuantity] = useState(1)
    const lineTotal = (menu.price_cents + delta) * quantity

O sea: **cantidad 4 = cuatro menús idénticos.** Misma bebida, mismo principal,
misma guarnición. Para cuatro menús distintos —el caso normal de una mesa de
cuatro— hay que recorrer el asistente entero **cuatro veces**.

Por eso la encargada dice que «no la deja poner dos de una» aunque el `+`/`−`
exista: existe, pero sólo sirve cuando los comensales piden exactamente lo mismo.

### Y es al revés de cómo se toma el pedido

En la mesa el mozo no resuelve un comensal entero y después pasa al siguiente. Da
**la vuelta por paso**: *«¿qué toman?»* — anota las cuatro bebidas — *«¿y de
principal?»* — anota los cuatro platos. Lo que pide Juan es que el asistente se
parezca a eso.

### El server ya lo soporta

`enviarComanda` recibe `items` como **array** y acepta N entradas
`kind: "daily_menu"`, cada una con sus `selected_choices` (`comandas/actions.ts`).
Varios menús distintos en la misma tanda ya se persisten bien: cada uno arma su
padre + sus hijos, con su propio precio.

**Esta spec es UI. No toca server, ni modelo, ni migración.**

## El nudo: los grupos condicionales

Lo difícil no es la pantalla de contadores. Es que **los pasos dejan de ser
uniformes**.

La spec 074 permite que un grupo se dispare sólo para ciertas opciones — en
golf-jcr, «Guarnición» aparece si elegís Milanesa o Suprema, y no si elegís
Ñoquis. Con cuatro menús donde hay **2 milanesas y 2 ñoquis**, el paso
«Guarnición» aplica **sólo a dos de las cuatro líneas**.

Eso descarta el modelo ingenuo —*elegir todo por paso y combinar al final*—,
porque cuando llega el paso condicional hay que saber **a qué líneas les
corresponde**. La combinación tiene que construirse mientras se avanza, no
después.

## Las decisiones

**D1 · La cantidad se pregunta primero, no al final.** Hoy es el último paso
porque una sola línea no necesita saberlo antes. Con N líneas el número define
todo lo que viene, así que abre el asistente: *«¿cuántos menús?»*. Con **1**, el
asistente es exactamente el de hoy — mismo recorrido, mismos atajos, cero cambio
para el caso más frecuente.

**D2 · Cada paso se resuelve con contadores, no comensal por comensal.** El paso
«Bebida» de 4 menús no pregunta cuatro veces: muestra las opciones y se toca
`Gaseosa` dos veces, `Agua` una, `Vino` una, con el contador a la vista y un
«faltan 2». Es como se canta el pedido en la mesa, y es lo que hace que cargar
cuatro cueste poco más que cargar uno.

**D3 · Las líneas se arman progresivamente, y la atribución es arbitraria a
propósito.** Después de cada paso, las elecciones se reparten entre las N líneas
en orden. Que la línea 1 se quede con la gaseosa y la 3 con el vino **no
representa quién pidió qué**: nadie capturó ese dato y el sistema no lo pretende.
Lo que importa es que el conjunto sea correcto — la cocina recibe los platos y la
cuenta suma el total, y las dos cosas son invariantes ante cómo se reparta.

**D4 · El paso condicional se pregunta sólo para las líneas que lo disparan, y lo
dice.** Elegidos 2 milanesas y 2 ñoquis, «Guarnición» aparece con **2 por
elegir** y el encabezado aclara para cuáles («para las 2 milanesas»). Sin esa
aclaración el mozo cuenta cuatro y el contador dice dos: parece un bug.

**D5 · El total es la suma de las líneas, no el precio × cantidad.** Con
adicionales por opción (spec 029) cada línea puede valer distinto: la que lleva
copa de vino suma su delta y la de agua no. `lineTotal = (price + delta) * qty`
deja de servir; el asistente muestra el **total del bloque** y, si los deltas
difieren, el desglose. La plata no se puede resumir mal por prolijidad de UI.

**D6 · Sale como N ítems, no como uno con cantidad N.** Cada menú viaja como su
propia entrada `daily_menu` en el payload —que es lo que el server ya
espera— con sus `selected_choices`. Un ítem con `quantity: 4` y un solo set de
opciones es justamente lo que hoy no alcanza.

**D7 · No se toca el modelo ni el server.** Sin migración y sin cambios en
`enviarComanda`: lo único que cambia es cuántas entradas manda el cliente y cómo
las junta. Eso mantiene la spec chica y reversible.

## Alcance

- **`src/components/mozo/daily-menu-wizard.tsx`** — el asistente pasa de una
  selección a **N líneas**: paso de cantidad al frente (D1), pasos con contador
  (D2), reparto progresivo (D3), filtrado del condicional por línea (D4) y
  resumen final con el desglose (D5).
- **Un helper puro** (`daily-menu-lineas.ts`): dado el menú, la cantidad y lo
  elegido hasta el momento, devuelve las N líneas en construcción y **qué falta
  del paso actual**. Toda la lógica de reparto y de condicionales vive ahí, fuera
  del JSX, que es lo único que hace testeable el nudo de D4.
- **Los tres callers del asistente** (mesa, para llevar y venta rápida) reciben un
  array de líneas en vez de `(menu, quantity, selections)`.

## Qué NO entra

- **Atribuir cada opción a un comensal.** Ni el modelo ni la comanda lo necesitan
  (D3). Si algún día hace falta —para dividir la cuenta por persona— es otra
  spec, y arranca por capturar el dato, que hoy nadie pide.
- **Cambiar el server, el payload o el modelo** (D7).
- **Los productos sueltos.** Cargar 4 gaseosas ya funciona con la cantidad del
  `ProductModal`: ahí no hay pasos ni opciones por línea.
- **El caso de 1 menú**, que sigue idéntico (D1).

## Escenarios de aceptación

1. **Dado** un menú del día, **cuando** se abre el asistente y se elige **1**,
   **entonces** el recorrido es el de hoy, con los mismos atajos de teclado.
2. **Dado** que se eligen **4**, **cuando** llega el paso «Bebida», **entonces**
   se pueden marcar 2 gaseosas, 1 agua y 1 vino, con el contador mostrando
   cuántas faltan, y no se avanza hasta completar las 4.
3. **Dado** 2 milanesas y 2 ñoquis en el principal, **cuando** llega
   «Guarnición» (condicional), **entonces** pide **2** y aclara que son para las
   milanesas.
4. **Dado** un menú donde una opción suma adicional, **entonces** el total del
   bloque es la **suma de las 4 líneas**, no `precio × 4`.
5. **Dado** el bloque confirmado, **entonces** se agregan **4 ítems** al pedido
   —uno por menú, con sus opciones— y la comanda sale con los platos repartidos
   por sector como siempre.
6. **Dado** el paso final, **cuando** se corrige una elección, **entonces** se
   vuelve derecho al resumen sin repetir los pasos ya resueltos (se conserva el
   `returnToConfirm` de la spec 072).

## Verificación

Pendiente — sin implementar.

Al implementar, el grueso va en los tests del helper puro: reparto con opciones
mixtas, condicional que aplica a un subconjunto, cantidad 1 (que no debe cambiar
nada), y el total con adicionales distintos por línea. El verify en vivo va en
`demo` con el Menú Ejecutivo, cargando 4 con platos distintos:

    node scripts/magic-link.mjs sofia@demo.test "/demo/admin/operacion"

Y conviene cerrarlo mostrándoselo a la encargada de Golf: el pedido es suyo, y el
punto 15 quedó abierto justamente porque lo que describía no cerraba con lo que
el código hacía.
