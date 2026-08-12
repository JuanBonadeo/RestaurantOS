import { Skeleton } from "@/components/ui/skeleton";

/**
 * Skeletons de las rutas de mesa del mozo/admin (spec 39, FR-001/FR-002).
 * Calcan el header sticky (botón volver + eyebrow + título de mesa) y los
 * placeholders del contenido principal de cada destino, de modo que al
 * reemplazarse por el contenido real no haya salto de layout.
 *
 * Los tres destinos comparten el mismo header; cambia el cuerpo:
 * - `pedir`  → buscador + chips de categoría + grilla de productos.
 * - `cuenta` → líneas de items + totales.
 * - `cobrar` → barra de progreso + KPI "falta cobrar" + splits.
 */
export type MesaRouteVariant = "pedir" | "cuenta" | "cobrar";

const MAX_WIDTH: Record<MesaRouteVariant, string> = {
  pedir: "max-w-md",
  cuenta: "max-w-screen-md",
  cobrar: "max-w-screen-md",
};

function MesaHeaderSkeleton({ variant }: { variant: MesaRouteVariant }) {
  return (
    <header className="sticky top-0 z-30 border-b border-zinc-200 bg-white/95 backdrop-blur-md">
      <div
        className={`mx-auto flex ${MAX_WIDTH[variant]} items-center gap-3 px-4 py-3`}
      >
        {/* botón volver */}
        <Skeleton className="h-9 w-9 shrink-0 rounded-full" />
        <div className="min-w-0 flex-1 space-y-1.5">
          <Skeleton className="h-2.5 w-24" />
          <Skeleton className="h-4 w-32" />
        </div>
        {variant !== "pedir" && <Skeleton className="h-8 w-20 rounded-md" />}
      </div>
    </header>
  );
}

/**
 * Skeleton del panel de carga **embebido** en el sidebar del salón (spec 114).
 *
 * Antes ahí había una línea de texto que decía "Cargando catálogo…" — y mentía
 * dos veces: el catálogo ya está en memoria (cache de la spec 105) y lo que se
 * espera es el estado de esa mesa. Un renglón centrado tampoco dice nada de lo
 * que viene; esto calca el buscador, los chips y la grilla, que es lo que el
 * que carga está por usar.
 */
export function PedirPanelSkeleton() {
  return (
    // `role="status"` con nombre: el resto de los skeletons son `aria-hidden`
    // porque acompañan a un contenido que ya se anuncia, pero acá el panel
    // entero es esto — sin nombre, quien no ve la pantalla no se entera de que
    // hay algo cargando.
    <div role="status" aria-label="Cargando la mesa" className="space-y-4 p-4">
      <Skeleton className="h-11 w-full rounded-2xl" />
      <div className="flex gap-2 overflow-hidden">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-7 w-20 shrink-0 rounded-full" />
        ))}
      </div>
      <div className="space-y-2">
        {Array.from({ length: 7 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full rounded-xl" />
        ))}
      </div>
    </div>
  );
}

function PedirBodySkeleton() {
  return (
    <div className="mx-auto max-w-md space-y-4 p-4">
      <Skeleton className="h-10 w-full rounded-xl" />
      <div className="flex gap-2 overflow-hidden">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-7 w-20 shrink-0 rounded-full" />
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-28 w-full rounded-2xl" />
        ))}
      </div>
    </div>
  );
}

function CuentaBodySkeleton() {
  return (
    <div className="mx-auto max-w-screen-md space-y-3 p-4">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <Skeleton className="h-8 w-8 rounded-md" />
            <Skeleton className="h-4 w-40" />
          </div>
          <Skeleton className="h-4 w-16" />
        </div>
      ))}
      <div className="mt-6 space-y-2 border-t border-zinc-200 pt-4">
        <div className="flex items-center justify-between">
          <Skeleton className="h-5 w-24" />
          <Skeleton className="h-5 w-20" />
        </div>
      </div>
    </div>
  );
}

function CobrarBodySkeleton() {
  return (
    <div className="mx-auto max-w-screen-md space-y-4 p-4">
      {/* barra de progreso */}
      <Skeleton className="h-2 w-full rounded-full" />
      {/* KPI "falta cobrar" */}
      <div className="rounded-2xl bg-white p-4 ring-1 ring-zinc-200">
        <Skeleton className="mb-2 h-3 w-24" />
        <Skeleton className="h-8 w-40" />
      </div>
      {/* splits */}
      {Array.from({ length: 3 }).map((_, i) => (
        <Skeleton key={i} className="h-16 w-full rounded-2xl" />
      ))}
    </div>
  );
}

export function MesaRouteSkeleton({ variant }: { variant: MesaRouteVariant }) {
  return (
    <div className="min-h-dvh bg-zinc-100/60">
      <MesaHeaderSkeleton variant={variant} />
      {variant === "pedir" && <PedirBodySkeleton />}
      {variant === "cuenta" && <CuentaBodySkeleton />}
      {variant === "cobrar" && <CobrarBodySkeleton />}
    </div>
  );
}
