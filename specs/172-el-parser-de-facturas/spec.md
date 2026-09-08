# 172 · El parser de facturas de proveedor

**Issue:** [#275](https://github.com/gachetponzellini/RestaurantOS-app/issues/275) ·
**Milestone:** Post-demo · Growth & hardening ·
**Estado:** 🚧 en curso

**Depende de**: [`165`](../165-el-renglon-por-insumo/spec.md) (el renglón, la RPC y
la conversión por envase), [`164`](../164-los-precios-de-los-insumos/spec.md) (de
donde sale la regla de que no se adivina un match que escribe plata),
[`158`](../158-comprar-y-pagarle-al-proveedor/spec.md) (el comprobante),
`10` (el costeo, que es quien consume el precio).

---

## Por qué

**La 165 construyó el renglón. Nadie lo usa, porque tipearlo cuesta más que la
plata que ahorra.**

Medido en la nube antes de esta spec:

| | |
|---|---|
| comprobantes con renglones en `golf-jcr` | **0** de 3 |
| ídem en `demo` y `kcc` | **0** |
| `ingredient_price_log` | 0 filas |
| insumos activos en `golf-jcr` | 122, con 111 proveedores dados de alta |

Y en MaxiRest, con ocho años de operación real: sólo **242 de 3.677** comprobantes
de 2025 (6,6%) y **124 de 1.502** de 2026 (8,3%) traen detalle por insumo. El 92%
entra con concepto de gasto y **no mueve stock ni costo**.

La 165 leyó ese 92% como una preferencia y lo respetó (D1, el editor arranca
cerrado). Es correcto, pero incompleto: **también es un costo**. Cargar cinco
renglones a mano son cinco selects sobre una lista de 122 insumos sin buscador,
cinco cantidades y cinco precios, con la factura en una mano. En hora de recepción
de mercadería, nadie lo hace.

### El pedido llegó de la primera usuaria real

Rocío, encargada del Golf, el 2026-09-08, cargando comprobantes por primera vez:

> *«Yo cuando subo las facturas de MaxiRest con cada producto y con su precio, yo
> ahí me doy cuenta si hubo una modificación de precios [...] instantáneamente
> cuando yo lo actualizo se actualiza en las recetas. Acá no estaría pasando eso,
> ¿o sí?»*

Sí pasa —es exactamente lo que hace `registrar_items_comprobante_tx`— pero sólo si
carga los renglones. **La feature existe y la fricción la esconde.**

### Ya estaba anotado

`wiki/specs/12-proveedores/proposal.md:56`, al abrir el módulo:

> *«OCR / lectura automática de la factura: se sube la foto y se cargan los datos
> **a mano**. Auto-extracción queda como futuro.»*

### La factibilidad está probada, no supuesta

Las cinco fotos que mandó Rocío se leyeron y se cruzaron contra el catálogo del
cloud. La manuscrita de la carnicería dio los cinco renglones, y **los cinco
precios coinciden exacto** con el costo por unidad base del sistema:

| Renglón manuscrito | Insumo | $/kg papel | $/kg sistema |
|---|---|---|---|
| ENTRECOT 82,600 kg | Entrecot | 17.500 | **17.500** |
| LOMO 14,600 kg | Lomo | 24.500 | **24.500** |
| NALGA 22,100 kg | Nalga | 21.000 | **21.000** |
| ENTRAÑAS 5,100 kg | Entraña | 24.500 | **24.500** |
| PECETOS 4,100 kg | Peceto | 20.000 | **20.000** |

Ese proveedor ya tiene esos cinco insumos vinculados en `supplier_ingredients`. El
caso tiene ground truth completo y es el test de aceptación de la spec.

---

## Las decisiones

**D1 · El modelo transcribe. La aritmética decide.**

El modelo devuelve lo que está impreso —cantidad, unidad, precio, total— **como
texto, verbatim, con sus comas y sus puntos**. No convierte, no calcula, no
completa. La conversión a envases y la verificación la hace TypeScript puro.

Los separadores son información: `"82,600"` con coma y `"1.445.500"` con puntos
son las dos pistas que permiten desambiguar por convención argentina y, cuando eso
no alcanza, por aritmética. Un modelo que devuelve `number` ya decidió, y decidió
en el lugar donde no lo podemos verificar.

**D2 · Lo que no se leyó llega vacío, nunca en cero.**

Es la regla que evita el peor bug conocido de un módulo hermano de la
organización: *«un `null` interno —"no lo leí"— se convertía en `0,00` al exportar.
Sobre una Factura A eso no es un dato faltante: es un dato **falso**, y encima
invisible, porque el comprobante figuraba procesado en pantalla.»*

Acá el agujero equivalente ya existe y está abierto: `schema.ts:122` es
`total_cents: z.number().int()` —sin `.positive()`—, el CHECK de la base pide
`>= 0`, y el `defaultValue` del formulario es **`0`**. Un comprobante de $0 se
guarda hoy sin chistar y figura cargado en la cuenta corriente.

**D3 · Ninguna capa auto-asigna un insumo. Nunca.**

La 164·D2 ya lo dejó escrito: *«adivinar el match por similitud sería escribir un
precio inventado sobre plata que el dueño va a leer como si fuera medida»*.

Acá se implementa **mecánicamente, no por disciplina de UI**: un renglón cuya
propuesta no es de confianza alta llega **destildado**, y una fila destildada no
entra en el payload. El sistema literalmente no puede escribir una adivinanza.

**D4 · El umbral del fuzzy es 0,62 porque anular no arregla el precio.**

El peor caso concreto: `Pickers Pulpa de Pal` (un corte de carne) matchea a
`Pan de lomo` con score 0,327 — es el top-1 real sin guarda. Si entrara, la RPC
pisa `ingredient_presentations.cost_cents` del Pan de lomo, el trigger asienta el
histórico, y **todas las recetas que lo usan re-costean**.

Y la 165·D4 es explícita: anular devuelve el stock, **el precio no**, porque es un
hecho histórico. La segunda línea de defensa —anular y rehacer— **no cubre este
modo de falla**. Por eso la defensa tiene que ser toda anterior, y por eso el
umbral es conservador.

Medido sobre 25 líneas reales contra los 122 insumos de `golf-jcr`:
**17 aciertos, 0 errores, 8 abstenciones**, con un hueco de 0,30 entre el peor
acierto (`QUESO MUZZARELLA`→Muzarella, 0,650) y el peor falso positivo
(`PAN RALLADO`→Panko, 0,355).

**D5 · El precio corrobora, no matchea.**

Tentador y medido como falso: `Entraña` y `Lomo` valen **los dos exactamente
$24.500/kg**, o sea que un matcher por precio empata **dentro del propio caso de
oro**, en 2 de los 5 renglones. El 26% del catálogo comparte su $/unidad-base con
otro insumo a ±0,5%.

Lo que el precio sí hace es **alarma**: el $/unidad-base nuevo contra el actual, en
cada renglón, con el factor. Es lo único honesto que se puede hacer con
`4 HUEVOS ENTRE RIOS B1 × $27.500` contra una presentación `Maple 30 un` de
$5.749,80 — el sistema no puede saber si esos 4 son maples o cajas, pero **sí puede
poner el ×4,8 delante de los ojos**.

**D6 · Se guarda lo que decía el papel.**

`supplier_invoice_items` gana `source_text` y `match_source`. Es el equivalente de
`mxitc.referencia`, que MaxiRest tiene y nosotros perdemos.

Sin `match_source` no hay forma de responder *«la máquina propuso X y la persona lo
corrigió a Y»* después de que se cierra el diálogo, y **un umbral que no se puede
medir no se puede defender**: 0,62 quedaría siendo 0,62 para siempre porque sí.
Todo el análisis que sostiene la 165 se pudo escribir sólo porque `mxitc.referencia`
existía.

Se escriben en el `insert` y nunca se actualizan: la regla de la 165 —los renglones
no se editan— queda intacta.

**D7 · De los productos se carga la cantidad, no el precio.**

La factura de CEPRO es casi toda bebida y reventa, que son `products` con
`track_stock`, no `ingredients`. Verificado: **no existe ningún campo de costo para
productos** — `products` sólo tiene `price_cents`, que es el precio de venta, y ni
`stock_items` ni `stock_movimientos` tienen costo.

Así que el renglón de producto suma stock y la pantalla dice por qué no toca el
precio. Crear el costo de reventa —columna, histórico y algún concepto de pack,
porque la factura dice «1 caja de 24 latas» y el stock cuenta latas— es traer el
food cost al mundo de la reventa: es una spec propia.

---

## Alcance

**Datos** — migración `0092`: `normalizar_texto_insumo`, el índice único
normalizado sobre `ingredients`, `supplier_ingredient_aliases` + RLS, las columnas
`source_text`/`match_source`, y `registrar_items_comprobante_tx` extendida (aliases
+ renglones de producto) sin cambiar la firma.

**Server:** `POST /api/proveedores/leer-comprobante` (Route Handler, `maxDuration
= 60`); `src/lib/proveedores/lectura/` con el prompt, el schema y las cuatro capas
puras; `getRenglonesDeComprobante`.

**UI:** la pantalla de revisión dentro del diálogo de compra; el panel de renglones
en la cuenta corriente; `capture` y achicado en el uploader.

## Qué NO entra

- **La foto por WhatsApp.** El webhook entrante existe pero descarta toda la media
  —`parseGupshupInbound` colapsa a `{kind:"media"}` sin teléfono ni URL— y la spec
  38 dejó abierto si el link de `filemanager.gupshup.io` requiere auth y cuánto
  dura. Atar el parser a eso lo bloquea. Es la spec siguiente.
- **Auto-asignar sin confirmación** (D3).
- **Crear insumos automáticamente** desde líneas sin match. Se ofrece el alta con
  el nombre precargado, pero el campo hay que tocarlo: si no, el catálogo de 122
  insumos se llena de ruido de OCR en dos meses.
- **El costo de productos de reventa** (D7).
- **Editar los renglones de un comprobante ya cargado.** La 165 ya lo excluyó y
  esto no lo reabre: lo vuelve más importante, no menos.
- **Alias negativos** («este texto nunca es un insumo»). Invitan a descartar en
  silencio una línea que el mes que viene sí es un insumo.
- **Embeddings.** `pg_trgm` alcanza y sus umbrales se pueden defender línea por
  línea; un coseno no.

## Escenarios de aceptación

1. **Dado** la foto de la factura manuscrita de la carnicería, **entonces** salen
   los 5 renglones y el del entrecot llega con `units = 8,26` y
   `unit_cost_cents = 17.500.000`.
2. **Dado** que la suma de los renglones da $2.474.250 y el papel dice $2.474.280,
   **entonces** se carga igual y la pantalla muestra la diferencia.
3. **Dado** un renglón cuyo texto no matchea ningún insumo con score ≥ 0,62,
   **entonces** llega **destildado** y sin insumo asignado.
4. **Dado** que el usuario no toca nada y guarda, **entonces** sólo se cargan los
   renglones que llegaron tildados.
5. **Dado** la factura de BACA (limpieza y descartables), **entonces** se carga el
   comprobante **sin ningún renglón** y la pantalla dice por qué está bien.
6. **Dado** un renglón cuyo $/unidad-base es más del doble del actual, **entonces**
   exige un tilde explícito extra.
7. **Dado** que el modelo no lee el importe, **entonces** el campo queda **vacío** y
   el formulario no deja guardar — nunca un comprobante de $0.
8. **Dado** que el usuario corrige el insumo de un renglón y guarda, **entonces**
   queda un alias con `origen = 'manual_corregido'` para ese proveedor y ese texto.
9. **Dado** la misma factura leída dos veces, **entonces** la segunda avisa que ya
   está cargada antes de guardar.
10. **Dado** un `photoPath` de otro negocio, **entonces** el endpoint responde 403.
11. **Dado** que no hay `ANTHROPIC_API_KEY`, **entonces** el botón no aparece y el
    formulario manual funciona igual.
12. **Dado** un comprobante con renglones ya cargado, **entonces** sus renglones se
    pueden ver desde la cuenta corriente.

## Verificación

**Implementado y verificado el 2026-09-08**, salvo la lectura real. `pnpm
typecheck` limpio y **2.512 unitarios en verde** (43 más que la baseline).

**Lo determinístico, que es casi todo, corre en CI:** el parseo de números
argentinos, la conciliación aritmética, la conversión a envases y las guardas de
columna. El test de aceptación de la feature está escrito: `82,600 kg × $17.500`
→ `units = 8,26` y `unit_cost_cents = 17.500.000`, los tres números de la nota de
pedido real de la carnicería.

**Los umbrales del matcher, contra el catálogo real de 122 insumos**: 13 aciertos,
0 errores, 6 abstenciones. `QUESO MUZZARELLA` → Muzarella entra a 0,650 (el caso
que la 164·D2 dejó pendiente) y `PAN RALLADO` se abstiene a 0,355 en vez de
escribir su precio sobre el panko. Queda como test de regresión: si alguien baja
el umbral, ese archivo dice cuál es el primero que se rompe.

**La RPC de la 165, cubierta**: 7 escenarios, incluida la conversión por envase,
el consumo con costo real, el precio que se reescribe y el que no, la rama sin
presentación, el insumo de otro negocio, y anular —el stock vuelve, el precio no.
P13 la había reportado sin un solo test.

**En vivo como Sofía (encargada) sobre el stack local:**

- Los renglones de un comprobante cargado se ven: «8,26 × Compra 10kg · entraron
  82,6 kg · $175.000 por envase», subtotal **$1.445.500** — el mismo número que el
  papel. El stock del Entrecot subió de 15,11 a 97,71 kg.
- La ficha del insumo muestra el historial: «08/09/2026 · Compra 10kg · $15.100 →
  $175.000 · **+1059%**», en ámbar por superar el ±60%.
- El endpoint de lectura, de punta a punta: auth, la guarda de tenant sobre el
  `photoPath`, la descarga del bucket privado y el error tipado que no filtra el
  mensaje del proveedor.

### Lo que queda pendiente

**La lectura real no se pudo probar: la `ANTHROPIC_API_KEY` del entorno devuelve
401.** Todo lo que rodea al modelo está verificado; falta la corrida con las 5
fotos, que es la que dice si el prompt sirve. Los escenarios 1, 2, 5 y 9 dependen
de eso.

**La `0085` no está aplicada al cloud** — en `golf-jcr`, hoy, una nota de crédito
con renglones suma stock y pisa el costo con el precio de la devolución (#268,
hallazgo 1). No es de esta spec, pero el lector multiplica la exposición.

**El aviso de duplicado** (escenario 9) todavía no está: el número leído está
disponible en la cabecera, falta el chequeo contra los comprobantes del proveedor
antes de guardar.

**Los renglones de producto** (bebida y reventa) quedaron fuera con la decisión
D7: se lee la línea, no matchea insumo, y se dice.
