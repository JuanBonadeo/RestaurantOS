"use client";

import { useEffect, useState } from "react";
import { Expand, X } from "lucide-react";

import type { Marca } from "@/lib/ayuda/contenido";

/**
 * La captura de un paso — spec 134 D18.
 *
 * Dos cosas, y las dos son por lo mismo: una captura de una pantalla de 1160 px
 * metida en una columna de 68 caracteres se ve a menos de la mitad, y a ese
 * tamaño no se lee ni un rótulo.
 *
 *  1. **Rompe la columna.** El texto se queda en 68ch —eso no se negocia, es
 *     D6— pero la imagen se sale hacia los costados hasta donde da el ancho de
 *     la página. En mobile usa el padding de la página, así que queda casi a
 *     ancho completo.
 *  2. **Se abre a pantalla completa** al tocarla. Es lo que permite mirar un
 *     número o un cartel de verdad, que es justamente para lo que está.
 *
 * Los círculos numerados son porcentajes del ancho y del alto, así que siguen
 * cayendo donde tienen que caer en los dos tamaños sin recalcular nada.
 */
export function Captura({
  src,
  alt,
  marcas = [],
}: {
  src: string;
  alt: string;
  marcas?: Marca[];
}) {
  const [abierta, setAbierta] = useState(false);

  // Esc para cerrar, y se bloquea el scroll del fondo mientras está abierta:
  // si no, mover la imagen con el dedo scrollea la guía por atrás.
  useEffect(() => {
    if (!abierta) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setAbierta(false);
    };
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = overflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [abierta]);

  const circulos = marcas.map((m) => (
    <span
      key={m.n}
      aria-hidden
      style={{
        left: `${m.x}%`,
        top: `${m.y}%`,
        background: "var(--brand)",
        color: "var(--brand-foreground)",
      }}
      className="absolute grid size-7 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full text-[15px] font-bold shadow-md ring-2 ring-white"
    >
      {m.n}
    </span>
  ));

  return (
    <>
      {/* En desktop no hace falta ningún truco: la captura ya ocupa el ancho de
          la página, porque el límite de 68 caracteres se le pone al texto y no
          al contenedor (D20). Se topa en 1160 px, el ancho nativo con el que se
          sacan — estirarla más sería agrandar píxeles.

          En mobile sí: ahí el círculo del número se come 60 px de los 375, así
          que la imagen se corre a la izquierda para arrancar en el borde del
          texto de arriba. Se mantiene el padding derecho de la página, así que
          no genera scroll horizontal. */}
      <figure className="mt-6 -ml-[60px] max-w-[1160px] sm:ml-0">
        <button
          type="button"
          onClick={() => setAbierta(true)}
          aria-label={`Ampliar: ${alt}`}
          className="group relative block w-full cursor-zoom-in overflow-hidden rounded-xl ring-1 ring-zinc-200 transition hover:ring-zinc-300"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={src} alt={alt} className="w-full" />
          {circulos}
          <span className="pointer-events-none absolute bottom-2 right-2 inline-flex items-center gap-1.5 rounded-lg bg-zinc-900/80 px-2.5 py-1.5 text-[13px] font-medium text-white opacity-0 transition group-hover:opacity-100">
            <Expand className="size-4" strokeWidth={2} />
            Ampliar
          </span>
        </button>
      </figure>

      {abierta && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={alt}
          onClick={() => setAbierta(false)}
          className="fixed inset-0 z-[100] flex items-center justify-center bg-zinc-950/90 p-4 sm:p-8"
        >
          <button
            type="button"
            aria-label="Cerrar"
            onClick={() => setAbierta(false)}
            className="absolute right-4 top-4 grid size-12 place-items-center rounded-full bg-white/10 text-white transition hover:bg-white/20"
          >
            <X className="size-6" strokeWidth={2} />
          </button>
          {/* `onClick` en el contenedor cierra; acá se frena para que tocar la
              propia imagen (mirarla, hacer zoom con los dedos) no la cierre. */}
          <div
            onClick={(e) => e.stopPropagation()}
            className="relative max-h-full w-full max-w-[1160px] overflow-auto"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={src} alt={alt} className="w-full rounded-lg" />
            {circulos}
          </div>
        </div>
      )}
    </>
  );
}
