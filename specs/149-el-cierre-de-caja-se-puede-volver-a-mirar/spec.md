# 149 · El cierre de caja se puede volver a mirar

**Issue:** [#225](https://github.com/gachetponzellini/RestaurantOS-app/issues/225) ·
**Milestone:** Post-demo · Growth & hardening ·
**Estado:** ✅ implementada (2026-09-03)

**Input:** Juan, 2026-09-03: *"si hacemos un cierre de caja, no podemos ver nunca
más después el resumen del cierre de esa caja, debería de haber una interfaz que
muestre esto"*.

**Depende de**: [`130`](../130-cerrar-caja/spec.md) (el cierre atómico y el
retiro como sangría), [`139`](../139-el-cierre-en-papel/spec.md) (las rendiciones
que bloquean), [`070`](../070-libro-de-movimientos/spec.md) (el libro, del que
esta pantalla es la contracara), y las decisiones de plata de
[`098`](../098-la-propina-no-es-venta/spec.md).

---

## Por qué

Cerrar la caja produce el documento más denso del día — cuánto tenía que haber,
cuánto había, de dónde salía cada peso, quién rindió y quién no — y ese documento
**se destruye en el momento en que se aprieta el botón**. El modal se cierra y no
queda nada.

Hoy, de un cierre pasado, la app muestra exactamente una cosa: el texto
`"· último corte registrado"` en el header de la tarjeta de caja
([`caja-admin-board.tsx:344`](../../src/components/admin/local/caja-admin-board.tsx)).
Ni el monto, ni la diferencia, ni quién lo hizo.

La consecuencia es que las tres preguntas que un encargado hace al día siguiente
no tienen respuesta en el producto:

- *¿Cuánto faltó anoche?*
- *¿De dónde salía el número que el sistema me pedía?*
- *¿Diego rindió o quedó debiendo?*

La única forma de contestarlas hoy es entrar a la base.

### La capa de datos ya está a medio construir

`getCortesByCaja` existe desde el día 1 en
[`queries.ts:439`](../../src/lib/caja/queries.ts) y **no la consume nadie**.
`getCortesHoy` (línea 453) tampoco tiene un solo caller de UI. Se escribieron
para una pantalla que nunca se hizo.

### Lo que sí existe no cubre esto

El [mail de cierre de turno](../034-mail-cierre-de-turno/spec.md) (spec 34) es
**por negocio y por día operativo**, no por corte, y se va por mail: no es una
pantalla a la que se vuelva, y no muestra el desglose del efectivo esperado ni el
conteo por billete. El [libro de movimientos](../070-libro-de-movimientos/spec.md)
(spec 70) tiene todas las líneas sueltas pero **ningún concepto de corte**: no se
puede pedir «el turno del martes».

## Las decisiones

**D1 · No se guarda nada nuevo. El resumen se reconstruye.** `caja_cortes` ya
persiste lo irrepetible —`expected_cash_cents`, `closing_cash_cents`,
`difference_cents`, `denomination_count`, `closing_notes`, `encargado_id`— y todo
lo demás (ventas por método, por origen, propinas, movimientos, rendiciones) es
derivable de la ventana del turno. **Sin migración.**

**D2 · La ventana del corte es `(corte anterior, este corte]`.** Es exactamente
el mismo criterio con el que `getCajaLiveStats` calcula el período vivo
(`created_at > ultimo_corte.created_at`, estricto), sólo que con techo. Para el
primer corte de una caja el piso es `cajas.created_at`, igual que hoy.

**D3 · Un solo cálculo, parametrizado — no una segunda implementación.** Esta es
la decisión que más importa, porque toca plata. `getCajaLiveStats` se refactoriza
a una función con ventana (`desde`, `hasta | null`) y el caso vivo pasa a ser
`hasta = null`. El resumen histórico llama a la misma función con techo.

Escribir un segundo cálculo del efectivo esperado sería garantizar que en algún
momento la pantalla del cierre y su propio resumen digan números distintos del
mismo turno, y que nadie sepa cuál creer. `calculateExpectedCash` y
`separarRetiroDelCierre` no se tocan.

**D4 · El retiro se busca por `corte_id`, no por la ventana.** El retiro del
cierre nace con `created_at = corte.created_at + 1 ms` (migración `0052`), o sea
que **cae fuera de su propia ventana** — por diseño, para que la apertura del
turno siguiente sea $0. Se lo trae por `caja_movimientos.corte_id` (migración
`0059`), que es justamente el rótulo que se agregó para esto.

Ojo con el corolario: un corte cuyo `UPDATE` de rótulo falló (el
[`cerrarCaja`](../../src/lib/caja/actions.ts) lo hace best-effort y sólo loguea)
no tiene retiro atado. La pantalla dice «no se pudo determinar», no inventa.

**D5 · Las rendiciones sólo se muestran en la caja que barre el salón.**
`mozo_rendiciones` es **por negocio**, no por caja: colgarlas del cierre del bar
mostraría las rendiciones de todo el local en un corte que no las gobierna. Misma
frontera que D9 de la spec 130.

**D6 · Se rinde el efectivo, y la pantalla lo dice.** Confirmado con Juan
(2026-09-03): **la propina es del mozo**. El cálculo actual ya es el correcto
—`efectivo_cents` suma sólo `method === "cash"` y neto de propina
([`liquidacion-mozo.ts`](../../src/lib/caja/liquidacion-mozo.ts))— y lo de
tarjeta/QR/transferencia nunca se le pide. La columna se llama **«Efectivo
esperado»** y la sección lo aclara en una línea, porque hoy se lee mal.

**D7 · El gate es `canHacerCorte`, no `canSee("operacion")`.** Encargado y admin,
el mismo círculo que puede cerrar la caja. **No se reusa el gate del libro**: en
la matriz de secciones `operacion` da `terminal: "limited"`
([`sections.ts:77`](../../src/lib/permissions/sections.ts)), y el `terminal` es la
compu compartida del salón — la spec 140 · D2 decidió expresamente que no ve la
plata de supervisión.

**D8 · Es solo-lectura.** Un corte no se edita ni se anula desde acá. Corregir una
línea ya registrada es del libro (spec 070), que tiene la maquinaria de auditoría
para eso. Esta pantalla enlaza al libro con el rango del turno ya puesto.

## Alcance

- **Sin migración.**
- **`src/lib/caja/queries.ts`**
  - refactor de `getCajaLiveStats` a ventana con techo opcional (D3);
  - `getCortesDelRango(businessId, {from, to, cajaId})` → cortes + `caja_name` +
    `encargado_name` + `periodo_desde` (el `created_at` del corte anterior, para
    poder decir cuánto duró el turno);
  - `getResumenDeCorte(corteId, businessId)` → el corte, su ventana, los stats de
    la ventana, los movimientos, el retiro por `corte_id` y las rendiciones
    (sólo si la caja es `is_default`).
  - `getCortesByCaja` / `getCortesHoy`: o se usan, o se borran. No quedan como
    están.
- **`src/app/[business_slug]/admin/(authed)/operacion/cierres/page.tsx`** — el
  historial. Filtros desde/hasta/caja por `searchParams`, mismo patrón que
  [`operacion/movimientos`](../../src/app/[business_slug]/admin/\(authed\)/operacion/movimientos/page.tsx).
- **`.../operacion/cierres/[corteId]/page.tsx`** — el resumen.
- **Componentes** en `src/components/admin/local/`. Reusa `CobrosPorMetodo` y
  `VentasPorOrigen` de [`caja-metricas.tsx`](../../src/components/admin/local/caja-metricas.tsx)
  tal cual: el resumen tiene que verse como el modal que lo generó.
- **Entrada** — link «Ver cierres anteriores» en el header de la tarjeta de caja,
  donde hoy está el texto muerto `"· último corte registrado"`.

## Qué NO entra

- **Editar o anular un corte** (D8).
- **Exportar a CSV/PDF.** El navegador imprime; si hace falta un export de
  verdad, es spec propia.
- **Mesas liberadas y mozos limpiados.** `cerrar_caja_tx` los devuelve pero **no
  los persiste**: no son reconstruibles y el resumen no los va a mostrar. Si se
  los quiere, es una migración y otra spec.
- **Cambiar quién debe rendir.** El mozo 100 % tarjeta sigue apareciendo con $0
  por la spec 139 · D4 (si no, su período queda abierto). Se conversó y se deja
  como está.
- **Un resumen consolidado del día** cruzando las dos cajas. Esta pantalla es por
  corte; lo del día es el mail de la spec 34.

## Riesgo conocido

**El resumen no es una foto congelada.** Como los números se reconstruyen (D1),
una corrección posterior de un cobro (spec 070) cambia el resumen de un cierre ya
hecho: mañana puede mostrar $500 menos que lo que se vio anoche, sin que el corte
se haya tocado.

Es lo correcto para auditar —el resumen refleja la verdad actual de los datos, y
las correcciones tienen su propio rastro— pero es contraintuitivo para quien
espera un comprobante inmutable. Los cuatro campos que **sí** están congelados
(esperado, contado, diferencia, conteo) son los del arqueo, que es lo que importa
que no se mueva. La pantalla lo dice donde se puede leer.

## Escenarios de aceptación

1. **Dado** un encargado en Operación → Caja, **cuando** entra a «Ver cierres
   anteriores», **entonces** ve los cortes del rango con esperado, contado,
   diferencia y quién cerró, el más reciente primero.
2. **Dado** un corte de la caja principal, **cuando** lo abre, **entonces** ve la
   cuenta del efectivo esperado desglosada (apertura + efectivo − sangrías +
   ingresos) y esos cuatro sumandos suman exactamente el `expected_cash_cents`
   guardado en la fila.
3. **Dado** ese mismo corte, **entonces** las ventas por método y por origen, las
   propinas y la cantidad de cobros corresponden **sólo** a la ventana
   `(corte anterior, este corte]` — un cobro del turno siguiente no aparece.
4. **Dado** un corte que retiró el efectivo, **entonces** el resumen muestra el
   monto retirado, tomado del movimiento con `corte_id` de ese corte, y **no** lo
   cuenta como sangría del turno.
5. **Dado** un corte cuyo retiro quedó sin rótulo (el `UPDATE` best-effort
   falló), **entonces** la pantalla lo dice explícitamente en vez de mostrar $0.
6. **Dado** un corte de una caja que **no** es `is_default`, **entonces** no se
   muestran rendiciones de mozos (D5).
7. **Dado** un corte con `denomination_count`, **entonces** se ve el conteo por
   billete y su total coincide con `closing_cash_cents`.
8. **Dado** un corte con diferencia ≠ 0, **entonces** la nota de cierre está a la
   vista (es obligatoria en ese caso).
9. **Dado** un usuario con rol `terminal` o `mozo`, **cuando** navega a
   `/admin/operacion/cierres` a mano, **entonces** no entra (D7).
10. **Dado** un corte de **otro** negocio, **cuando** se pide su `corteId` con la
    URL correcta, **entonces** 404 — el scope por `business_id` se chequea en la
    query, no sólo en la ruta.
11. **Dado** el primer corte de una caja recién creada, **entonces** la ventana
    arranca en `cajas.created_at` y el resumen no explota por no tener corte
    anterior.

## Verificación

`pnpm typecheck` en 0 errores y **2092 tests unitarios en verde** (los 21
archivos `*.integration.test.ts` fallan por falta del stack local, como es
habitual sin Supabase levantado — ninguna aserción rota).

Tests nuevos: `historial-cortes.test.ts` (encadenado por caja, que no se mezclen
dos cajas, bordes de la ventana) y `formato-cierre.test.ts` (duración del turno,
incluido el caso corrupto).

Verify en vivo como **Sofía (encargada)** sobre los dos cortes reales de `demo`,
que entre los dos cubren los bordes:

| | Caja Principal 13/8 | Caja Bar 31/8 |
|---|---|---|
| `is_default` | sí → rendiciones a la vista | no → sección ausente (D5) |
| `denomination_count` | no → «monto declarado» | sí → conteo, total = contado |
| retiro rotulado | **no** → «no se pudo determinar» (D4) | sí → $ 10.000 |
| nota | sí (hubo diferencia) | no |

El desglose reconstruido reprodujo exacto el `expected_cash_cents` congelado en
las dos filas (`0 + 45.800 + 10.000 − 0 = 55.800`), y el movimiento **anulado**
de $100.000 quedó tachado sin sumar a sangrías (spec 070).

Chequeo negativo: `terminal@demo.test` navegando a `/admin/operacion/cierres`
rebota a `/admin/operacion` y sigue viendo sólo sus cuatro tabs (D7).

### Lo que se descubrió verificando

**El primer corte de una caja no es un turno.** Las dos cajas de `demo` nunca se
habían cortado, así que la ventana arrancaba en el alta de la caja y la pantalla
decía «turno de 74 d 0 h» — correcto para sumar cobros, absurdo de leer. Se
agregó `es_primer_corte` al tipo y las dos pantallas lo dicen con todas las
letras en vez de inventar una duración.

## Pendiente menor

Un `corteId` inexistente (o de otro negocio) corta bien por `notFound()` pero
renderiza **una pantalla en blanco**: falta un `not-found.tsx` en el segmento que
diga «ese cierre no existe». No es un agujero —no se filtra nada— pero es una
punta suelta.

## Diseño

Las dos pantallas están dibujadas contra el sistema visual real del panel
(Geist, `ring-zinc-200/70`, radios de `--radius: 0.625rem`, `tabular-nums` en
toda la plata): [canvas de diseño](https://claude.ai/code/artifact/21dad263-6b4c-4b11-8f29-ac1c57cbc203).
