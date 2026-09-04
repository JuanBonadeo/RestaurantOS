# 154 · Ver el ticket como sale impreso, sin print agent

**Issue:** [#231](https://github.com/gachetponzellini/RestaurantOS-app/issues/231) ·
**Milestone:** Post-demo · Growth & hardening ·
**Estado:** 📋 propuesta (2026-09-03) — sin implementar

**Input:** Juan, 2026-09-03: *"habría que hacer algo con la impresión de las
comandas para que en la demo se pueda probar igualmente"* → *"a lo que voy es que
salga **como impresa**, pero sin tener ningún print agent conectado, que eso es lo
difícil de testear"*.

**Depende de**: [`051`](../051-print-agent-render-server/spec.md) (el render vive
en el server: sin eso no habría bytes que interpretar),
[`084`](../084-factura-impresa-comandera-fiscal/spec.md) (el QR de ARCA, el único
comando no textual del stream),
[`035`](../035-reimpresion-y-fallos-de-impresion/spec.md) (el tab Comandas, donde
entra el botón).

---

## Por qué

**Las comanderas están en Golf.** En `demo` no hay agente ni impresora, así que
todo lo que toca papel se verifica a ciegas — y el 2026-09-03 se tocaron **tres**
specs sobre el mismo renderer: la 145 (el menú en la comanda), la 139-B (el papel
del cierre) y el fix de los tickets del cliente.

De los **cinco** papeles que salen de `renderEscPos`, **uno solo tiene tests de
paridad byte-a-byte**: la comanda. Los otros cuatro —cuenta, control, cierre y
factura— salieron sin que nadie viera cómo quedan.

### El caso que prueba que esto hace falta

Ese mismo día, el primer intento de achicar el control de pedido bajó la lista de
ítems de `tall` a `sm` y anunció **«−26 % de papel»**. Era **falso**: el avance lo
fija `ESC 3`, que se emite una vez por documento, así que el ticket medía
exactamente lo mismo con la letra más chica. Lo cazó una auditoría cuatro horas
después.

**Un visor lo habría mostrado en dos segundos — pero sólo si lee los bytes.**
Medido sobre el control con 12 ítems, comparando la versión rota contra la
arreglada:

| Cómo mide el visor | Ticket roto | Ticket sano | ¿Ve la diferencia? |
|---|---|---|---|
| **Parseando los bytes** | 3392 pt | 2624 pt | **sí — 23 %** |
| Dibujando las `Line[]` | 1656 pt | 1656 pt | **no — 0 %** |

Un visor que dibuje `Line[]` pasa el escenario «los `tall` se ven más grandes» y
es **ciego al 100 % de los bugs de interlineado**. Sería peor que no tenerlo: da
confianza sobre un papel que nadie está mirando.

## Las decisiones

**D1 · Se parsean los BYTES.** No las `Line[]`. Además del interlineado, hay dos
razones estructurales: **el perfil tipográfico no está en `Line[]`** —
`renderEscPos(lines, "cierre")` emite `ESC M 1` y `ESC SP 0` por su *segundo
argumento*, y el papel pasa de 24 a 42 columnas sin que una sola línea cambie —, y
**el diffing de estado** (`if (s !== size)`, `if (sp !== spacing)`) es código que
puede tener bugs de sincronización que sólo los bytes delatan. Dibujar `Line[]`
sería una segunda implementación de `renderEscPos`, que es exactamente lo que hay
que verificar.

**D2 · El visor NO se cuelga del `GET /api/print-agent`.** *(Anula la D2 de la
versión anterior de esta spec.)* Tres razones verificadas: el GET exige Bearer de
`print_agent_credentials` y **`demo` no tiene agente ⇒ 401** — o sea que fallaría
justo en el negocio para el que se pide; sólo devuelve lo que está en la **cola de
despacho** (`pendiente` o con reimpresión pedida), nunca un ticket viejo; y filtra
por alcance de comandera. En cambio se extrae de `route.ts` el **armado del
payload** a un módulo por familia (`loadXPayload(service, businessId, id)`: una
pieza por su id, sin filtros de cola ni de impresora). El GET pasa a ser
*seleccionar qué imprimir* + llamar al mismo loader. **Eso es lo que hace fiel al
visor por construcción** — llamar sólo a los `build*Lines` no alcanza, porque el
armado del payload es justamente donde vive la mitad de la verdad.

**D3 · Son CINCO papeles, no cuatro.** El inventario estaba incompleto: el mismo
endpoint sirve también la **factura** (`buildFacturaTicketContent`), y es **la
única con QR**. Así que soportar `GS ( k` no es «para después»: entra el día uno.

**D4 · El QR rompe la cuenta del papel, y hay que resolverlo.** Un QR **no avanza
con un LF**: avanza `(17 + 4·versión) × moduleSize` puntos. Con la URL real de
ARCA (313 caracteres → QR v13, 69 módulos, `moduleSize` 6) son **414 puntos ≈ 5,2
cm** que un modelo ingenuo cuenta como un renglón de 8 mm. Medido: la factura da
**16,0 cm calculados contra ~21,2 cm reales — 25-30 % de error, justo en el
comprobante fiscal**. El parser intercepta `GS ( k` función 180 y suma módulos ×
`moduleSize`; si no se implementa la tabla de versiones, el chip dice «19,2 cm +
QR» y **no un número redondo que miente**.

**D5 · Primero el intérprete, después la pantalla.** El corazón es
`src/lib/print/escpos-paper.ts`: puro, `parseEscPos(bytes) → Renglon[]`, sin DB y
sin React. No puede vivir en `scripts/`: el `tsconfig` **excluye ese directorio**,
así que `pnpm typecheck` lo ignoraría entero y vitest no podría testearlo. Con el
módulo puro, la UI es la parte fácil.

**D6 · Se decodifica en latin1, jamás en utf-8.** El `pL` del `GS ( k` es
`len & 0xff` y **puede pasar de 0x7f**: probado con URLs de QR de 153/193/233
caracteres, el round-trip por utf-8 **falla** y por latin1 anda siempre. Es la
misma codificación con la que se generan los bytes.

**D7 · Un byte desconocido se dibuja como ruido VISIBLE, nunca se saltea en
silencio.** Un parser que ignora lo que no entiende produce un papel plausible y
falso. Va con un test de cobertura: los opcodes que el sistema emite están
enumerados, y si aparece uno nuevo el test lo caza.

**D8 · SVG, con una `x` explícita por carácter y el tamaño por `scale()`.** No
`font-size`: la relación entre normal y doble alto tiene que ser **exactamente
2×**, no «más grande a ojo». La fuente monoespaciada no garantiza el ancho de
celda — **la grilla sí**; la fuente sólo se calibra para que entre. Y el
`charSpacing` **se duplica en doble ancho**: el avance es
`(cellW + charSpacing) × wMul`, no `cellW × wMul + charSpacing`. Si no, el wrap
del visor deja de coincidir con el del papel.

**D9 · El largo del papel, en centímetros y arriba de todo.** Es el número que
habría desmentido el «−26 %» al instante. Separado en **impreso** y **cortado**,
porque son dos cosas distintas.

**D10 · En `demo` se ejercita por script, sin credencial nueva.** Un script que
arma los cinco papeles con datos de ejemplo y escribe un HTML. No hace falta
inventarle un print agent a `demo` — que era el otro camino, y crea una credencial
de producción para una necesidad de desarrollo.

## Alcance

- **`src/lib/print/escpos-paper.ts` (nuevo)** — el parser puro (D5, D6, D7).
- **`src/lib/print/escpos-paper.test.ts`** — anclado a los fixtures congelados
  **y** a los builders puros, que son importables y no tocan DB. Ojo: los cinco
  fixtures actuales **sólo cubren la comanda** — no traen `ESC M` ni `GS ( k`, y
  tienen un solo `ESC 3`. El corpus se arma por **papel**, no por caso de comanda.
- **`src/lib/print/*-payload.ts`** — el armado extraído de `route.ts` (D2), una
  familia por módulo. Arrastra mover `sanitizeTicketText` a `ticket.ts` y
  exportarla: hoy es privada del route y se usa 11 veces adentro.
- **El visor SVG** + el botón en el tab Comandas, con el mismo permiso que
  Reimprimir (no se inventa un `canVerTicket`).
- **`scripts/preview-tickets.ts`** — los cinco papeles a un HTML (D10).
- **Sin migración.**

## Qué NO entra

- **Emular una impresora genérica.** Se interpretan los **nueve** comandos que
  este renderer emite, no el estándar ESC/POS.
- **Imprimir desde el visor.** Reimprimir ya existe y es otro gesto.
- **Previsualizar antes de enviar la comanda** — el ticket existe cuando la
  comanda existe; adelantarlo es armar un payload falso.

## Escenarios de aceptación

1. **Dado** un ticket cualquiera, **cuando** se lo mira en el visor, **entonces**
   se ve el papel a escala: tamaños, negrita, alineación y **el largo en cm**.
2. **Dado** el control de pedido **sin** `COMPACT_SPACING` (la versión rota),
   **entonces** el visor muestra un papel **23 % más largo** que la sana. Es el
   test de que el visor sirve para algo.
3. **Dado** el papel del cierre, **entonces** se ve en Font B a 42 columnas,
   distinto de los otros cuatro.
4. **Dado** la factura con el QR de ARCA, **entonces** el QR se dibuja con su
   tamaño real y el largo del papel lo incluye (D4).
5. **Dado** `demo`, que **no tiene print agent**, **entonces** el visor funciona
   igual.
6. **Dado** un byte que el parser no conoce, **entonces** se ve como ruido en el
   papel y el test de cobertura falla.

## Verificación

Pendiente — sin implementar.

Cuatro capas, cada una con su evidencia:

1. **Decode** — round-trip `parse(renderEscPos(lines))` contra las `lines`
   normalizadas **más el epílogo**: `renderEscPos` emite tres avances en blanco
   antes del `GS V 0`, así que 22 renglones de contenido dan 25 campos. Una línea
   con `qr` es **lossy a propósito**: se recupera el payload, no el texto.
2. **Corpus** — los cinco papeles, no cinco casos de comanda.
3. **Geometría** — función pura calibrable, con el test que resume todo: *«bajar
   el `size` no acorta el papel»*.
4. **Calibración contra Golf** — **dos** tiras, porque el perfil es por documento:
   una en Font A (`"comanda"`, con `ESC SP 4` y el QR) y otra en Font B
   (`"cierre"`, la única que ejercita `ESC M 1`). Se imprimen seguidas, se
   fotografían **con una regla al lado**, y se guardan los tres artefactos juntos:
   bytes, captura del visor y foto del papel. Una visita, una foto.
