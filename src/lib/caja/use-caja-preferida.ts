"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Clave de la caja elegida **en esta máquina**, scopeada por negocio.
 *
 * Es la misma que usa el board de caja (`caja-admin-board.tsx`) a propósito:
 * la máquina del bar y la del salón son puestos físicos distintos, y quien
 * cobra desde el bar quiere registrar en Caja Bar tanto en el board como en
 * el cobro. Una sola preferencia por puesto, no una por pantalla.
 */
export function cajaStorageKey(slug: string): string {
  return `caja_active_${slug}`;
}

function readStored(storageKey: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem(storageKey);
  } catch {
    return null;
  }
}

/**
 * Qué caja mostrar cuando la URL pide una (spec 153).
 *
 * La pedida gana sobre la preferencia guardada: si alguien apretó «Ver ahora»
 * en la Caja Bar desde la sección Caja, quiere ver esa caja. Una que no existe
 * (id viejo, caja de otro negocio, caja pausada) se ignora en vez de dejar la
 * pantalla en blanco.
 *
 * **No la persiste**, y es deliberado: la preferencia por máquina es sobre
 * dónde ese puesto *cobra*, no sobre qué miró una vez. Mirar la caja del bar
 * desde la compu del salón no tiene por qué cambiarle el default de cobro.
 * Elegirla en el selector sí lo hace — eso sigue siendo `elegirCaja`.
 *
 * Es una función pura y **se resuelve en el render, no en un effect**: así no
 * hay un parpadeo mostrando la caja equivocada mientras el effect corre, que
 * en una pantalla de plata es peor que en cualquier otra.
 */
export function resolverCajaActiva(
  pedida: string | null | undefined,
  preferida: string,
  cajas: readonly { id: string }[],
): string {
  if (pedida && cajas.some((c) => c.id === pedida)) return pedida;
  return preferida;
}

/**
 * Caja elegida por máquina, con fallback a la primera de la lista.
 *
 * Devuelve `[cajaId, elegirCaja]`. El estado inicial es sincrónico
 * (`cajas[0]`) para no romper la hidratación; la preferencia guardada se
 * aplica en un effect. Soporta que `cajas` llegue vacío en el primer render
 * y se pueble después (los paneles que cargan con `iniciarCobro()`).
 *
 * Si la caja guardada ya no existe (borrada o desactivada), cae a la primera.
 */
export function useCajaPreferida(
  slug: string,
  cajas: readonly { id: string }[],
): [string, (id: string) => void] {
  const storageKey = cajaStorageKey(slug);
  const [cajaId, setCajaId] = useState<string>(() => cajas[0]?.id ?? "");

  // Firma estable de la lista: evita re-correr el effect cuando el caller
  // pasa un array nuevo con el mismo contenido en cada render.
  const cajaIds = cajas.map((c) => c.id).join(",");

  useEffect(() => {
    if (!cajas.length) return;

    const stored = readStored(storageKey);
    if (stored && cajas.some((c) => c.id === stored)) {
      setCajaId((prev) => (prev === stored ? prev : stored));
      return;
    }
    setCajaId((prev) =>
      cajas.some((c) => c.id === prev) ? prev : cajas[0].id,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey, cajaIds]);

  const elegirCaja = useCallback(
    (id: string) => {
      setCajaId(id);
      try {
        localStorage.setItem(storageKey, id);
      } catch {
        // Modo incógnito o storage lleno: la elección vale para esta sesión.
      }
    },
    [storageKey],
  );

  return [cajaId, elegirCaja];
}
