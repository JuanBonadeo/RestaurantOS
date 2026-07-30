# Feature Specification: Opciones que habilitan (o no) otros grupos del menú del día

**Feature Branch**: `074-grupos-condicionales-menu-del-dia`

**Created**: 2026-07-30

**Status**: 📋 Propuesta — sin issue todavía. Milestone tentativo: Post-demo · Growth & hardening.

**Input**: Pedido de Juan 2026-07-30 — *"en los menus hay muchos platos principales que no permiten guarnicion, entonces habria que poner un check, que si lleva o no guarnicion, o otro grupo, asi es bien general la regla y sirve para todos los negocios"*.

## Contexto y problema

Un menú del día se arma con `daily_menu_components`. Los de `kind='choice'` que comparten `choice_group_id` forman un **grupo de opciones**, y cada grupo es una decisión obligatoria de exactamente una opción (**D-MDR-4** / **D-MDR-6**, ver [`wiki/features/menu-del-dia.md`](../../../../wiki/features/menu-del-dia.md)). La [spec 072](../072-menu-del-dia-por-pasos/) convirtió eso en un asistente: un paso por grupo, en orden de `sort_order`.

El modelo asume hoy que **todos los grupos aplican siempre**. En la práctica no es cierto: un menú con «Principal» + «Guarnición» funciona para la milanesa y el bife, pero los ravioles, la cazuela o el risotto **vienen con lo suyo** y no llevan guarnición. Hoy el mozo igual tiene que elegir una — el asistente le planta el paso — y termina cargando una guarnición fantasma que va a la comanda, sale impresa en la cocina y queda en el `daily_menu_snapshot`.

Lo mismo pasa al revés con cualquier par de grupos: «Postre» que no aplica al menú infantil, «Bebida» que no aplica a la opción que ya la incluye. Por eso la regla que hay que escribir no es «guarnición sí/no» sino **«esta opción no habilita este otro grupo»**, sin nombres de dominio hardcodeados y sin nada específico de golf-house.

### Lo que ya está roto y esta spec arregla de paso

`resolveComboUpcharge` ([`combo-pricing.ts`](../../src/lib/orders/combo-pricing.ts)) valida que **cada opción elegida exista** en el menú, pero **no** valida que haya exactamente una por grupo requerido. Hoy la regla D-MDR-4 la sostiene **sólo el cliente**. Como las opciones llevan `extra_price_cents` (spec 29), un payload armado a mano puede mandar cero opciones de un grupo caro, o dos del mismo grupo, y el server lo acepta. Es un camino de plata sin guarda — principio técnico 7 (*si toca dinero, test primero*).

## Modelo de datos

Migración **`0033`**, aditiva:

```sql
alter table public.daily_menu_components
  add column if not exists blocks_choice_group_ids uuid[] not null default '{}';
```

Una opción (`kind='choice'`) lista los `choice_group_id` que **no aplican** cuando se la elige. Array vacío = todo sigue como hoy, así que ningún menú existente cambia de comportamiento.

## Requisitos

### FR-001 — El encargado marca, por opción, qué grupos no aplican

En el editor del menú del día, cada opción de un grupo muestra un check por cada **grupo posterior** del mismo menú, rotulado con su `choice_group_label`: *«Lleva Guarnición»*, *«Lleva Postre»*. Tildado (default) = ese grupo aplica; destildado = no aplica y el grupo se saltea.

El rótulo sale del `choice_group_label` que cargó el encargado — la palabra «guarnición» no está en el código.

### FR-002 — Sólo se puede condicionar un grupo posterior

Una opción sólo puede bloquear grupos cuyo `sort_order` mínimo sea **mayor** que el de su propio grupo. Si «Guarnición» viene antes que «Principal», el mozo ya la eligió cuando llega la regla. Se valida al guardar (Zod + `check` no alcanza para esto: es una regla entre filas, va en la action) con un mensaje concreto: *«Guarnición se decide antes que Principal — movela después para poder condicionarla.»*

Los checks del formulario **sólo muestran** los grupos posteriores, así que la vía normal no permite construir el caso inválido; la validación en la action es la red por si el orden se cambia después.

### FR-003 — El asistente recalcula los pasos en vivo

`buildMenuSteps` deja de ser función del menú y pasa a ser función del **menú + las elecciones actuales**: un grupo entra en la lista de pasos sólo si ninguna opción ya elegida lo bloquea.

- Elegir «Ravioles» en Principal → el paso Guarnición desaparece y se avanza directo al siguiente grupo (o al paso de confirmación).
- El contador `Paso N de M` usa el **M proyectado con lo elegido hasta ahora**, y puede achicarse o agrandarse al cambiar una opción. Es la lectura honesta: el menú realmente tiene menos pasos.
- Un grupo que quedó bloqueado no aparece en los puntitos de progreso.

Todo el recorrido de teclado de la [spec 072](../072-menu-del-dia-por-pasos/) (↓/↑, Enter, `1`–`9`, ←/Backspace, Esc) sigue igual: cambia qué pasos hay, no cómo se navegan.

### FR-004 — Volver atrás y cambiar descarta lo que dejó de aplicar

Si el mozo eligió «Milanesa» → «Papas», vuelve con ← y cambia a «Ravioles», la elección de Guarnición **se descarta** (D-GCM-4). Si vuelve a «Milanesa», el paso Guarnición reaparece **vacío**, con el foco en la primera opción.

