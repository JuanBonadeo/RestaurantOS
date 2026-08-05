# Feature Specification: El grupo de opciones del menú del día pasa a ser una entidad

**Feature Branch**: `087-grupos-del-menu-como-entidad`

**Created**: 2026-08-04

**Status**: ✅ Implementada y aplicada (2026-08-05). Issue [#138](https://github.com/gachetponzellini/RestaurantOS-app/issues/138). Milestone: Post-demo · Growth & hardening. Queda el verify en vivo con sesión real de encargado.

**Input**: Pedido de Juan 2026-08-04 — *"claramente la lógica de los menús quedó muy fea, repensémosla toda, por lo menos para cargarlos; yo creo que tendría que haber grupo de opciones que sean condicionales, es decir que dependiendo qué producto se agarra te deje o no, algo mejor planeado, más prolijo"*.

## Contexto y problema

El editor del menú del día quedó feo, y **no es un problema de UI**: el "grupo de opciones" no existe como entidad. Es un uuid pelado (`daily_menu_components.choice_group_id`, sin tabla ni FK) repetido en N filas, con el nombre denormalizado en cada una (`choice_group_label`). Todo lo demás es consecuencia:

- El **orden** de un grupo es la posición de su primera opción en un array plano global (`sort_order` = índice del array, lo persiste `syncComponents`). Eso obligó a inventar [`component-order.ts`](../../src/lib/daily-menus/component-order.ts): normalizar contigüidad, mover tarjetas de a una posición, descartar reglas al mover ([spec 076](../076-editor-menu-reordenar-y-borrar/)).
- La **condición** es negativa y vive en la opción (`blocks_choice_group_ids` = «qué grupos NO habilita esta opción»), y sólo puede mirar hacia adelante *porque el orden es implícito* (D-GCM-3). En pantalla son N×M casillas «Lleva X» tildadas por defecto: con 3 grupos de 5 opciones son **15 casillas para expresar una sola regla**.
- Renombrar un grupo escribe en las N filas. Un grupo no puede existir vacío. El nombre de la opción no es editable (se copia del producto).
- Dentro de `ChoiceGroupCard` no hay un solo `FormMessage`: los errores de validación de las opciones **no se ven**, y «Guardar» no hace nada visible.

El contraste está en el mismo repo: los `modifier_groups` del catálogo **sí** son entidad (tabla con nombre y parámetros + tabla hija), y [su editor](../../src/components/admin/catalog/modifier-groups-editor.tsx) es notablemente más prolijo. La prueba más dura de que el modelo aprieta es lo que pasó el mismo día: hubo que inventar 9 productos «Salsa (menú)» a $0 en producción para expresar algo que el catálogo ya sabía decir ([spec 083](../083-modificadores-en-el-menu-del-dia/)).

## Decisiones

Tomadas con Juan antes de empezar:

- **D-087-1** · Se rediseña **modelo + editor**, no sólo la UI. La fealdad del editor es un síntoma.
- **D-087-2** · La condición se escribe **en positivo y por grupo**: «Guarnición aplica sólo si en Plato Principal eligieron Milanesa, Suprema o Merluza». Una regla, en un solo lugar, editada donde se lee. Revierte **D-GCM-1** (la 0033 había elegido la forma negativa por opción con el argumento «la forma del dato sigue a la forma de la decisión»; con el editor en la mano se ve que el encargado no toca plato por plato, toca el grupo).
- **D-087-3** · **Sin cardinalidad**: sigue valiendo «exactamente 1» (D-MDR-4 / D-MDR-6). Columnas `min/max/is_required` que el runtime no honra serían dato adelantándose al código.

## Requisitos

### FR-001 — El grupo es una fila

Tabla `daily_menu_choice_groups`: `id`, `menu_id`, `name`, `sort_order`, `applies_when_group_id`, `applies_when_product_ids`. Los `id` **se reusan** de los `choice_group_id` actuales, así que el payload de red, los carritos en localStorage y los `daily_menu_snapshot` ya escritos quedan intactos.

### FR-002 — La condición es positiva y de una sola fuente

`applies_when_group_id IS NULL` = aplica siempre. Si no, el grupo aplica sólo si **ese** grupo está activo y lo elegido en él está en `applies_when_product_ids`. Fuente inactiva ⇒ este grupo tampoco aplica (propaga).

Difiere del modelo viejo en el caso encadenado: antes, un grupo fuente inactivo dejaba de emitir bloqueos y el grupo condicionado **volvía** a estar activo. La semántica nueva es la intuitiva; la auditoría (T0) verificó que no hay ningún encadenado cargado, así que el cambio es gratis.

### FR-003 — La condición sólo puede apuntar a un grupo anterior

Se conserva D-GCM-3, pero como **constraint del editor** (el selector sólo ofrece grupos anteriores) y no como poda de datos: ya no hace falta descartar reglas al reordenar.

### FR-004 — El editor deja de ser una grilla de casillas

Cada grupo muestra, debajo de sus opciones, una sola línea de regla:

```
Aplica:  ( ) siempre
         (•) sólo si en [Plato Principal ▾] eligieron:
             ☑ Milanesa   ☑ Suprema   ☐ Ñoquis   ☐ Ravioles   ☑ Merluza
```

Mueren las 15 casillas «Lleva X» y los párrafos de ayuda que explicaban la doble negación. El selector sólo ofrece grupos anteriores, así que la regla de «sólo hacia adelante» dejó de ser algo para explicar.

### FR-005 — Los menús cargados se comportan igual

Test de paridad: sobre un fixture con la forma de los menús reales, recorrer **todas** las combinaciones de elecciones y exigir que el modelo viejo y el nuevo devuelvan el mismo conjunto de grupos activos.

## Tramos

Cada uno queda verde y desplegable solo; la migración va siempre antes que el código que la lee.

- **T0 · Auditoría** ✅ — 8 menús, 11 grupos, 54 opciones. **Una sola regla condicional en todo el sistema**: «Guarnición» del Menu Ejecutivo de golf-jcr, bloqueada por 4 de los 9 principales. Sin ≥2 fuentes, sin encadenados, sin huérfanos, sin bloqueos hacia atrás, sin grupos muertos, sin `choice` sin grupo ⇒ **la migración es automática**. Un hallazgo: «Agua Mineral» está **duplicada** en el grupo Bebida del Menu Ejecutivo (mismo producto dos veces) — bloquea el unique parcial planeado para T4.
- **T1 · Migración `0036` + backfill** ✅ — tabla, RLS, y traducción de la condición. La regla de Guarnición quedó como `applies_when = Plato Principal ∈ {Arrollado Casero, Merluza Romana, Milanesa, Omelette, Suprema}`, exactamente el complemento. Sin FK todavía: el editor actual genera el uuid sin crear grupo.
- **T2 · La action sincroniza los grupos** ✅ — en vez de esperar al editor, `syncChoiceGroups` **deriva** los grupos de los componentes en cada guardado, con la misma traducción que el backfill (`choice-groups.ts`, 13 tests). Eso es lo que permitió que los lectores pasaran a la tabla sin coordinar un deploy: guarde quien guarde, con el editor que sea, la tabla queda consistente.
- **T3 · Lectores y lógica pura** ✅ — los 5 selects traen la tabla; `activeChoiceGroups` evalúa la condición del grupo y cae al modelo viejo si no viene. **Test de paridad**: sobre un menú con la forma del real, las 200 combinaciones de elecciones dan el mismo conjunto activo por los dos caminos.
- **T4 · Editor nuevo + FK** ✅ — la pantalla de FR-004; el `superRefine` pasa de 40 líneas a validar una condición por grupo. Migración `0037` con el FK compuesto `(menu_id, choice_group_id)` (`not valid` + `validate`) y el unique parcial `(choice_group_id, product_id)`. Antes hubo que borrar el duplicado que encontró T0.
- **T5 · Contracción** ✅ — `validateComboChoices` resuelve por la condición del grupo y los dos caminos de persistencia se la pasan, así que nadie lee ni escribe ya `blocks_choice_group_ids` ni `choice_group_label`. La migración `0038` que las dropea **se aplicó el 2026-08-05**.

  El drop destapó dos lugares que seguían sacando el **nombre** del grupo de la columna denormalizada y habrían quedado en blanco: el editor (`card.label` sale de `choice_group_label` del componente, así que los grupos se veían sin nombre) y el snapshot de `enviarComanda` (habría caído al literal «Opción»). Los dos ahora lo toman de la fila del grupo. Es la clase de acople que sólo se ve cuando la columna deja de existir — el argumento para contraer y no dejar la columna «por las dudas».

  Rollback en [`rollback-0038.sql`](rollback-0038.sql): no es un volcado de datos sino el inverso exacto del backfill, así que no se pone rancio. Antes de dropear se verificó contra las 53 filas reales que reconstruye ambas columnas con **cero diferencias**.

### Desviación del plan

`component-order.ts` **no se borró**. El plan lo daba por muerto porque asumía que el editor pasaría a `useFieldArray` anidado; se mantuvo la lista plana con tarjetas (menos invasivo, y el objetivo —que la regla se edite en un lugar— se logra igual), así que `toCards` / `moveCard` / `normalize` siguen en uso. Lo que sí quedó obsoleto es `pruneBlocks`: la condición ya no puede quedar mirando hacia atrás, porque el selector sólo ofrece grupos anteriores.

## Fuera de alcance

Deuda que apareció en la auditoría y merece su propia issue: el ticket de cuenta imprime el padre del combo como «—» (usa `products.name` en vez de `product_name` y no filtra `is_combo_component`); `persistOrder` no cobra ni persiste los modificadores de combo (hueco de la spec 083 en el camino público); `enviarComanda` no valida `available_days` y hace N+1; los dos escritores de `daily_menu_snapshot` guardan formas distintas y nadie lee `selected_choices`; colisión de numeración en `0033_*` y `0034_*`.

## Criterios de aceptación

1. Cargar un menú con 3 grupos donde uno es condicional no requiere tocar ninguna casilla «Lleva X».
2. El asistente del mozo muestra y esconde el paso igual que antes de la migración (test de paridad en verde).
3. Renombrar un grupo escribe en una sola fila.
4. Un error de validación de una opción se ve en la pantalla.
5. `pnpm typecheck` y `pnpm test` en verde en cada tramo.
