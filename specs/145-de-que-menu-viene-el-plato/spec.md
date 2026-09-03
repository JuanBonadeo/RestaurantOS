# 145 · La comanda no dice de qué menú viene el plato

**Issue:** [#221](https://github.com/gachetponzellini/RestaurantOS-app/issues/221) ·
**Milestone:** Post-demo · Growth & hardening ·
**Estado:** 📋 propuesta (2026-09-03) — sin implementar

**Input:** la encargada de golf-jcr, 2026-09-03, mandando audios mientras usaba
el sistema en pleno almuerzo:

> *"Ahí mandé dos menús ejecutivos y me dice que no le salta a ellos qué es menú
> ejecutivo. Sale como un menú común, y no es el mismo precio que yo va… pero en
> realidad no es el mismo tamaño de las cosas."*

Traducido: la cocina recibe «Milanesa» y manda la milanesa de la carta. El menú
ejecutivo de golf-jcr sale $24.000 y la porción es otra.

**Depende de**: [`051`](../051-print-agent-render-server/spec.md) (el render vive
en el server y el agente es relay), [`083`](../083-modificadores-en-el-menu-del-dia/spec.md)
(los modificadores del hijo, que ya viajan sin tocar el renderer),
[`128`](../128-la-observacion-de-la-tanda/spec.md) (el último campo aditivo que
entró al ticket, y el molde de éste).

---

## Por qué

Un combo se guarda partido en dos ([`comandas/actions.ts:805`](../../src/lib/comandas/actions.ts)):

- el **padre** lleva `daily_menu_id`, el nombre del menú, el precio y el snapshot
  de lo elegido, con `product_id: null` y **sin `station_id`**;
- los **hijos** llevan `parent_order_item_id`, `is_combo_component: true`,
  `unit_price_cents: 0` y **su propio `station_id`**, el del producto.

O sea: **el que sabe que esto es un menú no va a ninguna comandera, y los que van
no lo saben.** No es una hipótesis. En `golf-jcr`:

| | ítems | con `station_id` | llegaron a una comanda |
|---|---|---|---|
| padre (combo) | 10 | **0** | **0** |
| hijo de combo | 25 | 15 | 8 |
| suelto | 71 | 56 | 42 |

El pedido **8** es el caso completo, y muestra que el problema es peor que un
rótulo faltante:

| sector | lo que se imprimió | de dónde venía |
|---|---|---|
| Fritera | `1x Milanesa` + `Puré` | Menu Ejecutivo |
| Cocina | `1x Puré` + `Calabaza` | Menu Ejecutivo (**el mismo**) |

Dos sectores, dos tickets, un solo comensal, y ninguno de los dos papeles dice
«Menú Ejecutivo». La Fritera manda la milanesa a la carta. Y el bloque «COMBINA
CON» de ese ticket lista `- 1x Puré` como si fuera un plato suelto de otra mesa,
cuando es la guarnición del mismo plato.

### La causa, en una línea

[`TicketItem`](../../src/lib/print/ticket.ts) tiene cuatro campos:

    product_name, quantity, notes, modifiers

Ninguno dice de qué combo viene el hijo. El dato **existe en la base**
(`parent_order_item_id` → el padre → su `product_name`); lo que falta es subirlo
al payload y bajarlo al papel.

Y el mismo agujero está en pantalla: [`local-query.ts:239`](../../src/lib/admin/local-query.ts)
ya calcula un `is_combo` booleano para cada ítem del KDS… que
[`comandas-kanban.tsx`](../../src/components/admin/local/comandas-kanban.tsx) mapea
y **nunca pinta**. La cocina que mira la pantalla está tan a ciegas como la que
mira el papel.

## Las decisiones

**D1 · Un campo aditivo y opcional, y la paridad de bytes deja de ser un
problema.** `TicketItem` suma `combo_name?: string | null`. Ausente ⇒ el ticket
sale **byte-idéntico** al de hoy, así que los cinco fixtures congelados de
`__fixtures__/tickets.json` siguen pasando sin regenerar nada. Es exactamente el
molde que ya usaron `delivery_type`, `otros_sectores`, `kitchen_notes`,
`kitchen_time`, `comanda_notes` y `daily_number`: todos entraron al ticket así, y
todos están documentados en el tipo con la misma frase — *«Campo aditivo: los
fixtures congelados no lo traen»*. Este no inventa nada, sigue el camino.

**D2 · La marca va ARRIBA del plato, no abajo.** El renglón se lee antes que el
nombre porque cambia **cómo** se lee lo que sigue — es el mismo criterio con el
que la observación de la tanda (spec 128) se puso entre el encabezado y los
ítems y no al final. Abajo, pegado a los modificadores, se leería como un
ingrediente más:

    MENU EJECUTIVO          ← tall, bold (nuevo)
    1x Milanesa             ← xl, bold (como siempre)
    + Pure                  ← tall

**D3 · En `tall`, no en `xl`.** El cuerpo `xl` está reservado para lo que cambia
el **momento de salida** (`ENTREGAR`, `ANULADA`, `REIMPRESION`) y para el
encabezado que se lee de lejos. La pertenencia al menú se lee con el ticket ya en
la mano, junto con el plato: misma jerarquía que `OBS:`. Además, dos renglones en
doble ancho seguidos compiten entre sí y ninguno gana.

**D4 · El nombre sale del padre, y es snapshot.** Se usa `order_items.product_name`
del padre —congelado al enviar la comanda— y no `daily_menus.name` de hoy. Si el
admin renombra el menú a mitad de servicio, la reimpresión saca el ticket que
salió, no uno nuevo. Es la misma regla que ya rige `modifier_name` en
`order_item_modifiers`.

**D5 · El «COMBINA CON» también lo lleva.** `agruparOtrosSectores` tiene el mismo
agujero y es el que produce el `- 1x Puré` huérfano del pedido 8. Sin esto,
arreglar el bloque de arriba y dejar el de abajo mintiendo empeora el ticket:
queda un plato marcado como del menú y su guarnición, tres renglones más abajo,
marcada como si fuera de otro.

**D6 · El KDS pinta lo mismo que el papel.** `local-query.ts` ya trae
`parent_order_item_id`; pasa a traer el nombre del combo y el kanban lo dibuja
arriba del nombre del ítem, con la misma jerarquía visual que en papel. El
`is_combo` booleano que hoy no se usa se reemplaza por el nombre — un booleano
que nadie pinta no es una feature, es una variable muerta.

**D7 · El padre sigue sin ir a ninguna comandera.** Tentación descartada: darle
`station_id` al padre imprimiría un renglón «Menu Ejecutivo» sin platos en algún
sector arbitrario, que no le sirve a nadie y encima duplicaría el ítem en el KDS.
La marca viaja **con cada hijo**, que es donde está el trabajo.

**D8 · El fallback del agente se actualiza en el mismo commit.** El agente es un
relay (spec 051): imprime los bytes que manda el server, así que con sólo tocar
`ticket.ts` la comanda ya sale bien en golf. Pero `print-agent/agent.mjs` conserva
su copia local del formato para cuando el server no pre-renderiza, y la regla
escrita en `ticket.test.ts` es explícita: si el formato cambia a propósito, el
módulo del server **y** el fallback se tocan juntos. Se respeta, aunque el camino
del fallback casi nunca corra.

## Alcance

### Payload

- **`src/lib/print/ticket.ts`** — `TicketItem` suma `combo_name?: string | null`,
  documentado como aditivo igual que sus hermanos. `buildTicketLines` lo imprime
  arriba del ítem (`tall` + `bold`, `wrap` a `COLS.tall`) sólo cuando viene.
  `TicketSectorHermano.items` lo hereda por ser del mismo tipo: el «COMBINA CON»
  pasa a rendear `- 1x Puré (Menu Ejecutivo)` en su renglón `tall`.
- **`src/app/api/print-agent/route.ts`** — dos lugares:
  - el `select` de `comanda_items.order_items` suma `parent_order_item_id` y el
    embed del padre. El FK self-referencial existe y se llama
    `order_items_parent_order_item_id_fkey` (verificado contra el cloud), así que
    PostgREST lo resuelve con `parent:order_items!order_items_parent_order_item_id_fkey(product_name)`.
    Si el embed anidado dentro de `comanda_items` diera problema, la salida es
    una segunda query por ids —el patrón que `agruparOtrosSectores` ya usa— y no
    cambia nada del resto de la spec.
  - `agruparOtrosSectores` suma lo mismo a su `select` de `order_items` (D5).
- **`print-agent/agent.mjs`** — la misma línea en el fallback local (D8).

### Pantalla

- **`src/lib/admin/local-query.ts`** — el ítem del KDS cambia `is_combo: boolean`
  por `combo_name: string | null`, resuelto desde el padre embebido.
- **`src/components/admin/local/comandas-kanban.tsx`** — lo pinta arriba del
  nombre, chico y en mayúsculas, en las dos listas (activos y cancelados).
- **`src/components/shared/editar-items-modal.tsx`** y los dos call-sites que hoy
  pasan `is_combo: false` a mano (`order-detail-sheet.tsx:296`,
  `salon-desktop.tsx:160`) se ajustan al tipo nuevo. El modal usa el flag para
  gatear la edición de precio del combo (spec 049) — esa lógica no cambia, pasa a
  preguntar por `combo_name != null`.

## Qué NO entra

- **Numerar los menús de una misma comanda.** Con dos ejecutivos en la misma
  tanda, los cuatro platos van a decir «MENU EJECUTIVO» sin distinguir cuál va
  con cuál. Para la porción —que es el pedido— alcanza; para el pase haría falta
  un ordinal estable por comanda que hoy no existe. Si la cocina lo pide, es otra
  spec.
- **Darle `station_id` al padre** (D7).
- **La cuenta impresa y la factura.** Ahí el combo ya sale bien: el padre es el
  que tiene el precio y es el que se lista. Este problema es sólo de cocina.
- **El bug de la guarnición doble.** El pedido 8 lo muestra de paso —la Milanesa
  tiene el modificador «Puré» *y* hay un hijo «Puré» aparte, que es la misma
  guarnición elegida dos veces— pero eso es un problema de datos del menú de
  golf-jcr (el `modifier_group` del producto pisándose con el grupo condicional
  del combo) y se arregla en otro lado. Anotado en
  `wiki/sources/2026-09-03-audios-encargada-golf.md`, punto 1.

## Escenarios de aceptación

1. **Dado** un menú ejecutivo con la milanesa en Fritera y el puré en Cocina,
   **cuando** el mozo lo manda, **entonces** los dos tickets dicen `MENU
   EJECUTIVO` arriba de su plato.
2. **Dado** ese mismo pedido, **cuando** la Fritera mira su bloque «COMBINA CON»,
   **entonces** el puré aparece identificado como del mismo menú y no como un
   plato suelto.
3. **Dado** un pedido de productos sueltos, **entonces** el ticket sale
   **exactamente igual** que antes de esta spec — byte por byte.
4. **Dado** un payload sin `combo_name` (un server viejo, o los fixtures
   congelados), **entonces** el renderer imprime el ticket de siempre y no una
   línea vacía.
5. **Dado** el KDS con un menú ejecutivo en preparación, **entonces** cada plato
   del menú se ve marcado en la tarjeta, igual que en el papel.
6. **Dado** que el admin renombra el menú después de mandar la comanda,
   **cuando** se reimprime, **entonces** sale el nombre con el que se envió (D4).
7. **Dado** un hijo de combo anulado, **entonces** su renglón sigue saliendo
   `ANULADO` como hoy, con la marca del menú arriba.

## Verificación

Pendiente — la spec no está implementada.

Al implementar, el piso es: los 5 casos de paridad de
`ticket.test.ts` **sin regenerar fixtures** (si hay que regenerarlos, el campo
dejó de ser aditivo y la decisión D1 se rompió en algún lado), tests nuevos del
renderer (marca presente / ausente / en el «COMBINA CON» / con nombre largo que
tiene que cortar por palabra a `COLS.tall`), y `pnpm typecheck` + `pnpm test` en
verde.

El verify en vivo tiene una particularidad que conviene resolver antes de
empezar: **el ticket sale por una impresora física del local**. En `demo` se
puede validar el payload y el `content_plain` que devuelve el `GET
/api/print-agent` sin imprimir nada, y el KDS sí se ve completo desde la sesión
de Sofía (encargada):

    node scripts/magic-link.mjs sofia@demo.test "/demo/admin/operacion?tab=comandas"

Para el papel de verdad hace falta golf-jcr y una comandera — coordinarlo con
Juan, o darlo por verificado contra `content_plain`, que es literalmente lo que
el agente imprime.
