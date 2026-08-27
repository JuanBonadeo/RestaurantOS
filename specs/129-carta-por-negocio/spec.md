# 129 · La carta visual, parametrizada por negocio

**Issue:** [#200](https://github.com/gachetponzellini/RestaurantOS-app/issues/200) ·
**Milestone:** Post-demo · Growth & hardening ·
**Estado:** implementada (2026-08-27), verificada en vivo en `/kcc/carta` y `/golf-jcr/carta`

**Input:** Juan, 2026-08-27: *"habría que armar la carta para kcc igualmente que
como hicimos en el golf"*. Elegida la paleta real de KCC (terracota + crema)
sobre la del Golf.

## Por qué

La spec 44 migró a RestaurantOS la identidad de carta de golf-house tal cual
estaba en su menufacil. Lo hizo **hardcodeada**, y lo dejó anotado:

> *Parametrizar el cover art por business (hoy hardcodeado a golf-house en la
> constante `COVER` de `carta-client.tsx`): mover a settings/storage cuando otro
> tenant use carta.*

Ese otro tenant ya existe. **KCC (Kentucky Club House)** se creó el 2026-08-27
con 329 productos, y su `/kcc/carta` hoy muestra el lino navy, el golfista y el
wordmark del Golf. Un local sirviendo la carta de otro local no es un detalle
estético: es la marca equivocada en la mesa del comensal.

KCC tiene identidad propia, publicada y consistente en
`kentuckyclubhouse.menufacil.ar` — el mismo caso que el Golf, así que se hace lo
mismo: se migra la marca del cliente, no se inventa una.

| | Golf | KCC |
|---|---|---|
| Cover | lino navy `#2b2f38` + golfista dorado | terracota plano `#A12D15` |
| Wordmark | script/serif «Restaurant del Golf» | slab blanco «kentucky ▲ club house» |
| Papel | blanco | crema `#F5F2E9` con textura |
| Tinta | `#333` | `#363636` |
| Acento | dorado `#b0956b` | terracota `#A12D15` |
| Títulos | script (Great Vibes ← Angelic) | serif itálica (Fraunces ← PP Kyoto) |
| Ornamento | cenefa dorada | ninguno |
| Label bajo el wordmark | «RESTAURANTE» | ninguno |

## Las decisiones

**D1 · El tema vive en `businesses.settings.carta`, no en una tabla nueva.**
`settings` ya es `jsonb` y ya guarda el branding del negocio. La carta es
presentación pura: cero datos, cero migración, cero RLS nueva. Un tenant nuevo
se resuelve con un `update` y dos archivos en `public/`.

**D2 · El default es el Golf, resuelto en el server.** `resolveCartaTheme()`
hace merge de lo que haya en `settings.carta` sobre `CARTA_THEME_GOLF`. Si un
negocio no configuró nada, ve exactamente lo que veía antes — `golf-jcr` no
cambia ni un pixel y no hace falta escribirle nada. El merge es por campo, así
que un tenant puede cambiar sólo el color y heredar el resto.

**D3 · Los tokens viajan como CSS vars inline sobre `.carta-theme`.** El bloque
de `globals.css` pasa a declarar los valores del Golf como *fallback* de cada
var (`var(--carta-cover-x, #2b2f38)`) y el componente inyecta las suyas en el
`style` del contenedor. Así el tema sigue scopeado, el dark mode sigue
funcionando, y no hay una clase por cliente.

**D4 · El arte sigue versionado en `public/carta/<slug>/`.** Igual que los del
Golf. El campo acepta también URL absoluta, así que el día que haya UI de admin
+ Storage el modelo no cambia — sólo el origen del string. Subirlo a Storage hoy
sería infra sin nadie que la use.

**D5 · Las piezas del cover son opcionales, y su ausencia es un layout distinto,
no un hueco.** El Golf apila figura + wordmark superpuesto + label + ornamento.
KCC tiene sólo wordmark. Cuando no hay `figure_url`, el wordmark se centra solo
a su tamaño natural en vez de posicionarse encima de una figura que no existe;
cuando no hay `ornament_url`, no se dibuja la cenefa ni el hueco que ocupaba.

**D6 · El título de sección tiene dos estilos, no una fuente libre.**
`title_style: "script" | "serif-italic"`. Las fuentes se cargan en
`app/layout.tsx` con `next/font` — no se pueden elegir en runtime desde un
string arbitrario sin romper el preload. Dos estilos cubren los dos clientes y
el que venga se suma acá.

## Alcance

**Incluye:**
- `src/lib/menu/carta-theme.ts`: tipo `CartaTheme`, default Golf, `resolveCartaTheme(settings)`.
- `carta-client.tsx`: recibe `theme`, inyecta las CSS vars, cover y títulos condicionales.
- `carta/page.tsx`: resuelve el tema del negocio.
- `globals.css`: `.carta-theme` con vars parametrizables (fallback = Golf) + `.carta-serif-italic`.
- Assets de KCC en `public/carta/kcc/` (wordmark, textura de papel).
- `settings.carta` de `kcc` + branding (colores, fuentes, icono).

**No incluye:** migraciones, datos, RLS, permisos, `/menu`, operación, admin,
UI para editar el tema (se escribe por SQL, como el branding del Golf).

## Tasks

1. [x] `carta-theme.ts` — tipo + default Golf + resolver.
2. [x] `globals.css` — vars parametrizables + estilo serif-italic.
3. [x] `carta-client.tsx` — prop `theme`, cover condicional, títulos por estilo.
4. [x] `carta/page.tsx` — resolver y pasar el tema.
5. [x] Assets de KCC en `public/carta/kcc/`.
6. [x] `settings.carta` + branding de `kcc` en la nube.
7. [x] `pnpm typecheck` + tests en verde.
8. [x] Verify en vivo: `/kcc/carta` contra su menufacil, y `/golf-jcr/carta` sin cambios.

## Verificación (hecha)

- ✅ `pnpm typecheck` + 1778 tests unitarios en verde (5 nuevos en `carta-theme.test.ts`).
- ✅ **Golf intacto**: cover con lino + golfista + wordmark + «RESTAURANTE» + cenefa;
  papel `#ffffff`, tinta `#333333`, acento `#b0956b`, cuerpo Montserrat, títulos Great
  Vibes 46px, los 150 líderes punteados en `#b0956b`.
- ✅ **KCC**: cover terracota con su wordmark; papel `#F5F2E9` con textura, tinta
  `#363636`, acento `#A12D15`, cuerpo y títulos Fraunces (itálica, 30px), cero
  ornamentos, líder punteado terracota.
- ✅ **Dark mode**: el papel de KCC pasa a `#16181d` y la tinta a `#ece7df` mientras el
  acento y el cover siguen terracota — el `.dark` de CSS le gana al style inline (D3).

### Criterios originales

- **Golf no cambia**: `/golf-jcr/carta` idéntica antes/después (el negocio no
  tiene `settings.carta`, así que cae al default).
- **KCC**: cover terracota con su wordmark, cuerpo crema con textura, títulos en
  serif itálica, líder punteado terracota.
- Rol real (comensal anónimo, nunca service_role), mobile-first, dark mode, sin
  errores de consola.
