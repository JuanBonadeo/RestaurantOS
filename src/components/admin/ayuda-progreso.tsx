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
const Contexto = createContext<ReadonlySet<string>>(new Set());

export function AyudaProgresoProvider({
  pendientes,
  children,
}: {
  pendientes: string[];
  children: React.ReactNode;
}) {
  const set = useMemo(() => new Set(pendientes), [pendientes]);
  return <Contexto.Provider value={set}>{children}</Contexto.Provider>;
}

/**
 * `true` si este tema es parte del recorrido y todavía no lo leyó.
 *
 * Fuera del layout del panel devuelve `false`, que es lo correcto: sin
 * provider no hay recorrido del cual estar atrasado.
 */
export function useAyudaPendiente(tema: string): boolean {
  return useContext(Contexto).has(tema);
}
