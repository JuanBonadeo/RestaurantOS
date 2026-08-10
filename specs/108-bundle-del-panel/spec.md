# Feature Specification: El bundle del panel

**Feature Branch**: `108-bundle-del-panel`

**Created**: 2026-08-08

**Status**: 🟡 Implementada — typecheck / suite unitaria (1545 tests) / build en verde, review adversarial con 2 hallazgos corregidos. **Pendiente verificar en vivo con rol real**. Issue [#166](https://github.com/gachetponzellini/RestaurantOS-app/issues/166).

**Input**: Iniciativa de perf percibida. Era la "fase 5 opcional" del plan original; se hace al final porque sólo pega en la primera carga, no en la operación.

## Contexto y problema

**Cero `next/dynamic` en todo el repo.** Dos consecuencias, medidas con `pnpm build`:

- **`/admin/operacion`: 440 kB de First Load JS** — la pantalla más pesada del producto y donde vive el encargado todo el turno. `local-shell` importaba las **7 tabs estáticamente** aunque desde la spec 101 se montan lazy: el JS de `SalonDesktop` (2731 líneas), `ComandasKanban` (1501) y las otras cinco bajaba siempre, para mostrar el plano.
- **`/admin`: 245 kB** — la landing post-login. Los 3 gráficos son lo único que usa recharts y entraban al bundle inicial.

## Requirements *(mandatory)*

- **FR-001**: Las 7 tabs con `next/dynamic`, **manteniendo el SSR**: cada una baja su chunk al abrirse y la tab de entrada sigue llegando pintada del server.
- **FR-002**: Los gráficos, en un wrapper **cliente** con `ssr: false` y un skeleton que reserva el alto. Desde la page no alcanza: es un Server Component, donde `ssr: false` no está permitido y el chunk termina igual en la carga inicial.
- **FR-003**: `optimizePackageImports` para recharts y date-fns.
- **NFR-001**: No se toca el keep-alive de la spec 101 ni el streaming con `use(promise)` de cada panel: los `<Suspense>` con skeleton que ya existen (spec 039) son el fallback natural del chunk.

## Resultado medido

| Ruta | Antes | Después |
|---|---|---|
| `/admin/operacion` | 440 kB | **119 kB** (−73%) |
| `/admin` | 245 kB | **128 kB** (−48%) |

## Verify

- `pnpm build` ✅ con los números de arriba · `pnpm typecheck` ✅ · suite ✅ **1544 tests**.
- ⏳ **En vivo con rol real**: abrir cada tab por primera vez y confirmar que no hay salto ni flash; que volver a una tab siga sin reconstruirla; y que el dashboard no salte al aparecer los gráficos.
