"use client";

import { useEffect, useState, type ReactNode, type RefObject } from "react";

import { cn } from "@/lib/utils";

/**
 * Spec 115 — el shell de las dos pantallas donde el personal carga un pedido:
 * el panel del salón (`pedir-client.tsx`) y la hoja de pedidos online
 * (`cargar-pedido-sheet.tsx`).
 *
 * Las piezas de adentro ya eran las mismas (`ProductSearchInput`,
 * `ProductResultsList`, `ProductModal`, `useCartZone`); lo que divergía era el
 * layout. La 111 rediseñó el salón y la hoja quedó a mitad de camino: mismo
 * dibujo, otro breakpoint, y el selector de categoría todavía puesto. Con el
 * shell acá las dos cambian juntas o no cambian.
 *
 * La forma es siempre la misma: **contexto a la izquierda, carga a la derecha**.
 * A la izquierda va lo que el pedido ya tiene (la mesa en el salón; el cliente,
 * la entrega y el carrito en la hoja); a la derecha, el camino feliz —buscar y
 * agregar— que se queda con el ancho que sobra.
 */

/** El ancho de panel a partir del cual entran las dos columnas: `@2xl` de Tailwind. */
export const ANCHO_DOS_COLUMNAS = 672;

/**
 * ¿El panel es lo bastante ancho para las dos columnas?
 *
 * Mide el **contenedor**, no la ventana, contra el mismo umbral que usa la CSS
 * (`@2xl`). Antes la hoja duplicaba el breakpoint en JS con un `matchMedia` de
 * viewport (`useSheetAncho`), que es otra medida: una hoja de 448 px dentro de
 * una pantalla de 1400 px daba «ancho» en JS y una sola columna en pantalla, y
 * ⌘Enter confirmaba un pedido con la mitad del formulario fuera de la vista.
 *
 * Arranca en `false`: hasta la primera medición no hay dos columnas a la vista,
 * así que el atajo hace el camino largo (el de dos pasos), que nunca confirma
 * de más.
 */
export function useAnchoDePanel(ref: RefObject<HTMLElement | null>): boolean {
  const [ancho, setAncho] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // jsdom y navegadores viejos no lo tienen; sin observer nos quedamos en el
    // camino largo, que es el seguro.
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([entrada]) => {
      setAncho(entrada.contentRect.width >= ANCHO_DOS_COLUMNAS);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);

  return ancho;
}

/**
 * El cuerpo de dos columnas.
 *
 * `relative` porque la columna lateral se abre encima cuando el panel es
 * angosto, y porque los modales de carga se scopean acá adentro.
 */
export function PanelDeCarga({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "relative flex min-h-0 flex-1 flex-col @2xl:flex-row",
        className,
      )}
    >
      {children}
    </div>
  );
}

/**
 * La columna de contexto (izquierda).
 *
 * Ancha: al lado de la carga, con ancho propio —el detalle por ítem no entra en
 * una columna angosta— pero nunca más que la de carga.
 * Angosta: no hay lugar para las dos, así que se abre **encima** de la carga
 * (tapándola a propósito) o no se ve. Quién la abre es el padre: en el salón la
 * pastilla «La mesa», en la hoja el paso «datos».
 */
export function ColumnaLateral({
  abierta,
  children,
  className,
}: {
  abierta: boolean;
  children: ReactNode;
  className?: string;
}) {
  const anchoDeColumna = "@2xl:w-[46%] @2xl:max-w-[520px] @2xl:shrink-0";
  return (
    <div
      className={cn(
        "flex min-h-0 flex-col",
        abierta
          ? `absolute inset-0 z-10 bg-zinc-50 @2xl:static @2xl:z-auto ${anchoDeColumna}`
          : `hidden @2xl:flex ${anchoDeColumna}`,
        className,
      )}
    >
      {children}
    </div>
  );
}

/**
 * La columna de carga (derecha): buscador fijo arriba, catálogo con scroll en el
 * medio, y un pie opcional.
 *
 * El `onKeyDown` de la zona de resultados es el mismo contrato en las dos
 * pantallas (spec 073): las flechas las maneja el roving del catálogo, y
 * cualquier tecla imprimible vuelve al buscador en vez de perderse — escribir
 * siempre busca, estés donde estés.
 *
 * `pie` es todo lo que va después del scroll: una franja fija, o los modales
 * que tienen que quedar scopeados a esta columna (elegir modificadores tapa la
 * carga, nunca el contexto de la izquierda).
 */
export function ColumnaDeCarga({
  encabezado,
  onKeyDownResultados,
  children,
  pie,
  className,
}: {
  encabezado: ReactNode;
  onKeyDownResultados: React.KeyboardEventHandler<HTMLDivElement>;
  children: ReactNode;
  pie?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("relative flex min-h-0 flex-1 flex-col", className)}>
      <div className="shrink-0 space-y-2 border-b border-zinc-200 bg-white px-3 py-2.5">
        {encabezado}
      </div>
      <div
        onKeyDown={onKeyDownResultados}
        className="min-h-0 flex-1 overflow-y-auto px-3 py-3"
      >
        {children}
      </div>
      {pie}
    </div>
  );
}
