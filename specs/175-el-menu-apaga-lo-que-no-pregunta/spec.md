# 175 · El menú apaga lo que no quiere preguntar

**Issue:** [#282](https://github.com/gachetponzellini/RestaurantOS-app/issues/282) ·
**Milestone:** Post-demo · Growth & hardening ·
**Estado:** 🚧 en curso

**Input:** Juan, 2026-09-09, cerrando el diagnóstico de
[#280](https://github.com/gachetponzellini/RestaurantOS-app/issues/280):
*«capaz otra solución podría ser que se puedan deshabilitar los modificadores de
un producto en los menús»*.

**Depende de**: [`083`](../083-modificadores-en-el-menu-del-dia/spec.md) (que el
combo pregunte los `modifier_groups` del producto elegido — esta spec le pone el
interruptor), [`148`](../148-el-editor-de-menus-muestra-los-modificadores/spec.md)
(el editor ya los lista y avisa cuándo duplican; acá el aviso pasa a ser
accionable) y [`074`](../074-grupos-condicionales-menu-del-dia/spec.md) / [`087`](../087-grupos-del-menu-como-entidad/spec.md)
(los grupos condicionales del menú, que son el camino que queda cuando se apaga
el del producto).

**Número:** la 173 quedó libre y la 174 está en curso en otra sesión
(«el producto que no existe»). Esta toma la 175.

---

## Por qué

### El puré de la Milanesa

La encargada de Golf, sobre el Menú Ejecutivo: *«no les deja elegir el tipo de
puré si el puré es la guarnición de la Milanesa»*. El diagnóstico completo está
en #280; en una línea: **el mismo menú tiene dos caminos para la guarnición y
sólo uno puede anidar.**

| Camino | Las opciones son | ¿Puede preguntar el tipo de puré? |
|---|---|---|
| `choice_group` del menú | **productos** (`Puré`, con su grupo «Variante») | **sí** — `buildMenuSteps` pega los `modifier_groups` del producto elegido |
| `modifier_group` del producto (la «Guarnición» de la Milanesa) | filas de `modifiers`, que son **hojas** | **no** — no hay `product_id` ni nada de dónde colgar otro grupo |

Cuando el producto trae su propia guarnición, esa gana y el camino bueno nunca
aparece. Y cuando el menú también la pregunta, se pregunta **dos veces** — que
es el otro síntoma del mismo choque, el que reportó el ingest del 2026-09-03.

### El parche que hay hoy, y lo que cuesta

El 2026-09-09 se resolvió por datos en golf-jcr: se crearon `Milanesa (menú)`,
`Suprema (menú)` y `Suprema Napolitana (menú)` —copias sin el grupo «Guarnición»,
`is_active=false`— y los menús activos apuntan a esas copias. Funciona, y se
paga caro:

- **La analítica se parte en dos.** Lo vendido dentro del menú cuenta como
  `Milanesa (menú)`; lo suelto, como `Milanesa`. Ningún reporte los suma.
- **La receta se duplica.** Las 4 líneas de la Milanesa (nalga, rebozador, huevo,
  sal) viven ahora en dos productos. El día que cambie el gramaje hay que
  acordarse de los dos.
- **El catálogo se llena de fantasmas.** Tres productos que existen sólo para no
  preguntar algo.
- **Y no escala:** cada plato nuevo con guarnición propia que entre a un menú
  pide su propio espejo.

Lo que el local quiere decir es una sola cosa —*«acá la guarnición la pone el
menú, vos no preguntes»*— y hoy la única forma de decirla es inventar un
producto.

## Las decisiones

**D1 · Se apagan grupos, uno por uno, no «los modificadores».**

`ignored_modifier_group_ids uuid[]`, no un `skip_modifiers boolean`. El Entrecot
del menú `Menú` tiene «Punto de cocción», que **sí** hay que preguntar: un
interruptor único lo apagaría junto con la guarnición. Lo que choca es un grupo
puntual contra un `choice_group` puntual, y así se escribe.

**D2 · La columna vive en `daily_menu_components`, la fila de la opción.**

No en `products` (apagarlo ahí lo apagaría también a la carta, que es justo lo
que no queremos: la Milanesa suelta tiene que seguir preguntando su guarnición)
ni en `daily_menus` (el menú entero no sabe qué grupo tiene cada plato). La
unidad es **esta opción, en este menú**: `Milanesa` dentro del `Menu Ejecutivo`.

Que sea `uuid[]` y no una tabla puente es a propósito: es la misma forma que ya
tiene al lado `daily_menu_choice_groups.applies_when_product_ids`, se lee en el
mismo `select` sin un embed más, y el orden no significa nada.

**D3 · Apagar un grupo obligatorio es legal, y el server tiene que saberlo.**

La «Salsa para pasta» de los Ñoquis es `is_required` con `min_selection = 1`. Si
un menú la apaga y el server sigue exigiéndola, `enviarComanda` rechaza el envío
con *«Elegí 1 en "Salsa para pasta"»* y el mozo queda trabado sin entender por
qué. El filtro es **el mismo dato en los dos lados**: el cliente no pregunta lo
que el server no va a exigir.

Por eso el filtro no vive en el componente sino en una función pura
(`askableModifierGroups` extendida) que usan la UI y `lib/comandas/actions.ts`.

**D4 · Lo ya vendido no se toca.**

Apagar un grupo cambia lo que se **pregunta de acá en adelante**. Los
`order_item_modifiers` viejos siguen donde están: son el registro de lo que se
sirvió, no una preferencia.

**D5 · El editor lo ofrece donde ya avisa.**

La spec 148 puso `ModificadoresDelProducto`, que lista los grupos de cada opción
y sube el tono cuando el nombre duplica a un grupo del combo. Ahí mismo va la
casilla: el aviso *«"Guarnición" duplica a un grupo de este menú»* deja de ser
sólo información y pasa a tener el interruptor al lado. Sin pantalla nueva.

## Alcance

**Migración `0097_el_menu_apaga_lo_que_no_pregunta.sql`**
`alter table daily_menu_components add column ignored_modifier_group_ids uuid[] not null default '{}'`.
Sin backfill: el default vacío es exactamente la conducta de hoy.

**Dominio (puro, testeable):**
- `lib/orders/combo-modifiers.ts` — `askableModifierGroups(groups, ignoredIds)`:
  un argumento más, opcional, que filtra por id antes de ordenar. Es el único
  lugar donde se decide qué se pregunta, y ya lo usan las dos puntas.
- `lib/mozo/daily-menu-steps.ts` — `buildMenuSteps` y `autoResolvedModifierIds`
  le pasan los ignorados de la opción elegida.

**Lectura:**
- `lib/mozo/daily-menus-query.ts` — la columna entra al `select` y a
  `DailyMenuComponent`.

**Server:**
- `lib/comandas/actions.ts` — el `resolveModifiers` del combo recibe los grupos
  ya filtrados (D3).

**Editor (admin):**
- `lib/daily-menus/daily-menu-modifiers.ts` — el aviso lleva el `id` del grupo.
- `lib/daily-menus/schemas.ts` + `daily-menu-actions.ts` — el campo entra al Zod
  y al guardado.
- `components/admin/daily-menus/daily-menu-form.tsx` — la casilla de D5.

**No se toca** — si el diff los toca, el diseño está mal: `modifiers` y
`modifier_groups` (el modelo del catálogo no cambia), `persist-order.ts` (la
carta pública no pregunta modificadores en los combos: *«los combos cerrados no
se customizan en V1»*), y los productos espejo de golf-jcr, que se revierten
aparte cuando esto esté en producción.

## Qué NO entra

- **`modifiers.product_id`** (la opción C de #280): que un modificador tenga un
  producto detrás y herede sus grupos. Es lo único que arregla la **carta
  suelta** —una Milanesa a la carta sigue sin poder elegir el tipo de puré— y es
  una spec bastante más grande. Esta no la bloquea ni la contradice.
- **Revertir el parche de datos de golf-jcr.** Se hace cuando esto esté en
  producción y verificado, en su propia issue: repuntar los componentes a los
  productos reales, apagar el grupo «Guarnición» en cada opción, y borrar los
  tres espejos.
- **Apagar un `choice_group` del menú.** Para eso ya está la condición de la
  spec 074/087.
- **Renombrar o reordenar grupos desde el menú.** El menú apaga; no edita el
  catálogo.

## Escenarios de aceptación

1. **El puré vuelve a tener variante.** Menú con `choice_group` «Guarnición»
   (opciones: productos `Papas Fritas`, `Puré`) cuyo plato principal es una
   `Milanesa` con su propio grupo «Guarnición» **apagado**: elegir Milanesa lleva
   al paso «Guarnición» del menú, y elegir `Puré` abre «Variante».
2. **Sin apagar, todo sigue igual.** El mismo menú con el array vacío pregunta
   la guarnición del producto, como hoy.
3. **Sólo el grupo apagado.** Una opción con dos grupos («Guarnición» apagado,
   «Punto de cocción» no) sigue preguntando el punto de cocción.
4. **Un obligatorio apagado no traba el envío.** Ñoquis con «Salsa para pasta»
   (`is_required`, `min_selection=1`) apagada: el asistente no la pregunta y
   `enviarComanda` acepta el ítem sin salsa.
5. **Un obligatorio apagado no se auto-resuelve.** `autoResolvedModifierIds` no
   devuelve nada de un grupo ignorado, aunque tenga una sola opción.
6. **Apagar en un menú no apaga en otro.** La misma Milanesa en dos menús: uno
   la apaga, el otro la pregunta.
7. **La carta suelta no se entera.** El `ProductModal` de la Milanesa sigue
   preguntando la guarnición.
8. **Un id que ya no existe no rompe nada.** Si el grupo se borró del producto,
   el array queda con un uuid muerto y el filtro simplemente no matchea.

## Verificación

- `pnpm typecheck` + `pnpm vitest run` en verde.
- En vivo en `demo` con el rol real de la encargada (`sofia@demo.test`): armar
  el escenario 1 desde el editor de menús, cargar el menú en una mesa y ver el
  paso «Variante» después de elegir el puré; enviar la comanda y confirmar que
  el modificador llega al ticket.
