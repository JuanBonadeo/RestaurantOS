import { Skeleton } from "@/components/ui/skeleton";

const WIDTHS = {
  narrow: "max-w-4xl",
  default: "max-w-6xl",
  wide: "max-w-[1400px]",
} as const;

/**
 * Skeleton genérico de una página del panel admin (spec 104).
 *
 * Todas las rutas admin son `force-dynamic`, y en App Router el prefetch de un
 * `<Link>` a una ruta dinámica **sólo** trae el `loading.tsx`: sin boundary no
 * hay nada que prefetchear y el click se queda en la pantalla vieja, congelada,
 * hasta que el servidor termina de renderizar. Con esto el tap pinta la
 * estructura al instante — la misma idea que el skeleton de operación (spec 39).
 *
 * Calca el `PageShell` + `PageHeader` que usan casi todas: mismo ancho, mismo
 * padding y un título arriba, así el contenido real no salta cuando llega.
 */
export function PageSkeleton({
  /** Filas de contenido (cards, tabla, lo que sea). */
  rows = 6,
  /** Algunas pantallas abren con una fila de KPIs. */
  kpis = 0,
  /** El mismo que usa el `PageShell` de la página, para que no salte al llegar. */
  width = "default",
}: {
  rows?: number;
  kpis?: number;
  width?: keyof typeof WIDTHS;
}) {
  return (
    <main
      className={`mx-auto w-full ${WIDTHS[width]} space-y-8 px-4 py-10 sm:px-6 lg:px-10`}
    >
      <div className="space-y-2">
        <Skeleton className="h-3 w-24 rounded" />
        <Skeleton className="h-8 w-64 rounded-lg" />
      </div>

      {kpis > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: kpis }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full rounded-2xl" />
          ))}
        </div>
      )}

      <div className="space-y-3">
        {Array.from({ length: rows }).map((_, i) => (
          <Skeleton key={i} className="h-16 w-full rounded-xl" />
        ))}
      </div>
    </main>
  );
}

/**
 * Variante para segmentos que **ya tienen layout propio** con su chrome
 * (`configuracion` monta un `PageShell` + `PageHeader`). Ahí el `loading.tsx`
 * se renderiza DENTRO de ese layout, así que un skeleton con `<main>`,
 * cabecera y padding propios daría `<main>` anidado —HTML inválido, dos
 * landmarks para un lector de pantalla— y un título fantasma debajo del título
 * real. Esto es sólo el cuerpo.
 */
export function SectionSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-16 w-full rounded-xl" />
      ))}
    </div>
  );
}
