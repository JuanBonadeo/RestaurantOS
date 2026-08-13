# 122 · El sidebar arranca chico y crece al trabajar

**Issue:** [#186](https://github.com/gachetponzellini/RestaurantOS-app/issues/186) ·
**Milestone:** Post-demo · Growth & hardening

## Por qué

Pedido de Juan: sin tocar ninguna mesa el panel tendría que ser bastante más
chico, así se ve el plano, y agrandarse cuando tocás algo.

Vale aclarar qué se está revirtiendo, porque el ancho único **era a propósito**:
cuando la base medía 360 y crecía por modo, el sidebar *saltaba* al entrar a
cobrar, y congelarlo en ancho de trabajo fue la forma de sacarse el salto de
encima.

El problema es que esa solución le cobra el ancho al plano **todo el turno**. El
plano es donde el encargado mira, y en reposo el panel sólo lista mesas y
reservas: no necesita la mitad de la pantalla para eso.

Así que lo que se arregla ahora es **el salto**, no el ancho.

## Qué se construye

- **En reposo** (`modoPanel === "lista"` y sin distribuir): `340px`.
- **Trabajando**: los anchos de siempre — 480 de 1024 a 1279, y de 1280 para
  arriba la mitad del split con piso 620 y techo 1100 (spec 111, fase 5).
- `panelExpandido = modoPanel !== "lista" || distribuirOpen`. `distribuirOpen`
  va aparte porque no está en `modoPanel` —lo abre la barra del salón, desde
  afuera— pero ocupa el panel igual que el resto.
- **`transition-[grid-template-columns]` de 300ms**, que es lo que faltaba la
  primera vez: el panel crece en vez de pegar un tirón. Con
  `motion-reduce:transition-none`.
- **Abrir y cerrar no usan la misma curva.**

  | | Duración | Curva | Por qué |
  |---|---|---|---|
  | Abrir | 300ms | `cubic-bezier(0.32,0.72,0,1)` | La de la casa —el sidebar del admin, el shell, el super—. Arranca rápido y frena largo: el panel «llega». Importa que sea ésa porque los dos sidebars pueden animar juntos, y dos curvas distintas se leen como que una va atrasada. |
  | Cerrar | 180ms | `cubic-bezier(0.4,0,1,1)` | Acelera y se va. Con la curva de entrada, salir se arrastraba: el panel suelta su contenido en el mismo commit —vuelve la lista— y te quedabas 300ms mirando cómo esa lista se reacomoda mientras la columna se achica. En 180ms el reflujo pasa antes de que lo leas. |

  Es la asimetría de siempre en motion: entrar se acompaña, salir se despacha.

## Qué NO cambia

Nada de lo que pasa adentro del panel. Los container queries de la spec 115
(`@2xl`) ya miden el ancho **del panel**, así que las dos columnas de la carga
aparecen y desaparecen solas según el ancho que tenga en cada momento — sin
tocar una línea.

## Verificación

1. `pnpm typecheck` + `pnpm test` en verde.
2. En vivo: entrar a Operación → Mesas sin tocar nada → el plano se lleva casi
   todo. Tocar una mesa → el panel crece parejo, sin salto.
3. Con «Distribuir mozos» y con «Nueva reserva» también crece.
4. Con `prefers-reduced-motion`, cambia de ancho sin animar.
