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
