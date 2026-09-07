# 164 · Los precios de los insumos son los de verdad

**Issue:** [#244](https://github.com/gachetponzellini/RestaurantOS-app/issues/244) ·
**Milestone:** Post-demo · Growth & hardening ·
**Estado:** ✅ implementada (2026-09-07)

**Depende de**: `10` (el costeo, que es la pantalla que miente).

---

## Por qué

**Es trabajo de datos, no de código, y pega en la pantalla que el dueño va a
mirar el día 1.**

El catálogo de insumos de golf-jcr salió de `scripts/extract-maxirest.mjs` —una
curación a mano del catálogo real— pero **el seed guardó el precio POR UNIDAD
como precio del PACK**.

La prueba no es una impresión: para varios insumos el factor de error es
**exactamente el `net_quantity`** de su presentación.

| insumo | net_quantity | factor de error |
|---|---|---|
| Tomate | 20 kg | **20,0x** |
| Harina 0000 | 25 kg | 25,9x |
| Manzana roja | 10 kg | **10,0x** |
| Ajo | 10 un | **10,0x** |
| Papa | 50 kg | 40,0x |

Donde no da exacto, la diferencia es la inflación entre el seed (2026-05-29) y
el precio del backup.

**El costo, medido sobre las 436 líneas de receta que golf-jcr ya tiene
cargadas**: el food cost pasa de **13,7% a 29,3%**. El dueño mira una pantalla
que le dice que gana **más del doble** de lo que gana.

Y los precios están congelados desde la carga: `ingredient_price_log` tenía
**0 filas** en los tres negocios —el trigger existe y funciona, así que cero
filas prueba que nadie tocó un costo— con las 122 presentaciones creadas en 41
segundos hace 100 días.

## Las decisiones

**D1 · La fuente es el precio real, no una regla de tres.**

Lo tentador era multiplicar cada `cost_cents` por su `net_quantity`, ya que el
factor de error **es** ese número en varios casos. No se hizo, y la razón está
en los datos: de los 97 insumos que cruzan, **18 estaban más CAROS que
MaxiRest** —a ésos el precio les baja—. Aplicar el factor a ciegas habría
asumido que el error es idéntico en los 122, y no lo es.

Cada precio sale de `mxins.precio` del backup × el `net_quantity` de nuestra
presentación:

    97 de 122 cruzan por nombre normalizado
    73 suben · 18 bajan · 6 quedan igual

**D2 · Los 25 que no cruzan NO se tocan.**

Son de dos clases: los que en MaxiRest se llaman distinto («Muzarella» vs QUESO
MUZZARELLA, «Champiñones» vs CHAMPIGNON) y los que no existen allá. Adivinar el
match por similitud sería **escribir un precio inventado sobre plata que el
dueño va a leer como si fuera medida**. Se resuelven con el matching que la #245
necesita igual.

**D3 · El catálogo faltante no se importa acá.**

golf-jcr tiene 122 insumos y MaxiRest 330. La issue plantea importar el resto, y
`importIngredients` existe desde la spec 10 —cerrado, testeado, upsert
idempotente— pero **nunca corrió contra los negocios reales**, y el índice es
`unique (business_id, name)` en btree crudo: importar a lo bruto crea **~35
duplicados dejando sus recetas colgadas del insumo con el precio falso**.

Se difiere por tres razones, en orden de peso:

1. El daño urgente es el precio, y se arregla **sin importar nada**.
2. Importar 208 insumos que ninguna receta usa no mejora ninguna pantalla hoy:
   el catálogo se consume vía recetas, y las 436 líneas existentes usan los 122.
3. La normalización que hace falta para no duplicar es **la misma** que la #245
   necesita para mapear línea de comprobante → insumo. Hacerla dos veces es
   hacerla mal una.

**D4 · Se aplica también a `demo`.**

Los dos negocios tienen el mismo catálogo salido del mismo seed, con el mismo
error. `demo` es donde se verifica todo: dejarlo con el food cost mentiroso
significa verificar contra una mentira. kcc no tiene insumos.

## Alcance

**Datos** — migración `0072`: los 97 `cost_cents` corregidos en golf-jcr y demo,
sólo sobre la presentación `is_default`, y sólo donde el valor cambia.

**No hay cambios de código.** Si el diff toca un `.ts`, esta spec se pasó de
alcance.

## Qué NO entra

- **Importar el catálogo faltante** (D3).
- **Los 25 sin match** (D2).
- **Actualizar precios desde el comprobante de compra**: es
  [#245](https://github.com/gachetponzellini/RestaurantOS-app/issues/245), y es
  lo que hace que esto no haya que volver a hacerlo a mano.
- **Arreglar las recetas que quedaron al descubierto** — ver abajo.

## Escenarios de aceptación

1. **Dado** el catálogo de golf-jcr, **entonces** el precio de la papa es ~$800/kg
   y no $20/kg.
2. **Dado** el costeo, **entonces** el food cost del negocio es ~29% y no ~14%.
3. **Dado** que un precio baja (los 18 que estaban caros), **entonces** también
   se corrige: no se aplica un factor a ciegas.
4. **Dado** `ingredient_price_log`, **entonces** deja de estar vacío: el cambio
   queda con fecha.
5. **Dada** la migración corriendo dos veces, **entonces** la segunda no escribe
   nada.

## Verificación

**Implementada y verificada el 2026-09-07.** Migración `0072` aplicada al cloud.
Cero cambios de código.

**Escenarios 1-3.** Después de la migración, medido con la misma fórmula antes y
después:

| | golf-jcr | demo |
|---|---|---|
| food cost antes | 13,7% | 13,7% |
| **food cost después** | **29,3%** | **29,3%** |
| platos que pasan a pérdida | 4 | 4 |

**Escenario 4.** `ingredient_price_log` pasó de **0 a 91 filas** por negocio. El
trigger ya existía; lo que faltaba era que alguien tocara un precio. Desde acá
hay histórico.

**En la pantalla real** (`/demo/admin/catalogo?tab=costos`, con el admin):

    MARGEN PROMEDIO  68,2%     CON RECETA 108     SIN RECETA 410

    Vithel Tonné       $16.000   food cost $68.501   margen −328,1%
    Arrollado Casero   $15.500   food cost $65.285   margen −321,2%
    Bolognesa           $4.500   food cost  $9.135   margen −103,0%
    Pesto               $4.500   food cost  $5.456   margen  −21,3%

*(La pantalla da un food cost algo mayor que mi consulta porque aplica la merma
de cada insumo, que yo no calculé. El sistema es más completo que la
verificación.)*

## Lo que esto destapó, y que NO se arregla acá

Los dos primeros platos de esa lista están al **400% y 385% de food cost**, y eso
no es un precio mal: es una **receta cargada por tanda y vendida por porción**.

    Vithel Tonné      2,80 kg de peceto por porción   → $56.000 de una línea
    Arrollado Casero  2,65 kg de matambre por porción → $52.735

Un vitel toné lleva ~150 g de peceto. Esas cantidades son las de la preparación
entera, que rinde 15-20 porciones.

**No se toca en esta spec, a propósito**: cuántas porciones rinde cada
preparación es un dato del negocio, no algo que se pueda deducir del backup. Va
como issue aparte.

Y vale registrar la mecánica, porque es el argumento entero de esta spec:
mientras los precios estaban 3-40x abajo, esas dos recetas mostraban un margen
sano. **La corrección no creó el problema — lo hizo visible**, que es exactamente
para lo que sirve la pantalla.
