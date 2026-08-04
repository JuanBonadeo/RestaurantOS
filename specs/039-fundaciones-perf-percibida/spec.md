# Feature Specification: Fundaciones de performance percibida (Operación + Mozo)

**Feature Branch**: `039-fundaciones-perf-percibida`

**Created**: 2026-07-14

**Status**: Implemented (2026-07-14) — plan + tasks en esta carpeta. Falta solo el verify en vivo con rol real (T014). Issue [#56](https://github.com/gachetponzellini/RestaurantOS-app/issues/56).

**Input**: Análisis [wiki/analyses/perf-percibida-operacion-mozo.md](../../../../wiki/analyses/perf-percibida-operacion-mozo.md) — fase 1 (fundaciones transversales, sin optimismo de plata).

## Contexto y problema

La app corre en **Vercel + Supabase cloud**, así que cada acción tiene latencia de red real. Hoy esa latencia se **muestra** en vez de esconderse:

- No existe **ningún** `loading.tsx` en `src/app`. Todas las rutas operativas son `force-dynamic`, así que cada navegación **congela la pantalla anterior** (sin skeleton) hasta que el server responde.
- `src/app/[business_slug]/admin/(authed)/operacion/page.tsx` hace **un `Promise.all` de 15 queries** y recién ahí pinta. La tab por defecto (**Salón**) solo necesita 4 de esas queries, pero queda bloqueada por la más lenta de las 15 (incluidas queries de tabs que ni se ven al entrar, como rendición o fichaje).

Esta spec cubre **solo las fundaciones de bajo riesgo** que hacen que la operación se sienta instantánea **sin tocar la lógica de dinero** (optimismo/merge sobre caja, cobro y rendición van en specs posteriores).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Navegación del mozo con feedback instantáneo (Priority: P1)

En hora pico, el mozo salta entre pantallas (lista de mesas → tomar pedido → cuenta → cobro) decenas de veces. Hoy cada salto **congela la pantalla vieja** sin ninguna señal: el mozo toca y "no pasa nada" hasta que responde el server, lo que lleva a doble-tap y desconfianza en el sistema.

**Why this priority**: Es el flujo más repetido del sistema y la primera impresión de "va rápido / va lento". Un skeleton inmediato cambia la percepción aunque el round-trip real no cambie. Es el cambio de menor riesgo (puramente presentacional) y mayor impacto.

**Independent Test**: Navegar de la lista de mesas a "tomar pedido" en una tablet: se ve la estructura de la pantalla destino (header, botón volver, etiqueta de la mesa, placeholders de la lista/catálogo) de inmediato, antes de que lleguen los datos.

**Acceptance Scenarios**:

1. **Dado** que estoy en la lista de mesas del mozo, **Cuando** toco una mesa para tomar el pedido, **Entonces** veo de inmediato un esqueleto con el layout de la pantalla de pedido (sin quedarme mirando la lista congelada), y los datos reales lo reemplazan al llegar.
2. **Dado** que estoy en la cuenta de una mesa, **Cuando** paso a cobro, **Entonces** veo de inmediato el esqueleto de la pantalla de cobro (header + KPI "falta cobrar" + lista de splits en gris) en lugar de la cuenta congelada.
3. **Dado** que la sesión expiró o no tengo permiso para esa mesa, **Cuando** navego, **Entonces** el sistema me redirige (login / mi vista) **sin** mostrar primero el contenido de la pantalla protegida.

---

### User Story 2 - Operación abre mostrando el Salón de inmediato (Priority: P1)

El encargado entra a `/admin/operacion` muchas veces por turno. Hoy espera a que resuelvan las **15 queries** (incluidas las de tabs que no está mirando) antes de ver nada. La tab Salón —la que usa el 90% del tiempo— debería aparecer apenas están sus propios datos.

**Why this priority**: La pantalla central del operativo del encargado. Desbloquear el Salón del resto de las tabs es el mayor recorte de espera en esa vista, y habilita que las demás tabs carguen en segundo plano.

**Independent Test**: Entrar a `/admin/operacion` con datos de operación cargados: el chrome (barra de tabs) y el plano de Salón aparecen apenas resuelven las queries del Salón, mientras Caja/Rendición/Fichaje/Comandas siguen cargando sin bloquear.

**Acceptance Scenarios**:

1. **Dado** que entro a `/admin/operacion`, **Cuando** la página carga, **Entonces** veo el esqueleto del chrome (tabs) al instante y el plano del Salón apenas resuelven sus 4 queries, sin esperar por las queries de otras tabs.
2. **Dado** que el Salón ya está visible, **Cuando** cambio a la tab Caja, **Entonces** si sus datos aún no llegaron veo un esqueleto de Caja (no un contenido en blanco ni un "0" provisional).
3. **Dado** que estoy entrando a Operación sin rol de encargado/admin, **Cuando** carga la página, **Entonces** soy redirigido a `/mozo` **antes** de que se muestre cualquier dato de operación.

---

### User Story 3 - Badges de las tabs que no engañan (Priority: P2)

Las "pills" con contadores (pedidos nuevos, comandas activas, mesas ocupadas, rendiciones pendientes, presentes) hoy se calculan a partir de todos los datos ya resueltos. Al hacer streaming, esos contadores no pueden mostrar un valor provisional falso (ej. "0 rendiciones pendientes" cuando en realidad todavía no cargó) porque el encargado toma decisiones de plata mirándolos.

**Why this priority**: Correctitud de información money-adjacent. Un badge falso ("0 rendiciones") puede llevar a cerrar el turno creyendo que no hay nada pendiente. Menor prioridad que P1 porque depende de US2, pero es un requisito de seguridad que no se puede omitir.

**Independent Test**: Entrar a Operación con streaming activo y observar que, mientras una tab de plata no cargó, su badge muestra un estado de "cargando" (—/skeleton) y nunca un "0" transitorio.

**Acceptance Scenarios**:

1. **Dado** que la tab Rendición todavía no cargó sus datos, **Cuando** miro su badge, **Entonces** veo un indicador de carga (—/skeleton), nunca un "0".
2. **Dado** que la query de una tab de plata (Caja/Rendición) **falla**, **Cuando** abro esa tab, **Entonces** veo un mensaje de **error explícito** ("no se pudieron cargar los datos, reintentá"), nunca un estado vacío que parezca "no hay nada".

---

### User Story 4 - Fundación "la action devuelve la fila" (Priority: P3)

Para que specs posteriores puedan reemplazar `router.refresh()` por actualización local sin re-ejecutar toda la página, las mutaciones deben devolver la fila que persistieron. Esta spec **establece la convención** y la aplica a 1–2 actions piloto de bajo riesgo, sin cambiar todavía el comportamiento del cliente.

**Why this priority**: Es andamiaje para las fases 2 y 3; no entrega valor percibido directo, por eso es P3. Se incluye acá para dejar el patrón documentado y probado en un caso seguro.

**Independent Test**: Llamar la action piloto y verificar que su `ActionResult` incluye la fila mutada (no `null`/`undefined`), cubierto por un test unitario.

**Acceptance Scenarios**:

1. **Dado** el patrón de módulo de dominio, **Cuando** se escribe/actualiza una action piloto, **Entonces** su resultado exitoso incluye la fila mutada tipada, y un test lo verifica.

---

### Edge Cases

- **Redirect durante streaming**: si el gate de auth o el gate de caja quedaran por debajo del boundary de streaming, un `redirect()` fallaría (headers ya enviados) y el usuario vería contenido protegido. La auth y el gate de cobro **deben** resolverse antes de abrir cualquier boundary.
- **Promesa que rechaza y nadie consume**: una promesa pasada a un componente que nunca se monta (tab no visitada) puede volverse un unhandled rejection. Toda promesa pasada debe ser consumida dentro de un boundary con manejo de error.
- **Contador con predicado divergente**: si los badges se derivaran de una fuente distinta a las queries de detalle, podrían desincronizarse (el badge dice 1, la tab muestra 0). Los contadores se derivan del mismo dato o usan un predicado idéntico (mismo `pagos_count > 0`, misma ventana "hoy" por TZ del negocio).
- **Skeleton que no calca el layout**: un esqueleto que no coincide con el destino genera "salto" (layout shift) al hidratar. Los skeletons deben reproducir la estructura real.
- **Multi-tenant en streaming**: cada query sigue corriendo con `service_role` (sin RLS de red); si al reestructurar se pierde un filtro `business_id`, se filtran datos de otro negocio.

## Requirements *(mandatory)*

### Functional Requirements

**Skeletons de navegación (US1, US2)**

- **FR-001 (ADDED)**: El sistema MUST mostrar un estado de carga (skeleton) al instante al navegar a las rutas operativas de mesa del mozo (`mozo/mesa/[id]/{pedir,cuenta,cobrar}`), a la home del mozo (`mozo/`) y a sus equivalentes admin (`admin/(authed)/mesa/[id]/{pedir,cuenta,cobrar}`), y a `admin/(authed)/operacion`, en lugar de dejar visible la pantalla anterior congelada.
- **FR-002 (ADDED)**: Cada skeleton MUST reproducir la estructura del destino (header, botón volver, etiqueta de mesa y placeholders del contenido principal) de modo que no haya salto de layout (layout shift) al reemplazarse por el contenido real.
- **FR-003 (ADDED)**: El sistema MUST proveer un componente de skeleton base reutilizable para no duplicar la maqueta en cada ruta.

**Streaming de Operación (US2, US3)**

- **FR-004 (MODIFIED)**: La vista `/admin/operacion` MUST pintar la tab por defecto (Salón) apenas estén disponibles **sus** datos (plano, órdenes dine-in, reservas, mozos), sin esperar a los datos de las demás tabs. *(Antes: un `Promise.all` de 15 queries bloqueaba el primer render completo.)*
- **FR-005 (MODIFIED)**: Las tabs no-default (Caja, Rendición, Fichaje, Comandas, Pedidos) MUST cargar sus datos de forma independiente y mostrar su propio skeleton mientras tanto, sin bloquear el Salón.
- **FR-006 (MODIFIED)**: Los contadores de las "pills" de las tabs MUST mostrar un estado de carga (—/skeleton) mientras el dato de esa tab no esté disponible, y NUNCA un valor provisional (p. ej. "0"). *(Antes: se calculaban de datos ya todos resueltos.)*
- **FR-007 (ADDED)**: Si el dato de una tab de plata (Caja o Rendición) no se puede cargar, el sistema MUST mostrar un estado de **error explícito y accionable** (reintentar), y NUNCA un estado vacío que se lea como "no hay datos".

**Invariantes de correctitud (no negociables)**

- **FR-008**: La verificación de acceso (rol/sesión) de `/mozo/*`, `/admin/mesa/*` y `/admin/operacion` MUST resolverse **antes** de iniciar cualquier carga diferida (streaming), de modo que una redirección por falta de permiso ocurra sin exponer contenido protegido.
- **FR-009**: El gate de cobro (validación de "hay caja abierta / orden abierta") de la ruta de cobro MUST resolverse antes del boundary de streaming; nunca se difiere.
- **FR-010**: Cada consulta de datos de `/admin/operacion` MUST conservar su filtro por `business_id` (aislamiento multi-tenant); ninguna reestructuración puede quitar ese filtro (las consultas usan `service_role`, sin RLS de red).
- **FR-011**: Ninguna consulta diferida puede quedar "flotando" sin ser consumida dentro de un boundary con manejo de error (evitar rechazos no manejados).
- **FR-012**: Si los contadores de las pills se derivan de una fuente distinta a las queries de detalle, MUST usar predicados idénticos (mismo criterio, misma ventana "hoy" en la timezone del negocio).
  - **2026-08-04 ([#125](https://github.com/gachetponzellini/RestaurantOS-app/issues/125)):** la tab **Comandas** se quedó sin pill. El badge no coincidía con la tab, y ante eso este mismo FR dice que ninguno es mejor que uno mal. `TabButton` acepta `count` opcional; las otras seis tabs no cambian.

**Fundación action-returns-row (US4)**

- **FR-013 (ADDED)**: Se MUST documentar (en el repo) la convención de que las Server Actions de mutación devuelven la fila mutada tipada en su `ActionResult` de éxito, como base para futuras actualizaciones locales sin `router.refresh()`.
- **FR-014 (ADDED)**: Se MUST aplicar esa convención a 1–2 actions piloto de bajo riesgo, con test que verifique la forma del resultado, **sin** cambiar todavía el comportamiento del cliente (no se introduce merge local en esta spec).

### Non-Goals (fuera de alcance — van en specs posteriores)

- Optimismo / merge local sobre superficies de **plata**: caja (sangría/ingreso/corte), cobro (`registrarPago`), merge de rendición en el cliente.
- Prefetch de rutas (`<Link prefetch>` / `router.prefetch`).
- Realtime merge-local para comandas/tables (reemplazar `router.refresh()` como sink de realtime).
- Cambios a `enviarComanda` (devolver comandas, no-navegar, overlay).
- Cualquier cambio a lógica de dinero, fiscal (ARCA) o ruteo a cocina.

### Key Entities

No introduce entidades de datos nuevas ni migraciones. Trabaja sobre datos existentes (órdenes, comandas, mesas, cajas, rendiciones, presentes) que ya se cargan en `/admin/operacion` y en las rutas del mozo.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: En cada transición del flujo del mozo (mesas → pedir → cuenta → cobro) el usuario ve la estructura de la pantalla destino de forma **inmediata** (percibida como instantánea, sin "pantalla congelada"), aunque el round-trip a Supabase siga tardando lo mismo.
- **SC-002**: Al entrar a `/admin/operacion`, el Salón aparece sin esperar por los datos de las otras tabs; el tiempo hasta ver el Salón deja de estar atado a la query más lenta de las 15.
- **SC-003**: Ningún badge de tab muestra un valor numérico provisional falso; las tabs de plata que fallan muestran error explícito, nunca vacío.
- **SC-004**: No hay salto de layout (layout shift) perceptible al reemplazar el skeleton por el contenido real en ninguna de las rutas cubiertas.
- **SC-005**: `pnpm typecheck` y `pnpm test` en verde; verificación en vivo con el **rol real** (mozo y encargado) de que la navegación muestra skeletons y de que un usuario sin permiso es redirigido sin ver contenido protegido.
- **SC-006**: Cero regresiones de aislamiento multi-tenant: cada dato mostrado sigue scopeado al negocio correcto (verificado con el rol real, no `service_role`).

## Assumptions

- Se asume Next.js 15 (App Router) + React 19 ya presentes; `loading.tsx`, `<Suspense>` y `use()` son la mecánica de streaming disponible (detalle de implementación, se define en `/speckit-plan`).
- Se asume que la tab por defecto de Operación es **Salón** (comportamiento actual) y que sus datos son un subconjunto acotado (plano, órdenes dine-in, reservas, mozos).
- Se asume que las actions piloto para FR-014 se eligen entre las de menor riesgo (p. ej. rendición, que ya devuelve `{ rendicion }`); la elección final se fija en el plan.
- Se asume que **no** hay cambios de datos (sin migraciones, sin nuevas policies RLS).
- Dependencia: el análisis de referencia ([wiki/analyses/perf-percibida-operacion-mozo.md](../../../../wiki/analyses/perf-percibida-operacion-mozo.md)) define el mapa completo y las fases 2/3 que continúan esta.
