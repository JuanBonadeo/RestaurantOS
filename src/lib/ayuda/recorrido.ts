import { TEMAS, estaEscrito, type Tema } from "./contenido";

import type { BusinessRole } from "@/lib/admin/context";
import type { ReservationMode } from "@/lib/reservations/types";

// ============================================
// El recorrido de primer ingreso y el progreso de lectura — spec 169 (#255).
//
// La spec 142 (D4) ya manda a la guía al que termina la bienvenida. Lo que
// faltaba es lo otro: un ORDEN por donde entrar, y que el sistema se entere de
// si lo leyó. Esto último no se resuelve con una pared —un gate que no deja
// entrar al panel se saltea igual y encima nos deja creyendo que leyó (D3)—
// sino con un pendiente que no se apaga solo (D4).
//
// Todo acá es función pura sobre TEMAS. Lo leído entra como un Set de slugs,
// que es lo que devuelve `queries.ts` desde `ayuda_lecturas`.
// ============================================

/**
 * A quién le habla un tema cuando no lo dice (D8).
 *
 * Los veinte temas de la spec 134 están escritos para el panel de
 * administración: sus pantallas, sus palabras y sus topes. Ese es el default, y
 * es la verdad de hoy — no un placeholder.
 */
export const ROLES_POR_DEFECTO: BusinessRole[] = ["admin", "encargado"];

export function rolesDe(tema: Tema): BusinessRole[] {
  return tema.roles ?? ROLES_POR_DEFECTO;
}

/**
 * Los temas que le tocan a un rol.
 *
 * Hoy devuelve vacío para `mozo` y `terminal`, y eso es lo correcto aunque
 * parezca un paso atrás: `sections.ts` les abrió la sección Ayuda (spec 142 ·
 * D4) para que la bienvenida los pudiera mandar ahí, pero el contenido nunca
 * fue suyo. Mostrarles la del encargado no es "algo mejor que nada": le imprime
 * a un mozo el tope de descuento y el de diferencia de caja como si fueran los
 * suyos. La guía del salón es su propia spec (D9).
 */
export function temasDeRol(rol: BusinessRole | null): Tema[] {
  if (!rol) return [];
  return TEMAS.filter((tema) => rolesDe(tema).includes(rol));
}

/**
 * El recorrido: el turno completo, en el orden en que el turno pasa.
 *
 * NO son los veinte temas (D2). Nadie lee veinte capítulos el primer día — el
 * que "lee" veinte apretó *siguiente* veinte veces, y eso es peor que no leer
 * porque nos deja con un dato falso. Es el grupo `operacion` y nada más; el
 * resto queda en el índice para cuando aparezca.
 */
export function recorrido(rol: BusinessRole | null, modo: ReservationMode): Tema[] {
  return temasDeRol(rol).filter(
    (tema) => tema.grupo === "operacion" && estaEscrito(tema, modo),
  );
}

export type Progreso = {
  total: number;
  leidos: number;
  pendientes: number;
  completo: boolean;
  /** El primero SIN leer: es donde retoma el que abandonó a la mitad. */
  proximo?: Tema;
};

/**
 * Cuánto del recorrido lleva leído.
 *
 * Dos detalles que no son de estilo:
 *
 *  - Se cuenta contra el recorrido de HOY, no contra las filas de la tabla. Un
 *    tema que se borró o se renombró deja lecturas huérfanas en
 *    `ayuda_lecturas`; si contaran, el recorrido se daría por terminado sin que
 *    nadie lo haya leído.
 *  - Un recorrido vacío está `completo`. Es lo que hace que al mozo —que
 *    todavía no tiene temas— no se le encienda ningún badge ni ningún punto.
 */
export function progresoDelRecorrido(
  rol: BusinessRole | null,
  modo: ReservationMode,
  leidos: ReadonlySet<string>,
): Progreso {
  const temas = recorrido(rol, modo);
  const cuantos = temas.filter((tema) => leidos.has(tema.slug)).length;
  return {
    total: temas.length,
    leidos: cuantos,
    pendientes: temas.length - cuantos,
    completo: cuantos >= temas.length,
    proximo: temas.find((tema) => !leidos.has(tema.slug)),
  };
}

export type Posicion = {
  /** 1-based: lo que se imprime en pantalla es «3 de 9», no «2 de 9». */
  indice: number;
  total: number;
  /** Sin siguiente = es el último, y ahí el botón del pie termina el recorrido. */
  siguiente?: Tema;
};

/** Dónde cae este tema dentro del recorrido, o `null` si no es parte de él. */
export function posicionEnRecorrido(
  slug: string,
  rol: BusinessRole | null,
  modo: ReservationMode,
): Posicion | null {
  const temas = recorrido(rol, modo);
  const i = temas.findIndex((tema) => tema.slug === slug);
  if (i < 0) return null;
  return { indice: i + 1, total: temas.length, siguiente: temas[i + 1] };
}