Nunca puede quedar en `selections` una elección de un grupo que no aplica: es la invariante que hace que el paso de confirmación, el precio y el payload sean consistentes sin chequeos extra.

### FR-005 — La carta pública respeta la misma regla

El menú del día también se arma desde la web (`[business_slug]/(public)`, vía [`menu.ts`](../../src/lib/menu.ts)). El cliente final ve exactamente el mismo condicionamiento: elegir una opción que bloquea un grupo hace desaparecer ese grupo del formulario.

La lógica es la **misma función pura** que usa el mozo. No se escribe dos veces.

### FR-006 — El servidor rechaza lo que el cliente no debería haber mandado

Un validador puro nuevo, compartido por los **dos** caminos de persistencia — `enviarComanda` ([`comandas/actions.ts`](../../src/lib/comandas/actions.ts)) y `persist-order` ([`orders/persist-order.ts`](../../src/lib/orders/persist-order.ts)) — verifica contra los componentes leídos de la DB:

1. cada `choice_group_id` **activo** (no bloqueado por lo elegido) tiene **exactamente una** opción elegida — cierra el hueco preexistente de D-MDR-4;
2. **ninguna** elección corresponde a un grupo bloqueado;
3. (ya existía) cada opción pertenece al grupo que dice.

La resolución es de punto fijo sobre las elecciones recibidas: se parte del set de grupos, se aplican los bloqueos de las opciones elegidas y se compara el resultado con lo que llegó. Si no cierra, se rechaza la orden entera y no se persiste nada.

El precio se sigue derivando de la DB, nunca del payload (invariante de spec 29). Un grupo bloqueado **no puede** aportar `extra_price_cents`.

### FR-007 — El grupo que no aplica no aparece en ningún lado

Ni en el resumen del paso final, ni en el `daily_menu_snapshot`, ni en la comanda impresa, ni en la cuenta. No es «Guarnición: ninguna» — sencillamente no está.

## Decisiones

- **D-GCM-1 · La regla vive en la opción, no en el grupo.** Se podría modelar al revés («Guarnición aplica sólo a estas opciones de Principal»), con menos filas. Pero el encargado piensa por plato — *«los ravioles no llevan guarnición»* — y edita el plato, no la guarnición. La forma del dato sigue a la forma de la decisión.
- **D-GCM-2 · Columna `uuid[]`, no tabla puente.** Los componentes de un menú **siempre se leen enteros** en una sola query, en cuatro caminos distintos (`menu.ts`, `daily-menus-query`, `comandas/actions`, `persist-order`); una tabla puente les agrega un join a todos. Y el array no pierde integridad referencial que hoy exista: `choice_group_id` **ya es un uuid pelado sin FK** — los grupos no son una tabla. Si algún día se promueven a tabla propia, esto se normaliza con ella.
- **D-GCM-3 · Sólo hacia adelante.** Bloquear un grupo anterior es lógicamente imposible en un asistente secuencial (FR-002). No se soporta ni se emula.
- **D-GCM-4 · Descartar, no estacionar.** Al desactivarse un grupo, su elección se borra en vez de guardarse por si vuelve. Estacionar sería más amable si el mozo va y viene, pero deja estado zombie que hay que sincronizar con el precio, el resumen y el payload en cada transición. El costo real es bajo: volver a la opción original obliga a reelegir una guarnición, que es un Enter.
- **D-GCM-5 · Se cierra el hueco de D-MDR-4 en el server.** No es alcance nuevo: sin eso, FR-006 valida la regla nueva y deja pasar la vieja, que es peor que no validar nada porque da sensación de cobertura.
- **D-GCM-6 · Alcance: sólo menú del día.** Los `modifier_groups` de un producto suelto tienen la misma forma y el mismo problema latente (*«el bife a la plancha no lleva punto de cocción»*), pero son otro modelo, otro editor y otros caminos de lectura. Queda como extensión posible una vez que esta regla esté probada en producción.

## Lo que NO entra

- Condicionar por **cantidad** («si pedís 2 principales, 1 guarnición»).
- Grupos **opcionales** (hoy todo grupo activo es obligatorio; esta spec cambia *cuáles* están activos, no su obligatoriedad).
- Reglas encadenadas de más de un nivel más allá de lo que sale solo del punto fijo (una opción bloquea un grupo cuya opción bloqueaba otro — funciona por construcción, pero no se diseña UI para explicarlo).
- Extender la regla a `modifier_groups` (D-GCM-6).

## Riesgos

- **`Paso N de M` que se mueve.** Aceptado y explícito (FR-003). La alternativa —contar siempre todos los grupos y saltearlos en silencio— miente sobre cuánto falta.
- **Menú editado con el panel abierto.** Ya existía (spec 072, `initialOptionIndex` cae a 0 si lo elegido ya no está); acá suma el caso de un grupo bloqueado que desaparece. El server es la última palabra (FR-006), así que lo peor es un rechazo con mensaje, no una orden mal cobrada.
- **Menú mal configurado** donde toda opción bloquea el mismo grupo: ese grupo no aparece nunca. No es un error de datos, pero el editor debería avisarlo (warning, no bloqueo) — mismo criterio que `warnGarnishModifierGroups`.
