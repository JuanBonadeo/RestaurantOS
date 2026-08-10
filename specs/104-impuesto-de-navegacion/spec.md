# Feature Specification: El panel admin deja de pagar 4 round-trips de auth por navegación

**Feature Branch**: `104-impuesto-de-navegacion`

**Created**: 2026-08-08

**Status**: 🟡 Implementada — typecheck / suite unitaria (1537 tests) / build en verde, review adversarial con 2 hallazgos corregidos. **Pendiente verificar en vivo con rol real**. Issue [#162](https://github.com/gachetponzellini/RestaurantOS-app/issues/162).

**Input**: Iniciativa de perf percibida — [wiki/analyses/perf-percibida-operacion-mozo.md](../../../../wiki/analyses/perf-percibida-operacion-mozo.md). **Fase 4 de 4.** Las specs [101](../101-tabs-sin-red/spec.md), [102](../102-salon-sin-refresh/spec.md) y [103](../103-plata-sin-refresh/spec.md) atacaron `/admin/operacion`; ésta es transversal a todo el panel.

## Contexto y problema

Las tres specs anteriores sacaron los round-trips **por acción**. Queda el que se paga **por navegación**, antes de que corra una sola query útil.

**Cuatro llamadas a Supabase Auth, en serie:**

| # | Dónde | Qué |
|---|---|---|
| 1 | `middleware.ts` | `getUser()` — y el matcher incluye las peticiones RSC, así que también en cada navegación soft |
| 2 | `layout.tsx` → `ensureAdminAccess` | `getUser()` + 2 queries de membresía |
| 3 | `layout.tsx` → `getMyAdminBusinesses()` | su propio `getUser()`, sólo para volver a preguntar quién es |
| 4 | la page → `ensureAdminAccess` **otra vez** | no estaba cacheada: mismo hop y mismas 2 queries, repetidos |

`getUser()` **no** verifica local: es una llamada HTTP a GoTrue. Cuatro idas y vueltas encadenadas antes de la primera query de datos.

**Y el layout bloqueaba a la página:** awaiteaba ~6 queries de contadores del sidebar en **dos** `Promise.all` encadenados antes de dejar renderizar `children`.

**Y el prefetch no servía:** 44 páginas admin son `force-dynamic` **sin `loading.tsx`**. En App Router, el prefetch de un `<Link>` a una ruta dinámica sólo trae el `loading.tsx`: sin boundary no hay nada que traer, y el click se queda en la pantalla vieja congelada hasta que el servidor termina.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Navegar el panel cuesta un hop de auth, no cuatro (Priority: P1)

**Independent Test**: cualquier navegación admin hace **una** llamada a Supabase Auth.

**Acceptance Scenarios**:

1. **Dado** que navego a cualquier pantalla admin, **Cuando** se resuelve, **Entonces** el middleware verifica la sesión **sin red** (firma del JWT validada local) y `ensureAdminAccess` corre **una sola vez** aunque la llamen el layout y la page.
2. **Dado** un usuario con un solo local, **Cuando** carga el layout, **Entonces** `getMyAdminBusinesses` no vuelve a preguntar quién es.

### User Story 2 - El click pinta algo (Priority: P1)

**Why this priority**: es la diferencia entre "no hizo nada" y "está cargando" — la misma que arregló la spec 101 en las tabs.

**Acceptance Scenarios**:

1. **Dado** que toco un ítem del sidebar, **Cuando** la ruta es dinámica, **Entonces** aparece un skeleton al instante en vez de quedar la pantalla anterior congelada.
2. **Dado** que el skeleton se muestra, **Cuando** llega el contenido, **Entonces** no salta: el skeleton calca el ancho y la estructura de la página (header, KPIs si los tiene, filas).

### Edge Cases

- **Token simétrico** (si algún día se revirtieran las signing keys): `getClaims` cae solo a `getUser`. El cambio no puede quedar por debajo del comportamiento anterior.
- **Sesión vencida**: `getClaims` llama a `getSession()` por dentro, así que el refresh del token y la escritura de cookies siguen ocurriendo igual que con `getUser`.
- **Cuenta deshabilitada o sacada del negocio**: nunca la atajó el middleware — la atajan `ensureAdminAccess` / `ensureMozoAccess` (que miran `disabled_at` y la membresía contra la DB en cada request) y RLS. Ese gate no se toca.
- **`/operacion`**: tiene su `loading.tsx` propio desde la spec 039, que le gana al de la raíz.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: El middleware verifica la sesión con `getClaims()`. Verificado que el proyecto usa **JWT signing keys asimétricas** (su JWKS publica una ES256), así que la firma se valida local con WebCrypto: **cero red**.
- **FR-002**: `ensureAdminAccess` y `ensureMozoAccess` van envueltas en `cache()` de React — dedupe por request, sin tocar un solo caller.
- **FR-003**: `getMyAdminBusinesses(userId?)` acepta el user ya resuelto. Sin argumento se comporta como siempre.
- **FR-004**: El layout resuelve sus contadores y las notificaciones en **una** tanda, no dos encadenadas.
- **FR-005**: Las rutas admin tienen `loading.tsx` con un skeleton que calca su estructura.

### Non-Functional / Guardas

- **NFR-001**: El gate de seguridad **no se mueve**: sigue siendo `ensureAdminAccess` (membresía + `disabled_at` + platform admin) más RLS. El middleware sólo bloquea sesión anónima, igual que antes.

## Implementación

| Archivo | Qué |
|---|---|
| `src/middleware.ts` | los dos `getUser()` → `getClaims()` |
| `src/lib/admin/context.ts` · `src/lib/mozo/auth.ts` | `cache()` de React sobre los dos helpers |
| `src/lib/platform/queries.ts` | `getMyAdminBusinesses(userId?)` |
| `admin/(authed)/layout.tsx` | una sola tanda de queries |
| `src/components/skeletons/page-skeleton.tsx` (nuevo) | skeleton genérico de página admin |
| 18 `loading.tsx` nuevos | dashboard + pedidos, reservas, cajas, clientes, catálogo, reportes, stock, rrhh, facturación, proveedores, campañas, promociones, salones, usuarios, empleados, menú del día, chatbot, configuración |

## Verify

- `pnpm typecheck` ✅ · `pnpm build` ✅
- Suite unitaria ✅ **1537 tests, 0 rojos**.
- ⏳ **En vivo con rol real**: navegar el panel y ver el skeleton inmediato en cada click del sidebar; confirmar que un usuario deshabilitado sigue rebotando al login (el gate fino, que no se tocó).

## Review adversarial

21 agentes en 3 lentes (seguridad de la sesión / `cache()` / UX del skeleton), cada hallazgo verificado por un refutador que reprodujo lo suyo con apps Next descartables. **Dos confirmados**, los dos sobre los `loading.tsx` — el cambio de auth salió limpio:

1. **El `loading.tsx` de un segmento con layout propio hace que el prefetch ejecute ese layout.** Sin ningún boundary en el subárbol, Next corta el prefetch y responde sólo router state; con uno, renderiza hasta el boundary — y el boundary de un segmento queda **por debajo** del layout de ese mismo segmento. `conversaciones/layout.tsx` corre `listConversations()`, que baja hasta 2000 filas de `chatbot_messages` con el contenido entero: la bandeja se consultaba con sólo pasar el mouse por el ítem del sidebar, sin que nadie la abriera. Se sacó ese `loading.tsx`. Volverá cuando `listConversations` salga del layout, que es su propia tarea. Verificado además que el `loading.tsx` de la raíz `(authed)` es inocuo (el cortocircuito se evalúa en el segmento desemparejado) y que los otros 17 segmentos no tienen layout propio, así que su prefetch no ejecuta nada.
2. **`<main>` anidado en `configuracion`**, cuyo layout ya monta `PageShell` (que es un `<main>`) + `PageHeader`: el skeleton metía un segundo `<main>`, padding duplicado y un título fantasma debajo del real. Se agregó `SectionSkeleton` —sólo el cuerpo— para los segmentos que ya traen su chrome.

Rechazados: que `getClaims` deje pasar sesiones revocadas (ninguna superficie depende del middleware como gate; el fino sigue siendo `ensureAdminAccess` contra la DB en cada request), que valide mal `exp` o el issuer, que `cache()` pueda servir un contexto de otro usuario, y varios preexistentes.

## Qué NO entra

**Sacar el último hop de auth.** `ensureAdminAccess` sigue usando `getUser()` porque devuelve el `User` de Supabase entero y hay **75 usos de `ctx.user`** en el repo —varios en caminos que escriben plata (`created_by`, `requested_by`)—. Migrar el contexto a claims es su propia spec, con su propio review. Con esta fase el panel pasa de 4 hops a 1.

También queda afuera streamear los contadores del sidebar: son ~6 queries colocadas con la DB y ahora en una sola tanda, del orden de decenas de ms. Refactorizar el sidebar para eso no se paga; el tiempo estaba en los hops de auth.
