"use client";

import Link from "next/link";
import { CircleHelp } from "lucide-react";

import { useAyudaPendiente } from "@/components/admin/ayuda-progreso";

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
 *
 * Spec 169 · D4 — si el tema de esta pantalla está en el recorrido y todavía no
 * lo leyó, el chip lleva un punto. Es todo lo que queda de "hacerlo leer": no
 * hay modal, no hay tour con flechitas y no hay nada que cerrar. El punto se
 * apaga cuando termina el recorrido y no vuelve nunca más.
 */
export function AyudaChip({ slug, tema }: { slug: string; tema: string }) {
  const pendiente = useAyudaPendiente(tema);
  return (
    <Link
      href={`/${slug}/admin/ayuda/${tema}`}
      aria-label={
        pendiente
          ? "Cómo se usa esta pantalla — todavía no lo leíste"
          : "Cómo se usa esta pantalla"
      }
      title="Cómo se usa esta pantalla"
      className="relative inline-flex size-11 shrink-0 items-center justify-center rounded-full text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900"
    >
      <CircleHelp className="size-[22px]" strokeWidth={1.75} />
      {pendiente && (
        <span
          aria-hidden
          className="absolute right-1.5 top-1.5 size-2.5 rounded-full ring-2 ring-white"
          style={{ background: "var(--brand)" }}
        />
      )}
    </Link>
  );
}
