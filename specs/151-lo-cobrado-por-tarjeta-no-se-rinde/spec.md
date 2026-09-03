# 151 · Lo cobrado por tarjeta no se rinde

**Issue:** [#227](https://github.com/gachetponzellini/RestaurantOS-app/issues/227) ·
**Milestone:** Post-demo · Growth & hardening ·
**Estado:** ✅ implementada (2026-09-03)

**Input:** Juan, 2026-09-03: *"tendríamos que hacer que en la rendición sólo entre
lo cobrado en efectivo"* → *"está perfecto que se registre en la caja, pero no en
la rendición, lo cobrado por tarjeta no se rinde"*.

**Amplía**: [`139`](../139-el-cierre-en-papel/spec.md) (la rendición obligatoria y
quién bloquea el cierre) y [`007`](../../openspec/changes/07-caja-rendicion-mozos/)
(la rendición original). Se cruza con [`149`](../149-el-cierre-de-caja-se-puede-volver-a-mirar/spec.md),
que ya aplicó la misma aclaración en el resumen del cierre.

---

## Por qué

**El cálculo ya era correcto.** El server pide sólo el efectivo:

    const expected_cash_cents = pendiente.efectivo_cents;   // actions.ts:611

y `efectivo_cents` suma únicamente `method === "cash"`, neto de propina
([`liquidacion-mozo.ts`](../../src/lib/caja/liquidacion-mozo.ts)). Lo cobrado con
tarjeta, QR o transferencia nunca entró en lo que el mozo tiene que entregar, ni
en la diferencia, ni en la deuda declarada.

**El problema es que la pantalla lo muestra igual.** Tres superficies de la
rendición exhiben montos que no se rinden:

| Dónde | Qué muestra |
|---|---|
| [`rendicion-mozos-tab.tsx:339`](../../src/components/admin/local/rendicion-mozos-tab.tsx) | línea «Tickets (tarj./transf.)» con monto |
| `rendicion-mozos-tab.tsx:357` | bloque «Detalle por método» — QR, tarjeta, transferencia, todo |
| `rendicion-mozos-tab.tsx:463` | en el modal, «+ $X en tickets (tarjeta/transferencia)» |

Poner plata al lado de un número que hay que entregar la vuelve parte de lo que
hay que entregar, aunque el título diga otra cosa. La prueba es que el pedido
llegó dos veces: la primera respuesta —«ya es así»— era cierta a nivel código y
falsa a nivel pantalla.

## Las decisiones

**D1 · Se van los montos, no el dato.** `calcularRendicionMozo` sigue calculando
`tickets_cents` y `por_metodo`, y `mozo_rendiciones` los sigue guardando. Lo que
desaparece son los **montos no-efectivo dibujados dentro de la rendición**.
Borrar el registro histórico sería irreversible y nadie lo pidió: Juan dijo
explícitamente *"está perfecto que se registre en la caja"*.

**D2 · El cartel «sólo tickets» se queda.** En el modal de cierre
([`cerrar-caja-modal.tsx:613`](../../src/components/admin/local/cerrar-caja-modal.tsx))
el mozo que cobró todo con tarjeta aparece con $0 y una aclaración «sólo
tickets». **No es un monto**: es la razón por la que esa fila existe. Sacarlo
dejaría un $0 inexplicable en la lista que bloquea el cierre, que es peor que el
problema que esta spec resuelve. La condición ya es booleana (`ticketsCents > 0`),
no muestra plata.

**D3 · La propina se queda.** Es del mozo (confirmado con Juan, 2026-09-03) y va
señalada como «Propinas (aparte)». No es algo que entregue, pero sí algo que se
lleva, y es la contracara de por qué el efectivo esperado es neto de propina.

**D4 · La caja no se toca.** El desglose por método sigue entero en el tab Caja,
el libro (spec 070) y el resumen del cierre (spec 149). El dato no se pierde,
cambia de lugar: está donde se audita la plata del negocio, no donde se le pide
plata a una persona.

## Alcance

Un solo archivo: [`src/components/admin/local/rendicion-mozos-tab.tsx`](../../src/components/admin/local/rendicion-mozos-tab.tsx).

- Sacar la línea «Tickets (tarj./transf.)» de la tarjeta del mozo pendiente.
- Sacar el bloque «Detalle por método» entero (con `METHOD_LABEL`, `MethodIcon` y
  los íconos que quedan sin uso).
- Sacar «+ $X en tickets» del modal de rendición.

El historial de rendiciones ya registradas (la tabla de abajo) **ya muestra sólo
efectivo** — esperado, entregado, diferencia. No se toca.

## Qué NO entra

- **Borrar `tickets_cents` / `por_metodo`** del cálculo o de la fila (D1).
- **El cartel «sólo tickets»** del cierre (D2).
- **Cambiar quién debe rendir.** El mozo 100 % tarjeta sigue entrando con $0
  (spec 139 · D4): si no, su período queda abierto y arrastra cobros viejos a la
  rendición de mañana. Se conversó y se deja como está.
- **La caja, el libro y el resumen del cierre** (D4).

## Escenarios de aceptación

1. **Dado** un mozo que cobró $50.000 en efectivo y $80.000 con tarjeta,
   **cuando** el encargado abre la rendición, **entonces** ve **$50.000** y
   ningún monto de los $80.000.
2. **Dado** ese mismo mozo, **cuando** se abre el modal para registrar,
   **entonces** «Efectivo que debería entregar» dice $50.000 y no hay línea de
   tickets.
3. **Dado** un mozo que cobró **todo** con tarjeta, **cuando** el encargado mira
   el modal de cierre, **entonces** sigue apareciendo con $0 y la aclaración
   «sólo tickets» (D2).
4. **Dado** cualquier rendición registrada, **entonces** los montos guardados
   (`expected_cash_cents`, `delivered_cash_cents`, `difference_cents`) son los
   mismos que antes de esta spec: no cambia ni un centavo.
5. **Dado** el tab Caja, el libro o el resumen de un cierre, **entonces** el
   desglose por método sigue completo (D4).

## Verificación

`pnpm typecheck` en 0 errores y **2092 tests unitarios en verde** (los 21
`*.integration.test.ts` fallan por falta del stack local, sin aserciones rotas).
No hay lógica nueva: el cálculo no se tocó.

**Verificado en vivo** como Sofía (encargada) en `/demo/admin/operacion?tab=rendicion`.
La tarjeta de Lucía Moza quedó en:

    Lucía Moza · 1 cobro en el turno · Pendiente · Efectivo a entregar $ 18.500

Antes traía además un bloque «Detalle por método» que repetía el mismo efectivo.
`tickets_cents` sigue viajando en los props (D1) pero **no lo dibuja nada**: los
únicos matches de «ticket» en la página están en el payload serializado del
server, no en el markup.

### Con datos mixtos de verdad

`demo` no tenía **ningún** cobro no-efectivo atribuido a un mozo, así que el caso
que motivó la spec no se podía ver. Se cobró una mesa de verdad: **BAR1, $35.000
con tarjeta (+10 % → $38.500), atribuida a Lucía Moza**, que ya tenía $18.500 en
efectivo pendientes. Con eso la tarjeta del mozo quedó en:

    Lucía Moza · 2 cobros en el turno · Pendiente · Efectivo a entregar $ 18.500

Dos cobros reconocidos, **un solo monto a la vista**, y los $38.500 en ningún
lado. Ni «Tickets (tarj./transf.)» ni «Detalle por método».

### Test de regresión

El modal no se pudo abrir en el navegador (el pane oculto no calcula layout y el
diálogo Radix no monta), así que el escenario 2 se fijó donde vale más: en
[`rendicion-mozos-tab.test.tsx`](../../src/components/admin/local/rendicion-mozos-tab.test.tsx),
con el mismo caso mixto de Lucía.

Los 5 tests pasan con este código y **4 de 5 fallan contra el commit anterior**
—incluido el del modal—, así que no son vacíos: si alguien vuelve a poner un
monto de tarjeta en la rendición, se entera.
