# Feature Specification: El menú del día pregunta los modificadores del producto elegido

**Feature Branch**: `083-modificadores-en-el-menu-del-dia`

**Created**: 2026-08-04

**Status**: 🚧 En implementación. Issue [#132](https://github.com/gachetponzellini/RestaurantOS-app/issues/132). Milestone: Post-demo · Growth & hardening.

**Input**: Pedido de Juan 2026-08-04 — *"si en un menu cargan unos ñoquis, a la hora de cargar un pedido con esto debería dejar elegir los modificadores de ese producto, así sería más fácil, así no hay que poner salsas"*.

## Contexto y problema

Un menú del día se arma con opciones que son **productos reales** (spec 29). Cuando el mozo carga el combo, cada opción elegida se convierte en un `order_item` hijo que rutea a su sector y entra en la comanda.

Los productos ya saben pedir lo que les falta: `modifier_groups` + `modifiers` — texto puro, con `is_required`, `min/max_selection` y `price_delta_cents`. Cargando unos **Ñoquis sueltos**, el `ProductModal` del mozo ya pregunta la salsa, valida el grupo obligatorio, persiste en `order_item_modifiers` y la comanda sale con `+ Bolognesa`. Funciona end-to-end.

Cargando **los mismos Ñoquis dentro del menú del día, no pregunta nada.** El asistente manda `modifier_ids: []` fijo ([`daily-menu-wizard.tsx`](../../src/components/mozo/daily-menu-wizard.tsx)) y `enviarComanda` inserta los hijos sin tocar `order_item_modifiers` ([`comandas/actions.ts`](../../src/lib/comandas/actions.ts)). El campo viaja en el payload y no lo lee nadie. La decisión **D-MDR-2** del wiki dice *"SI modifiers en items del combo (se aplican al order_item hijo)"* — está declarada desde el principio y nunca se implementó.

La consecuencia práctica la vivimos hoy: para que el menú preguntara la salsa hubo que crear 9 productos «Salsa (menú)» a $0 y un grupo de opciones paralelo, duplicando algo que el catálogo **ya tenía y mejor**. golf-jcr tiene cargado «Salsa para pasta» en Ñoquis, Tallarines, Ravioles, los tres Sorrentinos, Crepes y Lasagna: 15 salsas, con Fileto/Tuco/Rosa/Crema/Oliva/Mixta que ni siquiera existen como productos sueltos, y con los adicionales ya diferenciados. Esa carga paralela se revirtió al escribir esta spec.

## Requisitos

### FR-001 — Elegir una opción con modificadores abre su paso

En el asistente del mozo, cuando la opción elegida en un grupo tiene grupos de modificadores, aparece **un paso por cada grupo**, inmediatamente después del grupo que lo trajo y antes del siguiente grupo del menú.

Elegir Ñoquis en «Plato Principal» inserta el paso «Salsa para pasta» ahí mismo. Cambiar a Milanesa lo saca y —si la Milanesa trae «Guarnición»— pone el suyo.

El contador `Paso N de M` los cuenta, igual que ya hace con los grupos que aparecen y desaparecen (spec 074).

### FR-002 — Obligatorio de a uno se comporta como los otros pasos

Un grupo con `is_required` y `max_selection === 1` (el caso de «Salsa para pasta») se dibuja y se navega **exactamente igual** que un grupo de opciones del menú: lista de una columna, primera opción enfocada, ↓/↑, `1`–`9`, Enter elige **y avanza**, ← vuelve. El mozo no tiene que aprender nada nuevo.

### FR-003 — Los opcionales y los de varias selecciones se confirman

Un grupo que admite más de uno (`max_selection > 1`) o que no es obligatorio (`min_selection === 0`) no puede auto-avanzar: hay que poder elegir dos, o ninguno.

Se dibuja con checkboxes; Enter marca y desmarca sin moverse, y el paso se cierra con un botón **Seguir** que recibe el foco con `→` o Tab. Con `min_selection > 0` sin cubrir, Seguir queda deshabilitado y dice cuántos faltan. Al llegar al tope de `max_selection` las opciones no elegidas se deshabilitan.

### FR-004 — El adicional del modificador se cobra

Decidido con Juan: dentro del menú del día los `price_delta_cents` **se cobran igual que a la carta**. Elegir Bolognesa (+$4.500) en un menú de $24.000 lo deja en $28.500.

El delta se suma al `unit_price_cents` del **ítem padre**, igual que el `extra_price_cents` de las opciones (spec 29), y los hijos siguen en $0 — invariante de `is_combo_component`, que sostiene reportes, caja y cuenta.

Como toca plata: el total se re-deriva **siempre** de la DB en el server. El cliente informa qué eligió (`modifier_ids`), nunca cuánto sale.

### FR-005 — Lo elegido llega a la cocina

Los modificadores del hijo se persisten en `order_item_modifiers` (con `modifier_name` de snapshot, como ya hace el flujo suelto), así que la comanda del sector sale con `+ Bolognesa` debajo del ítem sin tocar el ticket: el renderer ya los imprime.

### FR-006 — El servidor rechaza lo que el cliente no debería mandar

Extendiendo el validador de la spec 074, contra los datos de la DB:

1. cada `modifier_id` pertenece a un grupo **del producto de esa opción** — no se puede colar el modificador de otro plato;
2. cada grupo `is_required` del producto elegido tiene cubierto su `min_selection`;
3. ningún grupo supera su `max_selection`.

Si no valida, se rechaza la orden entera y no se persiste nada. Es la misma guarda que ya existe para los productos sueltos, que hoy los hijos del combo no tienen.

### FR-007 — La carta pública hace lo mismo

El cliente que arma el menú del día desde la web resuelve los mismos modificadores, con la misma regla de precio. La lógica de qué pasos hay y cuánto suma es **una sola función pura** compartida por las dos UIs y los dos caminos de persistencia — mismo criterio que la spec 074 (FR-005).

### FR-008 — El resumen explica el precio

En el paso final del asistente, cada elección muestra sus modificadores debajo y el `+$` que aportan. El `daily_menu_snapshot` guarda el desglose (nombre + delta), que es lo que después explica en la cuenta por qué el menú salió $28.500 y no $24.000.

## Fuera de alcance

- **Modificadores de los componentes fijos** (`kind='product'`). Hoy los hijos de los fijos los arma el server desde `components` y el cliente no manda nada sobre ellos; habilitarlos implica un canal nuevo en el payload. Se anota como deuda: un menú con «Milanesa» fija y «Punto de cocción» obligatorio no lo va a preguntar.
- Que el editor del menú del día permita **ocultar** algún modificador del producto para ese menú (ej. no ofrecer Pomarola +$14.500 dentro del ejecutivo). Se ofrecen todos los del producto.
- Modificadores en el ítem **padre** del combo.

## Criterios de aceptación

1. En el Menu Ejecutivo, elegir Ñoquis abre el paso «Salsa para pasta» con sus 15 opciones; elegir Milanesa no lo abre.
2. `1`–`9`, ↓/↑ y Enter funcionan en ese paso igual que en los del menú.
3. Elegir Bolognesa deja el total en $28.500 y el paso final lo muestra desglosado.
4. La comanda de Cocina sale con «Ñoquis» y debajo «+ Bolognesa».
5. Un payload con un `modifier_id` de otro producto, o sin cubrir un grupo obligatorio, es rechazado y no persiste nada.
6. Un grupo opcional de varias (`Guarnición` 0-1) se puede dejar vacío y el asistente avanza igual.
7. `pnpm typecheck` y `pnpm test` en verde.
