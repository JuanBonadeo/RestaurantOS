import Link from "next/link";
import { CircleHelp } from "lucide-react";

/**
 * El "?" al lado del título de una pantalla — spec 134 D7
 * (RestaurantOS-Brain#35).
 *
 * Es lo que hace que la guía exista para el encargado: nadie se acuerda de que
 * hay un ítem "Ayuda" en el menú justo cuando está trabado con el salón lleno.
 * El chip lo lleva al tema de ESTA pantalla, no al índice.
 *
 * 44 px de lado: es el mínimo tocable con el dedo, y el público de esta guía no
 * tiene pulso de francotirador.
 */
export function AyudaChip({ slug, tema }: { slug: string; tema: string }) {
  return (
    <Link
      href={`/${slug}/admin/ayuda/${tema}`}
      aria-label="Cómo se usa esta pantalla"
      title="Cómo se usa esta pantalla"
      className="inline-flex size-11 shrink-0 items-center justify-center rounded-full text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900"
    >
      <CircleHelp className="size-[22px]" strokeWidth={1.75} />
    </Link>
  );
}
