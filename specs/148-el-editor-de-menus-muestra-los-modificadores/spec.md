# 148 · El editor de menús muestra los modificadores que trae cada producto

**Issue:** [#224](https://github.com/gachetponzellini/RestaurantOS-app/issues/224) ·
**Milestone:** Post-demo · Growth & hardening ·
**Estado:** ✅ implementado (2026-09-03)

**Input:** Juan, 2026-09-03, después de diagnosticar la guarnición doble:
*"ahora habría que hacer algo para corregir que el primer problema no pase de
vuelta: a la hora de crear los menús, debería en un cartel decir que los
modificadores de cada producto se siguen usando, y que los muestre"*.

**Depende de**: [`083`](../083-modificadores-en-el-menu-del-dia/spec.md) (los
modificadores del producto dentro del combo — lo que esta spec hace visible),
[`074`](../074-grupos-condicionales-menu-del-dia/spec.md) (los grupos
condicionales, la otra mitad de la colisión),
[`087`](../087-grupos-del-menu-como-entidad/spec.md) y
[`076`](../076-editor-menu-reordenar-y-borrar/spec.md) (el editor que se toca).

---

## Por qué

La spec 083 le dio a los combos una capacidad grande: si el producto elegido
dentro de un menú tiene modificadores, el asistente los pregunta. Elegís Ñoquis y
te pregunta la salsa, sin que el menú tenga que declarar nada. Funciona, y es lo
correcto.

Lo que nadie previó es que **quien arma el menú no ve eso en ninguna parte**.

[`daily-menu-form.tsx`](../../src/components/admin/daily-menus/daily-menu-form.tsx)
son **1199 líneas sin una sola ocurrencia de `modifier`**. Y
[`product-picker.tsx`](../../src/components/admin/daily-menus/product-picker.tsx)
—el buscador con el que se elige cada opción del menú— trae exactamente tres
columnas:

    select id, name, image_url from products where ...

Así que el que arma el menú elige «Milanesa» y no tiene forma de saber que la
Milanesa arrastra un grupo «Guarnición» propio. Si además le pone al combo un
grupo llamado «Guarnición», el asistente va a preguntar **dos veces** — y eso no
se descubre en el editor: se descubre en el salón, en hora pico, como le pasó a
la encargada de Golf.

El dato existe en la base. La pantalla simplemente no lo muestra.

### Está peor de lo que decía el diagnóstico

El triage del ingest cerró en «Milanesa y Suprema del Menu Ejecutivo». Verificado
contra el cloud, la colisión está en **dos menús activos**:

| Menú | Grupo condicional | Se dispara con | Productos que ya traen un modifier «Guarnición» |
|---|---|---|---|
| Menu Ejecutivo ($24.000) | «Guarnicion» | 5 productos | Milanesa, Suprema |
| **Menú ($42.000)** | «Guarnición» | **12 productos** | Milanesa, Suprema, **Suprema Napolitana** |

En total, `golf-jcr` tiene **31 pares producto-con-modificador** dentro de menús
del día. Y acá está la parte que define el diseño: **la mayoría son legítimos**.
El Puré trae «Variante», las Papas traen «Estilo de papas», las pastas traen
«Salsa para pasta» (obligatoria), el Helado trae «SABORES». Todos esos son
exactamente lo que la spec 083 quería: elegís la guarnición y después de qué.

O sea que esto **no se resuelve prohibiendo**. Se resuelve mostrando.

## Las decisiones

**D1 · Se muestran siempre, no sólo cuando hay conflicto.** El problema de fondo
no es la colisión: es que el editor esconde una parte del comportamiento del
menú. Elegido un producto, debajo queda la lista de sus grupos de modificadores
con una línea que diga qué va a pasar — *«al elegir esta opción, el sistema va a
preguntar además: Salsa para pasta (obligatoria)»*. Con eso, el que arma el menú
ve el asistente completo antes de guardarlo.

**D2 · La duplicación se destaca, pero no se bloquea.** Cuando el nombre de un
grupo de modificadores del producto coincide con el de un grupo del combo
—comparando sin tildes, sin mayúsculas y sin espacios, porque en golf-jcr conviven
«Guarnición» y «Guarnicion»— el aviso sube de tono: *«el combo ya pregunta
Guarnición; este producto la va a preguntar de nuevo»*. Sigue siendo un aviso.
Bloquear el guardado sería adivinar: puede haber un caso donde preguntar dos
cosas parecidas tenga sentido, y el que arma el menú sabe más que la validación.

**D3 · El grupo condicional avisa al elegir sus disparadores.** El caso real de
golf-jcr nace ahí: el grupo «Guarnición» se marca condicional y se le eligen 12
productos disparadores, tres de los cuales ya traen su propia guarnición. Ese
selector es donde el error se comete, así que ahí también va la marca — junto a
cada producto que ya pregunta lo mismo.

**D4 · El picker trae los modificadores en el mismo viaje.** Una columna más en
el select que ya existe (`modifier_groups(id, name, is_required)`), no una query
nueva por producto. El editor de menús no es una pantalla de hora pico y el costo
es un join.

**D5 · No se toca el asistente de carga.** Esta spec es prevención en el editor.
Que el asistente **deje de preguntar dos veces** cuando la colisión ya existe es
el otro trabajo (punto 1 del ingest), y son decisiones distintas: acá se hace
visible, allá se decide qué gana. Una spec no depende de la otra.

**D6 · No se arreglan los datos de golf-jcr.** Los dos menús activos que hoy
tienen la colisión siguen igual hasta que alguien los edite. Cambiar la
configuración de un menú en producción, sin el local mirando, es meterse con lo
que se cobra: sale por el otro camino y con la encargada al tanto.

## Alcance

- **`src/components/admin/daily-menus/product-picker.tsx`** — el select suma
  `modifier_groups(id, name, is_required)`; `PickedProduct` los expone.
- **`src/components/admin/daily-menus/daily-menu-form.tsx`** — debajo de cada
  producto elegido (componente fijo y opción de grupo), el bloque informativo de
  D1 y el aviso de D2. En el selector de disparadores del grupo condicional, la
  marca de D3.
- **Un helper puro y testeable** (`daily-menu-modifiers.ts` o similar): dado el
  producto y los grupos del combo, devuelve qué va a preguntar el asistente y
  cuáles se pisan. La normalización de nombres de D2 vive ahí, no en el JSX.
- **Sin migración.** Todo el dato ya está en `modifier_groups`.

## Qué NO entra

- **Cambiar el comportamiento del asistente** (D5).
- **Bloquear el guardado** de un menú con duplicación (D2).
- **Arreglar los menús de golf-jcr** que hoy la tienen (D6).
- **El editor de productos.** Que la Milanesa tenga un grupo «Guarnición» propio
  está bien y es lo que hace falta cuando se pide suelta. El problema aparece
  sólo dentro de un combo.
- **La carta pública.** Ahí el combo se arma igual, pero el pedido es sobre el
  editor: el que se equivoca es el que configura, no el que compra.

## Escenarios de aceptación

1. **Dado** el editor de un menú del día, **cuando** se elige un producto que
   tiene grupos de modificadores, **entonces** debajo aparecen listados con su
   nombre y si son obligatorios, y una línea que explica que el asistente los va
   a preguntar.
2. **Dado** un producto sin modificadores, **entonces** no aparece ningún bloque
   (no se agrega ruido donde no hay nada que avisar).
3. **Dado** un combo con un grupo «Guarnición», **cuando** se elige como opción
   un producto que ya trae un grupo «Guarnicion», **entonces** el aviso dice que
   se va a preguntar dos veces — y el menú **se puede guardar igual**.
4. **Dado** ese mismo caso con tildes y mayúsculas distintas, **entonces** la
   coincidencia se detecta igual.
5. **Dado** un grupo condicional, **cuando** se eligen los productos que lo
   disparan, **entonces** los que ya preguntan lo mismo quedan marcados en la
   propia lista.
6. **Dado** el Puré con su «Variante» dentro de un grupo «Guarnición»,
   **entonces** se lista como información y **no** como conflicto: los nombres no
   coinciden y el caso es legítimo.

## Verificación

**Tests** — 13 en el helper puro
([`daily-menu-modifiers.test.ts`](../../src/lib/daily-menus/daily-menu-modifiers.test.ts)):
normalización con tildes/mayúsculas/espacios, producto sin modificadores,
producto con varios, marcado de sólo el que se pisa, grupo sin nombre que no
matchea con otro sin nombre, y el caso legítimo del escenario 6 (que **no** da
conflicto). Más 6 en el editor
([`daily-menu-form.test.tsx`](../../src/components/admin/daily-menus/daily-menu-form.test.tsx)),
incluida la de D2: con la colisión a la vista, el menú **se guarda igual**.
`pnpm typecheck` en verde; 624 unitarios pasan (los `*.integration.test.ts`
fallan con `fetch failed` porque piden el stack local, ruido conocido).

**En vivo** — `demo`, como admin, en `/demo/admin/menu-del-dia/nuevo`, armando a
propósito la colisión (no se guardó nada):

    node scripts/magic-link.mjs admin@demo.test "/demo/admin/menu-del-dia/nuevo"

1. Grupo «Principal» con Milanesa → *«Al elegir esta opción, el asistente va a
   preguntar además: Guarnición (opcional)»* (escenario 1).
2. Segundo grupo llamado «Guarnicion», **sin tilde** → el bloque de la Milanesa
   pasa a *«se pregunta dos veces»* + *«El combo ya pregunta «Guarnicion»; este
   producto la va a preguntar de nuevo. Se puede guardar igual…»* (escenarios 3
   y 4).
3. Puré en ese mismo grupo → *«Variante (opcional)»* como información, **sin**
   conflicto (escenario 6).
4. «Sólo si en Principal eligieron:» → la Milanesa queda marcada con *«ya
   pregunta «Guarnición»»* (escenario 5).

Es el único caso de esta tanda donde el rol correcto **no** es Sofía: la
encargada no edita menús.

## Lo que se decidió al implementar

**El componente fijo dice lo contrario.** La spec pedía el bloque también
debajo del componente fijo (`kind='product'`), pero la spec 083 dejó los fijos
explícitamente fuera de alcance: sus hijos los arma el server desde
`components` y el cliente no manda modificadores
([`comandas/actions.ts`](../../src/lib/comandas/actions.ts),
[`persist-order.ts`](../../src/lib/orders/persist-order.ts)). Escribir ahí «el
asistente va a preguntar además» sería mentir. Se muestra igual —el que arma el
menú necesita saber que la Milanesa fija **no** va a preguntar el punto de
cocción— con el texto invertido y sin detección de conflicto.

**La query del admin también trae los modificadores.** D4 sólo nombraba el
picker, pero un menú ya guardado no mostraría nada hasta re-elegir cada
producto — y los dos menús de golf-jcr con la colisión son menús existentes.
`daily-menu-query.ts` suma la misma columna al select que ya tenía.
