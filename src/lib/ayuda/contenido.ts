import {
  Wallet,
  LayoutGrid,
  Receipt,
  Truck,
  CalendarDays,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";

import type { ReservationMode } from "@/lib/reservations/types";

// ============================================
// Contenido de la guía del encargado — spec 134 (RestaurantOS-Brain#35).
//
// Es un DATO TIPADO, no MDX: el repo no tiene MDX y no se agrega una
// dependencia para esto (D8). El renderer vive en
// `app/[business_slug]/admin/(authed)/ayuda/`.
//
// TRES REGLAS AL EDITAR ESTE ARCHIVO:
//
// 1. Las frases entre comillas son LITERALES de la pantalla (D4). El encargado
//    tiene que poder buscar acá lo que está leyendo allá. Si cambiás un cartel
//    en el panel, cambialo también acá — si no, la guía miente, y miente justo
//    en el momento en que alguien la abrió porque no entendía algo.
// 2. Nada de vocabulario nuestro (D5). No existen "kanban", "estado",
//    "payload", "tab", "server action", "RLS" ni "spec". Existen la comanda, la
//    comandera, el arqueo, la rendición, fichar, la cuenta y la mesa.
// 3. Los números que salen de `can.ts` (el 25 % de descuento, los $5.000 de
//    diferencia de caja) se escriben UNA vez, acá abajo, importados de ahí. No
//    se tipean a mano en el texto de un paso: el día que el cliente devuelva la
//    matriz firmada con otros topes, tiene que haber un solo lugar que tocar.
// ============================================

/** 'ojo' = tenelo en cuenta · 'peligro' = si lo hacés mal, se cobra dos veces,
 *  se acepta una caja que no cierra, o se anula algo sin registro.
 *  Dos tonos a propósito: con tres ya no se distinguen, y si todo es urgente
 *  nada lo es. */
export type Aviso = { tono: "ojo" | "peligro"; texto: string };

/**
 * Un círculo numerado sobre un punto de la captura. `x`/`y` son PORCENTAJES
 * del ancho y del alto de la imagen, no píxeles: así el número sigue cayendo
 * donde tiene que caer cuando la captura se escala en un celular de 375 px.
 *
 * La anotación va como DATO y no quemada adentro del PNG. Dos razones: la
 * explicación tiene que vivir en el texto del paso —adentro de la imagen no se
 * lee a 375 px— y volver a sacar una captura cuando cambie la pantalla no
 * puede obligar a rehacerla en un editor de imágenes.
 */
export type Marca = { n: number; x: number; y: number };

/** Adónde seguir cuando un paso se apoya en otro tema. Es un link y no prosa
 *  ("está explicado en el tema Cobrar"): mandar a alguien de vuelta al índice a
 *  buscarlo a mano es la fricción que hace que se abandone la guía y no la duda. */
export type VerTambien = { tema: string; texto: string };

export type Paso = {
  titulo: string;
  texto: string;
  verTambien?: VerTambien;
  /** Ruta bajo /public, ej. '/ayuda/caja-cierre.png'. */
  imagen?: string;
  /** Obligatorio si hay imagen. */
  alt?: string;
  marcas?: Marca[];
  aviso?: Aviso;
};

/**
 * 'pasos'    → una secuencia: primero esto, después aquello. Va numerada.
 * 'catalogo' → una lista para BUSCAR en ella. NO se numera: el encargado que
 *              tiene un cartel en la pantalla no lee del 1 al 12, escanea los
 *              títulos hasta encontrar el suyo, y los números le dirían que hay
 *              un orden que en realidad no existe.
 */
export type TipoTema = "pasos" | "catalogo";

export type Tema = {
  slug: string;
  titulo: string;
  resumen: string;
  icono: LucideIcon;
  /** Default 'pasos'. */
  tipo?: TipoTema;
  pasos: Paso[];
  /**
   * D12 — sólo lo usa `reservas`. El modo es por negocio (`estricto` /
   * `flexible`) y cambia tanto lo que el encargado ve que un texto común no
   * serviría: en estricto elige un horario de una grilla fija, en flexible
   * escribe la hora en un libro. Se muestra SÓLO el modo del negocio en el que
   * está parado — nunca los dos con un "si tu local usa…", que obliga a
   * alguien apurado a decidir cuál de las dos mitades le toca.
   */
  pasosPorModo?: Record<ReservationMode, Paso[]>;
};

/** Los pasos que le tocan a este negocio. */
export function pasosDe(tema: Tema, modo: ReservationMode): Paso[] {
  return tema.pasosPorModo?.[modo] ?? tema.pasos;
}

// ─── Los temas ──────────────────────────────────────────────────────────────
//
// Seis, en el orden del TURNO y no en el de la barra del operativo: se abre la
// caja, se trabaja el salón, se cobra, y en el medio entran los pedidos de la
// web y las reservas. `carteles` va último porque no se lee de corrido: se
// busca cuando ya apareció uno.
//
// Los pasos se escriben en la task 2 (issue #35). Un tema sin pasos se muestra
// en el índice como "En preparación" y no se abre: la estructura se puede
// mergear vacía sin prometer nada que no esté (RNF-2).

export const TEMAS: Tema[] = [
  {
    slug: "caja",
    titulo: "Abrir la caja, los movimientos y el cierre",
    resumen:
      "Con cuánto arranca el turno, cómo se anota lo que entra y sale, y qué hacer cuando el conteo no da.",
    icono: Wallet,
    pasos: [],
  },
  {
    slug: "mesas",
    titulo: "El salón: abrir, cerrar, anular y pasar de mesa",
    resumen:
      "Todo lo que se hace con una mesa desde el mostrador, incluido lo que el mozo no puede hacer solo.",
    icono: LayoutGrid,
    pasos: [],
  },
  {
    slug: "cobrar",
    titulo: "Cobrar una cuenta: propina, descuento y anular un cobro",
    resumen:
      "Cómo se cobra, hasta cuánto descuento podés hacer vos, y cómo se deshace un cobro mal hecho.",
    icono: Receipt,
    pasos: [],
  },
  {
    slug: "pedidos",
    titulo: "Los pedidos que entran por la web",
    resumen:
      "Los que llegan solos: aceptarlos, corregirlos, cobrarlos y avisar para cuándo están.",
    icono: Truck,
    pasos: [],
  },
  {
    slug: "reservas",
    titulo: "Tomar, confirmar y rechazar una reserva",
    resumen:
      "El libro del día, las que pide el cliente por la web y qué hacer cuando no hay lugar.",
    icono: CalendarDays,
    pasos: [],
    // D12: se completa por modo en la task 2. Mientras los dos estén vacíos,
    // `pasosDe` cae en `pasos` y el tema figura "En preparación" igual.
    pasosPorModo: { estricto: [], flexible: [] },
  },
  {
    slug: "carteles",
    titulo: "Me apareció un cartel: qué significa cada uno",
    resumen:
      "La lista de los avisos que puede tirar el panel, con lo que hay que hacer en cada caso.",
    icono: TriangleAlert,
    tipo: "catalogo",
    pasos: [],
  },
];

// ─── Helpers ────────────────────────────────────────────────────────────────

export function temaPorSlug(slug: string): Tema | undefined {
  return TEMAS.find((t) => t.slug === slug);
}

/** ¿Tiene contenido escrito para este negocio? Ver RNF-2. */
export function estaEscrito(tema: Tema, modo: ReservationMode): boolean {
  return pasosDe(tema, modo).length > 0;
}

/** El próximo tema ESCRITO, para el link del pie. Saltea los que están vacíos:
 *  mandar a alguien a una página que dice "en preparación" es peor que no
 *  ofrecerle nada. */
export function temaSiguiente(
  slug: string,
  modo: ReservationMode,
): Tema | undefined {
  const i = TEMAS.findIndex((t) => t.slug === slug);
  return i >= 0 ? TEMAS.slice(i + 1).find((t) => estaEscrito(t, modo)) : undefined;
}
