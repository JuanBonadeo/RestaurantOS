# Feature Specification: El stock puede ir en negativo

**Feature Branch**: `099-stock-en-negativo`

**Created**: 2026-08-06

**Status**: ✅ Implementada

**Issue**: #150

## El problema

Un producto con `track_stock` que llegaba a **0** se apagaba solo: el trigger de descuento hacía `update products set is_available = false`. Como la carta (`menu.ts`) y el catálogo del mozo (`mozo/catalog-query.ts`) filtran `is_available = true`, el producto **desaparece de las dos pantallas**. El mozo no puede cargar la cerveza que tiene en la mano.

El conteo de un restaurante nunca está al día: el ingreso que no se cargó, la botella que volvió, el conteo de hace dos semanas. Apagar el producto convierte un dato impreciso en un bloqueo operativo — y encima **pierde información**: si el stock no puede bajar de cero, el faltante no queda escrito en ningún lado. Con negativo permitido, `-3` dice "se vendieron 3 más de las que el sistema creía que había" y el próximo ingreso cierra solo: `-3 + 24 = 21`.

La regla además nunca fue pareja: un producto **con receta** jamás se apagó por quedarse sin insumo. Sólo se apagaban bebidas y kiosko.

## La decisión

**`products.is_available` es una decisión manual del negocio y nada más.** Ningún trigger ni server action la escribe.

De ahí sale el corolario espejado: si nadie apaga por stock, **nadie prende por stock**. El reencendido automático que existía (`0039` al cancelar una línea, `ingresarStock()`) era el mismo error al revés — pisaba el "no disponible" que había puesto el encargado en cuanto entraba mercadería.

## Los cinco write-sites

| Dónde | Qué hacía | Ahora |
|---|---|---|
| `fn_stock_descuento_on_order_item` (`0001`) | apagaba al tocar 0 en la venta | descuenta y listo (puede quedar negativo) |
| `fn_stock_delta_on_item_edit` (`0042`) | ídem al corregir una línea | ídem |
| `ajustarStock()` (`stock/actions.ts`) | apagaba con `≤0`, prendía con `>0` | sólo mueve inventario |
| `fn_stock_reversion_item` (`0039`) | **prendía** al devolver stock | sólo devuelve inventario |
| `ingresarStock()` (`stock/actions.ts`) | **prendía** al cargar mercadería | sólo suma |

Además `setStockLevels()` rechazaba cantidades negativas: un faltante no se podía ni corregir a mano. Ahora sólo valida `min_qty >= 0` — el mínimo es un umbral que define el negocio y un umbral negativo no significa nada, pero el stock actual sí puede estar en rojo.

`stock_items.current_qty` es `integer` **sin CHECK**, así que el negativo ya era representable: no hubo que tocar el esquema. Lo que faltaba era permitirlo.

## Lo que ya estaba bien y se aprovecha

- `getLowStockCount` cuenta `current_qty <= min_qty` → todo negativo entra en el alerta.
- `qtyColor` de la grilla pinta rojo `current <= 0` → el faltante se ve.
- `adjust_stock_item` (RPC de `0004`) suma el delta sin clamp → `-3 + 24 = 21` sale solo.

## Backfill

`0043` reenciende sólo lo **atribuible al trigger**: trackeado, apagado, en cero o menos **y** con al menos un movimiento `kind='venta'` en su historial. Un producto que el negocio apagó a mano y nunca vendió no tiene ventas y no se toca.

En el cloud el conjunto dio **0 filas**: los dos productos apagados de golf-jcr (`Aquarius Limonada 500ml`, `Aquarius Naranja 500ml`) tienen cero movimientos — vienen apagados del import de MaxiRest, no del trigger. Se dejan como están; si el negocio los quiere en la carta, es un click.

## Cambio de wording

El badge de `is_available = false` decía **"Sin stock"** en la carta pública (`menu/product-card.tsx`, `menu/carta-client.tsx`) y en el catálogo del admin (`catalog/product-row.tsx`). Con la regla nueva ese estado ya no tiene nada que ver con el stock: ahora dice **"No disponible"**.

## Verify

- `pnpm typecheck` ✅ · suite unitaria ✅ **1479 tests, 0 rojos** (142 archivos; integración excluida por falta de stack local).
- `stock.integration.test.ts` corrido **contra el cloud**: ✅ 13/13, con tres casos nuevos —
  vender 3 sobre stock 1 deja `-2` y el producto disponible (y el ingreso siguiente arranca del faltante),
  el ingreso no reenciende un producto apagado a mano,
  el ajuste puede dejar negativo sin tocar la disponibilidad.
- Prueba directa de los triggers contra el cloud dentro de una transacción revertida: venta `qty=-2 avail=t` · edición de línea a 5 `qty=-4 avail=t` · reversión con producto apagado a mano `qty=1 avail=f`.
- **No verificado en vivo con el rol real** (encargado en el panel).
