# Feature Specification: El último hop de auth — la identidad deja de ir por red

**Feature Branch**: `106-ultimo-hop-de-auth`

**Created**: 2026-08-08

**Status**: 🟡 Implementada — typecheck / suite unitaria (1544 tests) / build en verde. **Pendiente verificar en vivo con rol real**. Issue [#164](https://github.com/gachetponzellini/RestaurantOS-app/issues/164).

**Input**: Continúa la [spec 104](../104-impuesto-de-navegacion/spec.md), que bajó el impuesto de navegación de 4 round-trips de auth a 1. Éste es ese 1.

## Contexto y problema

La 104 pasó el **middleware** a `getClaims()` —verificación local de la firma del JWT, cero red— y dedupeó los helpers con `cache()`. Quedó pendiente el hop que hacen los propios helpers: `ensureAdminAccess`, `ensureMozoAccess` y `requireMozoActionContext` seguían llamando a `getUser()`, que es una llamada HTTP a GoTrue.

Dónde duele: **cada navegación** del panel y del mozo, y **cada server action del salón** — abrir mesa, enviar comanda, transferir, cobrar. En medio de cada gesto del turno, una ida y vuelta a Virginia sólo para volver a preguntar quién es el usuario, cuando el propio token ya lo dice y se puede verificar en proceso.

En la 104 esto quedó afuera porque el contexto devolvía el objeto `User` entero de Supabase y el grep sugería ~75 usos. Contados de verdad: **14** (`ctx.user.id` ×13, `ctx.user?.id` ×1). Los demás `ctx.userId` ya venían del contexto de actions, que nunca tuvo el `User`.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Navegar y operar no le pregunta a GoTrue quién sos (Priority: P1)

**Independent Test**: una navegación admin, una del mozo y una acción del salón no producen ninguna llamada a `/auth/v1/user`.

**Acceptance Scenarios**:

1. **Dado** que navego el panel, **Cuando** se resuelve, **Entonces** la identidad sale del JWT verificado local y no hay request a Auth.
2. **Dado** que el mozo abre una mesa o envía una comanda, **Cuando** corre la action, **Entonces** tampoco.

### User Story 2 - El gate sigue siendo el gate (Priority: P1)

**Why this priority**: es lo único que esta spec no puede romper.

**Acceptance Scenarios**:

1. **Dado** un usuario deshabilitado (`business_users.disabled_at`), **Cuando** entra, **Entonces** rebota al login igual que antes — el gate consulta la DB en cada request.
2. **Dado** un usuario sacado del negocio, **Cuando** entra con su sesión todavía viva, **Entonces** rebota igual.
3. **Dado** un mozo, **Cuando** intenta el panel admin, **Entonces** sigue redirigido a `/mozo`.

### Edge Cases

- **Token simétrico**: si algún día se revirtieran las signing keys, `getClaims` cae solo a `getUser`. No puede quedar por debajo del comportamiento anterior.
- **Sesión vencida**: `getClaims` llama a `getSession()` por dentro, así que el refresh sigue ocurriendo igual.
- **Superficie pública** (perfil, checkout, reservar) y login: siguen con `getUser()`. Es otro journey, con otra frecuencia; no entra acá.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: `AdminContext` y `MozoContext` exponen **`userId`**, no el `User` de Supabase. `userName` y `userEmail` salen de los claims (`user_metadata.full_name` / `name`, `email`).
- **FR-002**: `ensureAdminAccess`, `ensureMozoAccess` y `requireMozoActionContext` resuelven la identidad con `getClaims()`.
- **FR-003**: El **gate no se toca**: membresía en `business_users`, `disabled_at` y el flag de platform admin se siguen consultando **contra la DB en cada request**. Es lo que puede cambiar mientras la sesión sigue viva, así que no se confía al token ni se cachea entre requests.

### Non-Functional / Guardas

- **NFR-001**: Ningún objeto `User` fabricado ni `as` nuevo para engañar al tipo. Sacar `user` del contexto hace que el `typecheck` encuentre solo cada uso que se escape — ésa es la red de seguridad de la migración.

## Implementación

| Archivo | Qué |
|---|---|
| `src/lib/admin/context.ts` | `userId` en vez de `user`; identidad por `getClaims()` |
| `src/lib/mozo/auth.ts` | ídem para `ensureMozoAccess` **y** `requireMozoActionContext`, que corre en cada action del salón |
| 5 archivos + `mozo/page.tsx` | los 14 `ctx.user.id` → `ctx.userId` |

## Verify

- `pnpm typecheck` ✅ · `pnpm build` ✅
- Suite unitaria ✅ **1544 tests, 0 rojos**.
- Grep de control: **cero** `auth.getUser()` en el camino caliente (middleware, admin, mozo, actions del salón). Los 46 que quedan son de la superficie pública del cliente y del login.
- ⏳ **En vivo con rol real**: deshabilitar un usuario desde el admin y confirmar que su siguiente navegación rebota al login.
