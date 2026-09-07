# 162 · La precarga que estaba muerta, y el ABM que no existía

**Issue:** [#243](https://github.com/gachetponzellini/RestaurantOS-app/issues/243) ·
**Milestone:** Post-demo · Growth & hardening ·
**Estado:** ✅ implementada (2026-09-07)

**Depende de**: [`158`](../158-comprar-y-pagarle-al-proveedor/spec.md) — es la
spec que construyó las dos cosas y dejó una sin datos y la otra sin pantalla.

---

## Por qué

**Dos mitades del mismo problema: el mecanismo de la 158 funciona, pero no tiene
datos y no se puede mantener.**

### 1 · `default_expense_concept_id` está en cero

Toda la apuesta de «el proveedor precarga el concepto» depende de ese campo
(`actions.ts:181`, `invoice-dialog.tsx:87`). Medido en la nube:

| | proveedores | con concepto |
|---|---|---|
| golf-jcr | 111 | **0** |
| kcc | 110 | **0** |

En MaxiRest, en cambio, **57 de 77** proveedores tienen `cod_cga`, y
**13.845 de 14.010 comprobantes (98,8%)** llevan exactamente ese default —
medido sólo desde 2024, **4.462 de 4.464 (100,0%)**. Son **9,3 compras por día**
que hoy se tipearían a mano.

### 2 · El ABM de conceptos es código muerto

`createExpenseConcept` y `updateExpenseConcept` están escritas, validadas y con
manejo del `23505` desde la 158. **Cero importadores.** Los tres negocios tienen
exactamente los 31 conceptos del seed, y no hay forma de tocar la lista.

Pero el catálogo real **no es fijo**: el Golf usó **38 conceptos distintos** y
suma **~2 por año** durante 8 años (DESCARTABLES en 2024, ADELANTO en 2025). Sin
pantalla, cada concepto nuevo es un ticket de dev más una migración, para
siempre, por local.

Figura en el Alcance de dominio y de permisos de la 158; la sección de UI nunca
lo pidió. Es ambigüedad de spec además de código muerto.

## Las decisiones

**D1 · Se agregan seis conceptos, y el criterio es contar filas.**

El seed tenía 31 y el Golf usó 38. Entran los que tienen volumen **y** están
vivos (histórico completo, 8 años):

| | comprobantes | último |
|---|---|---|
| Lavadero | 248 | 2026-05-14 |
| Diarios | 110 | 2026-05-18 |
| Kiosco | 88 | 2026-04-22 |
| Bazar | 80 | 2026-04-29 |
| Farmacia | 5 | 2026-04-10 |
| Fumigación | 16 | **2019-04-24** |

**Fumigación es la excepción, y vale explicarla**: su último comprobante es de
hace siete años. Entra igual porque hay un proveedor **activo** cuyo default es
ése, el servicio es obligatorio por bromatología, y «Mantenimiento de
instalaciones» no lo describe. Un concepto cuesta una fila; que el encargado lo
tipee todos los meses, no.

Y el mismo criterio al revés — lo que **no** entra, porque ya hay dónde ponerlo:

- Materiales Iluminación (2) → «Ferretería»
- Aceites (4) → «Almacén»
- Liquidación SAC / Vacaciones / Final y Pago Extras (2-3 c/u) → «Sueldos»:
  son variantes de la misma liquidación, no conceptos distintos
- Gastos Mant. Cta Bancaria (1) → «Gastos varios»

**D2 · El backfill cruza por nombre normalizado, no exacto.**

El índice de `suppliers` es `unique (business_id, name)` en btree crudo, así que
«Verdulería» y «VERDULERIA» no matchean solos. Se normaliza sin acentos, sin
puntuación y en minúsculas.

Y hay un segundo pase, con los **cuatro proveedores que cambiaron de nombre al
migrar**: dos que allá eran una sola ficha con barra («REDIGRAM/AGUA DE VIDA»)
se separaron en dos, y a dos les recortaron el nombre («TORTAS/POSTRES» →
«TORTAS»). Sin ese pase quedan afuera **50 comprobantes al año**, y son los
únicos recuperables: los otros cinco pares sin match son proveedores que
directamente no existen en la nube.

Sólo escribe donde el campo está `NULL`: es idempotente y no pisa nada elegido a
mano.

**D3 · `payment_terms_days` NO se backfillea, y eso es una conclusión.**

`mxpro.dias_venc` está en **0 en los 77** proveedores, y el Golf paga contado:
60% el mismo día, 93% dentro de la semana, lag promedio 2,2 días. Dejarlo en 0
es correcto, no un pendiente.

**D4 · El concepto se desactiva, no se borra.**

`createExpenseConcept`/`updateExpenseConcept` ya manejan `is_active`, y el ABM lo
expone como checkbox. **No hay delete, a propósito**: un concepto borrado deja
huérfanos los comprobantes que ya lo usaron, y el informe por concepto de la 158
empieza a decir «Sin concepto» sobre plata que sí estaba clasificada.

**D5 · Las etiquetas de rubro salen de un solo lugar.**

Vivían como una constante local adentro de `getGastoPorConcepto`. El ABM necesita
las mismas; dos copias del mismo diccionario se desincronizan solas. Pasan a
`RUBRO_LABELS` en `schema.ts`.

## Alcance

**Datos** — migración `0070`: los seis conceptos en `seed_expense_concepts` (así
los hereda todo negocio nuevo) + backfill a los existentes + la precarga de
golf-jcr desde los 57 pares medidos del backup.

**Server:** `RUBRO_LABELS` en `schema.ts`, y `getGastoPorConcepto` deja de tener
su copia. La página pasa a pedir **todos** los conceptos (no sólo activos): el
ABM necesita ver los apagados y el selector de compra filtra en el cliente.

**UI:** `conceptos-view.tsx` — la quinta solapa, agrupada por rubro, con alta y
edición.

## Qué NO entra

- **El backfill de kcc.** Su backup existe pero el contenedor está apagado, y el
  cruce hay que hacerlo contra *su* `mxpro`, no contra el del Golf. Es el mismo
  procedimiento y queda anotado; kcc todavía no carga compras.
- **Un segundo pase por similitud** (trigram, «contiene»). Los cinco pares que
  quedan sin match son proveedores que no existen en la nube: no hay nada que
  matchear, y adivinar acá clasifica plata mal.
- **Borrar conceptos** (D4).
- **`payment_terms_days`** (D3).
- **Reordenar o renombrar los 31 del seed.** Los que el Golf usa con otro nombre
  ya mapean; renombrar rompería los comprobantes de `demo`.

## Escenarios de aceptación

1. **Dado** un proveedor de golf-jcr que en MaxiRest tenía concepto, **entonces**
   al cargarle una compra el concepto viene puesto.
2. **Dado** el negocio golf-jcr, **entonces** más de la mitad de sus compras
   futuras llegan con el concepto precargado.
3. **Dado** un negocio nuevo, **entonces** nace con los 37 conceptos.
4. **Dado** el encargado, **cuando** entra a Proveedores, **entonces** hay una
   solapa Conceptos donde puede crear uno.
5. **Dado** un concepto con nombre repetido, **entonces** el alta lo rechaza con
   un mensaje claro.
6. **Dado** un concepto desactivado, **entonces** no aparece al cargar una compra
   pero **sí** en el ABM.
7. **Dado** que la migración corre dos veces, **entonces** no duplica conceptos
   ni pisa un default elegido a mano.

## Verificación

**Implementada y verificada el 2026-09-07.** `pnpm typecheck` limpio. Migración
`0070` aplicada al cloud.

**Escenarios 1 y 2 — la precarga.** El backfill dejó **52 de 111** proveedores de
golf-jcr con concepto (de 0). El número que importa no es ése sino la cobertura
por **volumen de compra**, medida contra el backup:

    comprobantes de los últimos 12 meses          2.280
    de proveedores con default en MaxiRest        1.969  (86,4%)
    menos los pares sin proveedor en la nube       −110
    más los cuatro renombrados recuperados          +50
    ─────────────────────────────────────────────────────
    cobertura efectiva del backfill               ~83,7%

**Cuatro de cada cinco compras van a llegar con el concepto ya puesto.** Los
5 pares que quedan afuera (POSITANO, PEPINO, LENGUITAS, SAGITARIO GOLOSINAS,
ACEITE DE OLIVA, ENEAS) son proveedores que no existen en la nube.

**Escenario 3 — los conceptos.** Los tres negocios pasaron de 31 a **37**, y
`seed_expense_concepts` los lleva a cualquier negocio nuevo.

**Escenarios 4 y 5 — el ABM, en vivo con Sofía (encargada) en `demo`.** La quinta
solapa lista los 37 agrupados por rubro —Mercaderías muestra los 13 incluido
**Kiosco**, uno de los nuevos— con lápiz por fila. Se creó un concepto «Hielo» de
prueba: toast **«Concepto creado.»** y aparece ordenado dentro de Mercaderías.
Las dos actions que estaban muertas desde la 158 tienen importador.

*(El «Hielo» de prueba se borró después, con la guarda de no borrar uno que ya
tenga comprobantes.)*

**Escenario 1, en `demo`:** «Verdulería del Sur» → concepto precargado
«Verdulería».

**Escenario 7 — idempotencia.** El `on conflict (business_id, name) do nothing`
del seed y el `where default_expense_concept_id is null` del backfill: correrla
de nuevo no duplica ni pisa.
