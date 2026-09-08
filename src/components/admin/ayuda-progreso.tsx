"use client";

import { createContext, useContext, useMemo } from "react";

/**
 * Qué temas del recorrido le faltan a esta persona — spec 169 · D4.
 *
 * Existe por el punto del chip `?`. El chip vive en diez pantallas, la mitad de
 * ellas componentes cliente, y ninguna sabe —ni tiene por qué saber— qué leyó el
 * que está mirando. Sin esto habría que enhebrar el dato por diez sitios de
 * llamada; con esto, el layout hace UNA consulta y el chip la lee donde esté.
 *
 * Lleva sólo lo pendiente y no todo el progreso: es lo único que se usa acá, y
 * la lista viaja al cliente en cada navegación del panel.
 */
type Estado = {
  pendientes: ReadonlySet<string>;
  /**
   * Slug de la pantalla → slug del tema de ESTE rol (spec 170 · D5). El chip
   * pasa siempre el de la tab; la terminal tiene el suyo. Vacío para el
   * encargado, que es dueño de los slugs originales.
   */
  equivalencias: Record<string, string>;
};

const VACIO: Estado = { pendientes: new Set(), equivalencias: {} };
const Contexto = createContext<Estado>(VACIO);

export function AyudaProgresoProvider({
  pendientes,
  equivalencias,
  children,
}: {
  pendientes: string[];
  equivalencias: Record<string, string>;
  children: React.ReactNode;
}) {
  const valor = useMemo(
    () => ({ pendientes: new Set(pendientes), equivalencias }),
    [pendientes, equivalencias],
  );
  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>;
}

/**
 * Qué tema abre el chip de esta pantalla, y si está pendiente.
 *
 * Fuera del layout del panel devuelve el slug tal cual y `false`: sin provider
 * no hay rol del cual traducir ni recorrido del cual estar atrasado.
 */
export function useAyudaTema(pantalla: string): {
  tema: string;
  pendiente: boolean;
} {
  const { pendientes, equivalencias } = useContext(Contexto);
  const tema = equivalencias[pantalla] ?? pantalla;
  return { tema, pendiente: pendientes.has(tema) };
}
