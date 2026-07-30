# Feature Specification: Anular una mesa sin nada cargado no pide motivo

**Feature Branch**: `071-anular-mesa-sin-consumo`

**Created**: 2026-07-30

**Status**: ✅ Implementado (2026-07-30) — `pnpm typecheck` y `pnpm lint` limpios en los archivos de esta spec; tests de `consumo.ts` en verde. Sin migración. **Pendiente:** verify en vivo con rol real. Issue [#107](https://github.com/gachetponzellini/RestaurantOS-app/issues/107). Milestone: Post-demo · Growth & hardening.

**Input**: Pedido de Juan 2026-07-30 — *"si se quiere anular una mesa a la que no se le cargo nada, deberia dejar de cerrar sin dar ningun motivo, ese deberia de cerrar directo"*.

## Contexto y problema

[`anularMesa`](../../src/lib/mozo/actions.ts) rechaza el motivo vacío **siempre**, y las dos pantallas que anulan abren un prompt con un textarea obligatorio antes de dejar seguir.

Eso está bien para lo que la regla quería cubrir: anular una mesa **con consumo** es tirar comida ya pedida y cancelar comandas que la cocina puede tener en curso — el motivo es el registro de por qué, y va al audit log.

Pero el caso más frecuente en hora pico es otro: se abrió una mesa por error, o el grupo se fue antes de pedir. No hay nada cargado, no hay comanda, no hay plata. Ahí el motivo no registra nada: es un peaje. Y el resultado previsible es peor que no pedirlo — se tipea `a`, `-`, `asd` para salir del paso, y esa basura queda mezclada en el audit log con los motivos de las anulaciones que **sí** importaban.

## Requisitos

### FR-001 — El motivo es obligatorio sólo si la mesa tiene consumo

«Tiene consumo» = al menos un `order_item` **vivo** (`cancelled_at is null`) en alguna orden `open` de esa mesa.

- **Con consumo** → igual que hoy: motivo obligatorio, prompt, y va al audit log.
- **Sin consumo** → se anula directo, sin preguntar nada.

Una mesa cuyos ítems fueron **todos cancelados** cuenta como sin consumo: quedó igual que si nunca se hubiera tocado.

### FR-002 — La auditoría nunca queda con el campo vacío

Anular sin consumo registra el motivo de sistema **`Mesa sin consumo`** (`MOTIVO_MESA_SIN_CONSUMO`). Se distingue de un motivo escrito por una persona y no obliga a que el resto del código maneje un `reason` vacío — el audit log, las órdenes canceladas y las comandas siguen recibiendo siempre un string.

### FR-003 — Decide el server, no el cliente

`anularMesa` **re-deriva el consumo contra la DB** antes de decidir si el motivo es obligatorio. Las pantallas usan el mismo helper puro sobre los datos que ya tienen, pero **sólo para la UX** (¿abro el prompt o no?).

Es la parte que no se puede saltear: un cliente con datos de hace 30 segundos podría creer que la mesa está vacía cuando el mozo acaba de mandar una comanda. Si eso pasa, el server rechaza el motivo vacío y la pantalla muestra el error — no se anula una mesa con comida en la cocina sin dejar registro.

### FR-004 — Nada más cambia

No cambian los permisos (sigue siendo encargado/admin vía `canTransitionMesa`), ni la cancelación de órdenes y comandas, ni la reimpresión del ticket «ANULADA», ni el audit log. Sin migración: es lógica sobre datos que ya existen.

## Decisiones

**D1 — El umbral es "ítem vivo", no "orden abierta".** Toda mesa ocupada tiene una orden abierta (la crea `openTable` al sentar), así que "tiene orden" daría verdadero siempre y la feature no existiría. Lo que distingue el caso de Juan es que no se **cargó** nada.

**D2 — Ítems todos cancelados = sin consumo.** Cancelar los ítems ya fue una acción auditada, con su propio motivo. Volver a pedir motivo para cerrar la mesa vacía que quedó es cobrar dos veces por lo mismo.

**D3 — Un motivo de sistema en vez de permitir `reason` vacío en la DB.** Dejar el campo vacío obligaría a que todo lo que lee el audit log distinga "sin motivo porque no hacía falta" de "sin motivo por un bug". Un valor explícito se lee solo.

**D4 — El helper es puro y compartido, pero la autoridad es el server.** `tieneConsumo` vive en [`src/lib/mozo/consumo.ts`](../../src/lib/mozo/consumo.ts) y lo usan las dos pantallas y la action. Es el mismo criterio en los tres lugares —así el prompt no puede discrepar de lo que el server va a exigir— pero la validación real corre server-side (FR-003).

## Alcance

**Toca:**
- `src/lib/mozo/consumo.ts` **(nuevo)** + `consumo.test.ts` — el helper puro y el motivo de sistema.
- `src/lib/mozo/actions.ts` — `anularMesa` consulta el consumo y hace condicional la exigencia del motivo.
- `src/components/admin/local/salon-desktop.tsx` — el botón «Anular» cierra directo si la mesa está vacía.
- `src/app/[business_slug]/mozo/mozo-client.tsx` — ídem en la app del mozo.

**No toca:** migraciones, permisos, cancelación de comandas, reimpresión, audit log.
