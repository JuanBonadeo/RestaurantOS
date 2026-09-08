"use client";

import {
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactElement,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, X } from "lucide-react";

export type PaginaImagen = {
  id: string;
  url: string;
  /** Lo que se lee arriba mientras está abierta: «Página 2 de 3», el alt, etc. */
  etiqueta: string;
  /**
   * Se pinta ENCIMA de la imagen ampliada, en un contenedor `relative` del
   * tamaño de la imagen. Existe por los círculos numerados de la guía de ayuda:
   * ampliar la captura y perder los números es ampliar lo que menos importa.
   */
  overlay?: ReactNode;
};

/**
 * Ver una foto en grande — spec 173.
 *
 * Salió de `ayuda/captura.tsx`, donde ya estaba resuelto y probado (Esc, bloqueo
 * del scroll del fondo, cierre al clickear afuera, `stopPropagation` sobre la
 * imagen para poder pasearla con los dedos). Acá se le agregó lo que pedía la
 * carga de compras: varias páginas y ←/→ para pasar de una a otra.
 *
 * **El Esc no puede burbujear.** Esta pantalla vive adentro de la carga de una
 * compra: fotos subidas, renglones revisados a mano, importes tipeados. Si el
 * Esc que cierra el lightbox llega al diálogo/pantalla de atrás, se cierra
 * TODO y se pierde el trabajo — el usuario apretó Esc para salir de una foto,
 * no para tirar la carga. Por eso el listener va en `document` en fase de
 * CAPTURA y corta ahí mismo: `stopPropagation` solo no alcanza porque los
 * dismissables de Radix/base-ui escuchan en `document` en burbujeo, y
 * `stopImmediatePropagation` frena además a cualquier otro que escuche en
 * captura.
 *
 * El portal a `document.body` no es cosmético: el shell del admin ya demostró
 * que un `z-index` alto adentro de un contenedor con stacking context propio no
 * sirve de nada (la campana de notificaciones tapando la X de «Cargar pedido»).
 */
export function ImagenAmpliable({
  paginas,
  indice,
  onIndice,
  children,
}: {
  paginas: PaginaImagen[];
  indice: number;
  onIndice: (i: number) => void;
  /** El disparador. Si es un elemento, se le engancha el `onClick`. */
  children: ReactNode;
}): ReactElement {
  const [abierta, setAbierta] = useState(false);
  // `createPortal` necesita `document`: en el render del servidor no existe.
  const [montado, setMontado] = useState(false);
  useEffect(() => setMontado(true), []);

  const total = paginas.length;
  const i = Math.min(Math.max(indice, 0), Math.max(total - 1, 0));
  const actual = paginas[i];

  const abrir = useCallback(() => {
    if (total > 0) setAbierta(true);
  }, [total]);

  // El bloqueo del scroll va SOLO — separado del teclado a propósito. Si los dos
  // vivieran en el mismo effect, con un `onIndice` inline (el caso normal) el
  // effect se re-corre en cada render, guarda "hidden" como valor previo y al
  // cerrar deja el body trabado para siempre.
  useEffect(() => {
    if (!abierta) return;
    const previo = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previo;
    };
  }, [abierta]);

  useEffect(() => {
    if (!abierta) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        setAbierta(false);
        return;
      }
      if (e.key === "ArrowLeft" && i > 0) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        onIndice(i - 1);
        return;
      }
      if (e.key === "ArrowRight" && i < total - 1) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        onIndice(i + 1);
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [abierta, i, total, onIndice]);

  // El disparador se clona para no envolverlo en otro `<button>`: la captura de
  // la ayuda YA es un botón y anidar botones es HTML inválido (y el click
  // interno deja de llegar).
  const disparador = isValidElement(children) ? (
    cloneElement(children as ReactElement<{ onClick?: (e: ReactMouseEvent) => void }>, {
      onClick: (e: ReactMouseEvent) => {
        (children as ReactElement<{ onClick?: (e: ReactMouseEvent) => void }>).props.onClick?.(e);
        abrir();
      },
    })
  ) : (
    <button type="button" onClick={abrir} className="cursor-zoom-in">
      {children}
    </button>
  );

  return (
    <>
      {disparador}
      {abierta &&
        montado &&
        actual &&
        createPortal(
          <div
            role="dialog"
            aria-modal="true"
            aria-label={actual.etiqueta}
            onClick={() => setAbierta(false)}
            className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-zinc-950/90 p-4 sm:p-8"
          >
            <div className="pointer-events-none absolute left-0 right-0 top-4 flex items-center justify-center px-16">
              <span className="pointer-events-auto rounded-full bg-white/10 px-3 py-1.5 text-[13px] font-medium text-white">
                {actual.etiqueta}
              </span>
            </div>

            <button
              type="button"
              aria-label="Cerrar"
              onClick={() => setAbierta(false)}
              className="absolute right-4 top-4 grid size-12 place-items-center rounded-full bg-white/10 text-white transition hover:bg-white/20"
            >
              <X className="size-6" strokeWidth={2} />
            </button>

            {total > 1 && (
              <>
                <button
                  type="button"
                  aria-label="Página anterior"
                  disabled={i === 0}
                  onClick={(e) => {
                    e.stopPropagation();
                    onIndice(i - 1);
                  }}
                  className="absolute left-2 top-1/2 grid size-12 -translate-y-1/2 place-items-center rounded-full bg-white/10 text-white transition hover:bg-white/20 disabled:opacity-25"
                >
                  <ChevronLeft className="size-7" strokeWidth={2} />
                </button>
                <button
                  type="button"
                  aria-label="Página siguiente"
                  disabled={i === total - 1}
                  onClick={(e) => {
                    e.stopPropagation();
                    onIndice(i + 1);
                  }}
                  className="absolute right-2 top-1/2 grid size-12 -translate-y-1/2 place-items-center rounded-full bg-white/10 text-white transition hover:bg-white/20 disabled:opacity-25"
                >
                  <ChevronRight className="size-7" strokeWidth={2} />
                </button>
              </>
            )}

            {/* El click del contenedor cierra; acá se frena para que tocar la
                propia imagen —mirarla, hacer zoom con los dedos— no la cierre.
                `overflow-auto` es lo que deja pasear un ticket largo: a ancho
                completo no entra en la pantalla ni de casualidad. */}
            <div
              onClick={(e) => e.stopPropagation()}
              className="relative max-h-full w-full max-w-[1160px] overflow-auto"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={actual.url} alt={actual.etiqueta} className="w-full rounded-lg" />
              {actual.overlay}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
