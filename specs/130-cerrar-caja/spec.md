# 130 · Cerrar caja

**Issue:** [#201](https://github.com/gachetponzellini/RestaurantOS-app/issues/201) ·
**Milestone:** Post-demo · Growth & hardening ·
**Estado:** implementada y verificada en vivo (2026-08-31)

**Input:** Juan, 2026-08-27: *"el encargado no debería tener que crear una
sangría manualmente con la plata total, sino que tendría que haber un btn que
sea como cerrar turno o cerrar caja, porque en realidad no existen los turnos, y
ahí va a mostrar bien la plata ingresada por los distintos métodos, separando el
delivery del resto, y que ahí ponga cerrar caja y retirar dinero, que sea un
modal grande que muestre bien los números"* + *"al cerrar caja libere todas las
mesas, o que tengan que estar liberadas para cerrar, y que después haga una
limpieza de los mozos"*.

## Por qué

Cerrar el día hoy son **tres pantallas y un número tipeado a mano**:

1. Rendir a los mozos, en la tab Rendición.
2. Sangría manual en la tab Caja, escribiendo el total del cajón a mano.
3. «Hacer corte», contando lo que quedó (que después de la sangría es $0).

El paso 2 es el peor: es el encargado tipeando **la plata entera del día** en un
campo libre, a la 1 de la mañana, para que el sistema no crea que la caja sigue
llena. Un dedo mal puesto ahí y el arqueo del día siguiente arranca torcido.

Y el modal del corte —la única pantalla donde se decide si falta plata— muestra
sólo el efectivo esperado y su desglose. Todo lo demás está afuera, en el board:
cobrado por método, salón/delivery/take away, propinas, quién no rindió. Se
decide mirando una pantalla y se entiende mirando otra.

Ni «corte» es la palabra: el encargado cierra la caja y se lleva la plata.

## Las decisiones

**D1 · Un botón, «Cerrar caja». «Hacer corte» desaparece.** El retiro es una
casilla adentro del modal: destildarla es el arqueo de mitad de turno (contar
sin vaciar). Un solo concepto, una sola puerta a la plata. La tabla sigue
llamándose `caja_cortes` y el permiso sigue siendo `canHacerCorte` — cambia lo
que el encargado ve, no el modelo ni el gate.

**D2 · Se retira todo o no se retira nada.** La casilla dice «Retirar todo el
efectivo — $X», con X = lo contado, y viene tildada. No hay retiro parcial ni
fondo de cambio configurable: si mañana ponen $50.000 de cambio, eso entra como
Ingreso cuando lo ponen. Es una decisión menos en el peor momento del día.

**D3 · El retiro es una sangría de verdad, insertada después del corte.** No una
columna `retiro_cents` en `caja_cortes`. Así el retiro queda como una línea del
libro (spec 070): visible, auditable, corregible y anulable con las herramientas
que ya existen, y `calculateExpectedCash` no se toca — el período nuevo arranca
con apertura = lo contado y una sangría por el mismo monto, o sea $0.

⚠️ **El timestamp importa.** El período se calcula con `created_at > ultimo_corte.created_at`
([`queries.ts:165`](../../src/lib/caja/queries.ts)), y dentro de una transacción
`now()` es constante: una sangría con el mismo timestamp que el corte no cae en
el período nuevo **ni** en el viejo, y el retiro se evapora. Se inserta con
`corte.created_at + interval '1 millisecond'`.

**D4 · Corte + retiro + salón, en una transacción (`cerrar_caja_tx`).** Un corte
sin su retiro deja al sistema esperando plata que ya no está en el cajón. Mismo
patrón que `corregir_pago_tx` / `anular_pago_tx` (spec 070). La liberación de
mesas y de la distribución entra en la misma RPC.

**D5 · La plata cuenta como en caja, pero con nombre.** El efectivo esperado se
parte en un renglón por dueño:

```
Efectivo esperado          $312.400
  En el cajón              $198.000
  Nacho · sin rendir        $71.200
  Caro · sin rendir         $43.200
```

Rendir **no mueve el total**: pasa plata de una columna a la otra. Por eso
`registrarRendicionMozo` no genera movimiento de caja y no debe generarlo — el
efectivo ya se contó cuando el mozo cobró; sumarlo de nuevo al rendir lo contaría
dos veces.

**D6 · Se rinde desde el mismo modal.** Cada mozo pendiente tiene su monto
precargado y su botón. El cierre es un solo flujo: rendís → contás → retirás.
Un mozo sin rendir **no bloquea** (se puede haber ido), pero queda a la vista
antes de contar, así la diferencia del arqueo ya está explicada cuando aparece.

**D7 · Las mesas con cuenta abierta bloquean el cierre.** Se listan con label,
mozo y monto, y con link para ir a cobrarlas. Cerrar la caja con una mesa abierta
es cerrar el día con plata sin cobrar. Los pedidos de **delivery / take away**
abiertos avisan pero no bloquean: el repartidor puede estar en la calle, y ese
cobro cayendo en el período nuevo es lo correcto.

**D8 · El cierre deja el salón en cero.** Sin cuentas abiertas, lo que queda son
mesas zombi: `ocupada` / `pidio_cuenta` sin orden viva. El cierre las pasa a
`libre` y limpia la distribución de mozos —eso último ya lo hace hoy
([`actions.ts:299`](../../src/lib/caja/actions.ts))— pero se **anuncia en el
modal antes de apretar**, no como un toast después de que pasó.

**D9 · Sólo la caja principal barre el salón y muestra mozos.** Como hoy: el
cierre del bar puede pasar en plena cena y no tiene por qué liberar mesas ni
pedir rendiciones.

**D10 · El conteo por billete deja de ser una columna muerta.**
`caja_cortes.denomination_count` existe desde el día 1 y la UI nunca la escribió
(pasa `null`, [`caja-admin-board.tsx:526`](../../src/components/admin/local/caja-admin-board.tsx)).
El modal grande tiene lugar para el conteo por denominación, opcional, que suma
solo el total contado.

**D11 · Los números salen de lo que ya se calcula.** `getCajaLiveStats` ya
devuelve `ventas_por_metodo`, `ventas_por_origen` (salón / delivery / take away)
y `desglose_esperado`. No se inventa cálculo nuevo: se mueve a la pantalla donde
se decide. ⚠️ Sigue vigente que **la venta de mostrador se persiste como
`dine_in`** y por eso cuenta como salón — no se arregla en esta spec.

## El modal

Grande (`sm:max-w-3xl`), scrolleable, dos bloques y un pie:

1. **La plata del período** — cobrado total + cantidad de cobros + propina
   declarada aparte · por método · por origen con delivery separado.
2. **Quién la tiene** — el desglose de D5, con los botones de rendir (D6), y la
   lista de mesas abiertas si las hay (D7).
3. **Contar y cerrar** — efectivo contado (+ conteo por billete opcional),
   diferencia en vivo, motivo obligatorio si hay diferencia (como hoy), casilla
   «Retirar todo el efectivo — $X», y el resumen de lo que va a pasar: *«Se
   liberan 12 mesas y se limpia la distribución de 4 mozos»*.

CTA: **«Cerrar caja y retirar $X»** (o «Cerrar caja sin retirar» si se destildó).

## Alcance

**Incluye:**
- `cerrar_caja_tx` (migración `0052`): corte + sangría de retiro + mesas a `libre`
  + distribución limpia, en una transacción.
- `cerrarCaja(...)` en `src/lib/caja/actions.ts`, reemplaza a `hacerCorte`.
- Query de bloqueo: mesas con orden `lifecycle_status = 'open'` de la caja/negocio,
  y pedidos delivery/take away abiertos (aviso).
- `getCajaLiveStats`: efectivo esperado partido por dueño (cajón + mozos sin rendir).
- `CerrarCajaModal` nuevo, reemplaza a `CorteModal`; conteo por denominación.
- Rendición inline reusando `registrarRendicionMozo`.
- Tests: unitarios del desglose por dueño y del arranque en $0 tras el retiro;
  integración del cierre completo (bloqueo por mesa abierta, retiro, mesas libres).

**No incluye:** fondo de cambio configurable (D2), cierre consolidado de varias
cajas de una (queda de a una), la venta de mostrador contando como salón (D11),
tocar el resumen por email del cierre (spec 34, sigue por cron).

## Tasks

1. [x] Migración `0052` — `cerrar_caja_tx`, con el `+ 1 ms` del retiro (D3). Aplicada al cloud y verificada ahí dentro de una transacción que revierte: desfase de 1 ms exacto, 2 mesas liberadas, 2 asignaciones limpias, `OPEN_TABLE_ORDERS:1` cuando hay cuenta abierta.
2. [x] `cerrarCaja` en actions + baja de `hacerCorte`; los tests de integración pasaron a 22 casos.
3. [x] `getCuentasAbiertas` (bloqueo, con mesa/mozo/monto) + `getPedidosAbiertosSinMesa` (aviso).
4. [x] Reparto por dueño en `repartir-efectivo.ts`, servido por `getCierreCajaData` — **no** por `getCajaLiveStats`: el reparto consulta la rendición pendiente de cada mozo y el poll de stats corre cada 30 s por caja desde cada tablet.
5. [x] `CerrarCajaModal`: los tres bloques, conteo por billete, casilla de retiro.
6. [x] Rendición inline dentro del modal.
7. [x] Board: un solo botón «Cerrar caja»; anuncio de lo que se libera.
8. [x] `pnpm typecheck` limpio · los 34 tests nuevos/tocados de la spec en verde (22 integración + 6 del reparto + 6 del modal) y 1863 de la suite. ⚠️ Quedan **112 rojos preexistentes** en 13 archivos de integración ajenos a caja: su mock de auth define `getUser` y el código usa `getClaims()` desde la spec 106. Tarea aparte.
9. [x] Verify en vivo en el negocio `demo`, con el rol **encargado** real (Sofía, nunca service_role), entrando por magic link (`scripts/magic-link.mjs`): el modal con la plata del período, el reparto ($54.200 en el cajón + $113.800 de Sofía sin rendir = $168.000), las **4 mesas abiertas bloqueando** el CTA con el monto cuadrado, los 3 pedidos de delivery avisando sin frenar, el anuncio «se liberan 4 mesas y se limpia la distribución de 6 mozos», y un cierre completo en la Caja Bar: conteo por billete → `denomination_count = {"10000": 1}`, sangría «Retiro del cierre de caja» a **+1 ms exacto** del corte, y el período nuevo en **$0** con la sangría visible en el libro. Falta sólo el barrido de mesas en vivo (pedía cerrar las cuentas abiertas del demo); está cubierto por integración y por la verificación de la RPC.
10. [x] Actualizar `wiki/features/caja.md` + `wiki/log.md`.

## Criterios de verificación

- Cerrar con una mesa abierta **no se puede**, y el modal dice cuál y cuánto.
- Cerrar con retiro deja el período nuevo en **$0 esperado**, con la sangría
  visible en el libro y anulable.
- Cerrar sin retiro (casilla destildada) deja el esperado en lo contado — el
  arqueo de mitad de turno sigue existiendo.
- Un mozo sin rendir aparece con su monto **antes** de contar; rendirlo desde el
  modal no cambia el efectivo esperado, sólo lo mueve al cajón.
- Después de cerrar la caja principal: todas las mesas en `libre`, ninguna con
  `mozo_id`, y el audit (`tables_audit_log`) con el motivo del cierre.
- Cerrar la caja del bar **no** toca el salón ni pide rendiciones.
- Diferencia ≠ 0 sigue exigiendo motivo y respetando el techo del encargado
  ($5.000, `canAcceptCajaDifference`).
