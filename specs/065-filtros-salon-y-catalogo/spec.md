# Feature Specification: Filtro por salón en el operativo + filtros persistidos en el catálogo

**Feature Branch**: `065-filtros-salon-y-catalogo`

**Created**: 2026-07-30

**Status**: ✅ Implementado (2026-07-30) — `pnpm typecheck`, `pnpm lint` y `pnpm build` verdes; `pnpm test` 863 pass / 140 skip (los 16 archivos `*.integration.test.ts` fallan por falta del stack Supabase local, preexistente). Sin migración (no toca datos). **Pendiente:** verify en vivo con rol real. Issue [#102](https://github.com/gachetponzellini/RestaurantOS-app/issues/102). Milestone: Post-demo · Growth & hardening.

**Input**: Pedido de Juan 2026-07-30 — *"hay que permitir en las vistas de operacion, filtrar por salon, pq una encargada que se encarga solo de un salon no quiere ver las otras comandas, y las otras cosas, estaria bueno que haya un filtro que quede en cache, lo mismo con los productos, que se puedan filtrar y que los filtros queden cacheados, yo pondria filtros basicos pero funcionales"*.

## Contexto y problema

**Operativo.** `/admin/operacion` es panorámico por diseño: muestra *todo* el negocio. En golf-jcr eso son varios salones (`floor_plans`) en un mismo `business`. Una encargada que atiende un solo salón ve en la tab Comandas las comandas de los otros salones, y en Reservas las reservas de mesas que no son suyas. Ruido en hora pico, que es exactamente cuando menos se puede leer una pantalla.

Hoy lo único que se filtra por salón es la tab **Mesas**: `SalonDesktop` tiene su propio selector de plano, con la elección guardada en `localStorage` (`salon_active_plan_${businessId}`). Es la prueba de que la preferencia por máquina ya funciona — falta subirla al shell y que gobierne las otras tabs.

**Catálogo.** `/admin/catalogo → Productos` ya tiene búsqueda + chips de categoría ([`catalog-client.tsx`](../../src/components/admin/catalog/catalog-client.tsx)), pero todo vive en `useState`: cada vez que se entra a la sección o se vuelve de editar un producto, los filtros se resetean. Con un catálogo de cientos de productos eso es re-tipear el mismo filtro todo el día. Y no hay forma de ver "qué tengo marcado como no disponible" ni "qué manda a la parrilla", que son las dos preguntas operativas reales sobre el catálogo.

## Requisitos

### FR-001 — Un solo selector de salón, arriba, para todo el operativo

La barra de tabs de `/admin/operacion` incorpora un selector de salón: **«Todos los salones»** + una opción por `floor_plan` del negocio.

- Con **un solo salón** el selector no se muestra (no hay nada que elegir).
- La elección se guarda **por máquina y por negocio** en `localStorage`, clave `operacion_salon_${businessId}`. Sobrevive al refresh y al cierre del navegador; no se sincroniza entre dispositivos (es una preferencia de puesto, no del usuario — misma política que [`useCajaPreferida`](../../src/lib/caja/use-caja-preferida.ts)).
- Si el salón guardado ya no existe (plano borrado), cae a «Todos» sin romper.
- El valor inicial del render es «Todos» y la preferencia se aplica en un effect: el HTML del server y el del primer render del cliente coinciden (sin mismatch de hidratación).

### FR-002 — El filtro sólo se muestra donde aplica

El selector se muestra únicamente con las tabs **Mesas**, **Comandas** y **Reservas** activas. En Caja, Rendición, Fichaje y Pedidos online se oculta.

Es la parte que evita el peor error posible de esta feature: que alguien cierre caja creyendo que el total en pantalla está filtrado por su salón. Un control que no aplica no se muestra.

### FR-003 — Mesas: el salón elegido queda fijado

Con un salón elegido, `SalonDesktop` muestra ese plano y **esconde su selector interno** (deja de haber dos controles para lo mismo). Con «Todos», vuelve a comportarse como hoy: sus propias pestañas de salón, con su preferencia local.

### FR-004 — Comandas: sólo las del salón elegido

La tab Comandas filtra por el salón de la mesa de la orden (`comandas → orders → tables → floor_plan_id`).

Las comandas **sin mesa** (delivery, retiro, venta rápida de mostrador) no pertenecen a ningún salón: con un salón elegido **no se muestran**, y el kanban avisa cuántas ocultó — *«N comandas de delivery / mostrador ocultas por el filtro»*. El aviso es el requisito, no un adorno: sin él, filtrar por salón haría desaparecer comandas reales de cocina sin ninguna señal.

El filtro «ver solo las fallidas» (spec 35) y el de salón se **componen**: filtrar por salón no puede esconder una alerta de impresión que corresponde a ese salón.

### FR-005 — Reservas: sólo las del salón elegido

La tab Reservas filtra por la zona de la reserva: la del `floor_plan` de su mesa, o —si no tiene mesa asignada (modo flexible, [spec 059](../059-reservas-modo-flexible/))— la de su `floor_plan_id` propio. Una reserva sin mesa **y** sin zona queda fuera de cualquier salón puntual y sólo se ve en «Todos».

Aplica también a la página `/admin/reservas`, que comparte el componente `AdminDayList`; ahí el filtro es local a la vista (no se agrega selector propio) — la spec sólo garantiza que el componente **acepte** el filtro y lo aplique bien cuando el operativo se lo pasa.

### FR-006 — Las pills cuentan lo mismo que muestra la tab

Los contadores de Mesas, Comandas y Reservas se calculan **sobre el dato ya filtrado**. Un badge que dice 12 sobre una tab que muestra 3 es peor que no tener badge — y rompe la invariante de [spec 39, FR-012](../../../wiki/specs/) (pill y tab derivan del mismo predicado sobre el mismo dato).

### FR-007 — Catálogo: filtros básicos y persistidos

La tab Productos ofrece tres filtros, todos guardados por máquina + negocio en `localStorage`:

| Filtro | Opciones | Clave |
|---|---|---|
| Categoría | Todas · una por categoría · Sin categoría | `catalogo_prod_categoria_${businessId}` |
| Estado | Todos · Disponibles · No disponibles | `catalogo_prod_estado_${businessId}` |
| Sector | Todos · uno por sector · Sin sector | `catalogo_prod_sector_${businessId}` |

- **Sector** sólo se muestra si el negocio tiene más de un sector cargado.
- Una categoría / sector guardado que ya no existe cae a «Todos».
- Los filtros se **componen** entre sí y con la búsqueda.
- Cuando hay algún filtro activo aparece un botón **«Limpiar filtros»**, y el estado vacío dice qué filtro está recortando en vez de un genérico "Sin productos".

### FR-008 — La búsqueda de texto NO se persiste

El campo de búsqueda arranca vacío siempre. Una búsqueda guardada de ayer que hoy deja la lista en cero se lee como "se me borró el catálogo": es el modo de fallo clásico de persistir texto libre. Los filtros son estado de configuración; la búsqueda es una acción.

### FR-009 — Nada de esto toca datos ni permisos

Es filtrado de **presentación**, en el cliente, sobre datos que el rol ya tiene derecho a ver. Sin migración, sin cambio de RLS, sin recorte de permisos: una encargada filtrada a «Salón A» sigue pudiendo elegir «Todos». Si en el futuro hace falta *asignar* una encargada a un salón (permiso, no preferencia), es otra spec.

## Decisiones

**D1 — Preferencia por máquina, no por usuario.** Se guarda en `localStorage`, no en la DB. El puesto físico es lo que define qué salón mira: la tablet de la terraza mira la terraza, la del comedor mira el comedor, la use quien la use. Es también la política que ya siguen la caja preferida y el plano del mozo, y no requiere migración.

**D2 — El selector vive en el shell, no dentro de cada tab.** Un solo control gobierna las tres tabs. La alternativa (un filtro por tab) multiplica el estado y hace que cambiar de tab pierda el contexto.

**D3 — Sin mesa = fuera del salón, pero avisado.** La opción "mostrar siempre las comandas sin mesa" fue descartada: quien filtra a un salón no quiere el delivery. Pero esconderlas en silencio es un riesgo operativo real (una comanda de delivery que nadie mira), y por eso FR-004 exige el contador de ocultas.

**D4 — La lista de salones se resuelve con un `await` en la page.** `/admin/operacion` evita `await` en la page a propósito (spec 39: cada tab strea su promesa). La barra de tabs no puede suspender, así que necesita los salones ya resueltos. Se agrega una query chica y indexada (`floor_plans` por `business_id`: un puñado de filas) antes del render; el resto del streaming no se toca.

**D5 — Estado = `is_available`, no `is_active` ni `show_online`.** "Disponible / No disponible" es lo que el local prende y apaga todo el día (se acabó el pescado). `is_active` (producto dado de baja) y `show_online` (visible en la carta pública) son decisiones de catálogo, no de operación; no entran a los chips para no convertir tres booleanos en un menú de nueve estados.

## Alcance

**Toca:**
- `src/lib/ui/use-sticky-filter.ts` **(nuevo)** — hook genérico de filtro persistido por máquina + su test.
- `src/lib/admin/local-query.ts` — `LocalComanda.floor_plan_id` (nuevo campo, viene de `orders.tables.floor_plan_id`).
- `src/app/[business_slug]/admin/(authed)/operacion/page.tsx` — resuelve la lista de salones y la pasa al shell.
- `src/app/[business_slug]/admin/(authed)/operacion/counts.ts` + test — los contadores aceptan el filtro.
- `src/components/admin/local/local-shell.tsx` — selector de salón + propagación.
- `src/components/admin/local/salon-desktop.tsx` — acepta salón fijado desde el shell.
- `src/components/admin/local/comandas-kanban.tsx` — filtro + aviso de comandas ocultas.
- `src/components/reservations/admin-day-list.tsx` — acepta filtro de salón.
- `src/components/admin/catalog/catalog-client.tsx` + `catalog-shell.tsx` — filtros persistidos.

**No toca:** migraciones, RLS, permisos, la app del mozo (ya elige su salón), Caja / Rendición / Fichaje / Pedidos online.
