/**
 * Cómo se resume un menú del día en la carta del QR (spec 112).
 *
 * La carta no es el asistente del mozo: el comensal mira, decide y le pide al
 * mozo. Listar las opciones una por una no lo ayuda — el «Menú» de golf-jcr
 * tiene 57 componentes, y la carta los imprimía todos, tapando media página con
 * la lista de guarniciones. Lo que el comensal necesita saber es qué **pasos**
 * trae el menú (bebida + entrada + principal + guarnición + postre) y a qué
 * precio; qué milanesa hay se pregunta en la mesa.
 *
 * Las dos funciones de acá son puras y presentacionales: arman el texto, no
 * deciden qué se ofrece. Qué menú entra hoy sigue siendo `menuDisponibleHoy`.
 */

import type { MenuDailyMenuChoiceGroup, MenuDailyMenuComponent } from "@/lib/menu";

/**
 * Los pasos del menú, en el orden en que se comen.
 *
 * Un grupo de opciones aparece **una vez**, con el nombre del grupo, en la
 * posición de su primera opción — así aguanta el dato viejo donde las opciones
 * de un grupo no quedaron contiguas (la contigüidad la garantiza el editor de
 * hoy, no la migración de MaxiRest). Un componente suelto (texto o producto) se
 * muestra tal cual: en un menú sin grupos, esos componentes **son** los pasos.
 *
 * El nombre del grupo sale de `choice_groups` (spec 087) y no del componente:
 * el catálogo público ni siquiera trae `choice_group_label`, así que leerlo de
 * ahí dejaría la carta listando grupos sin nombre.
 */
export function pasosDelMenu(menu: {
  components: MenuDailyMenuComponent[];
  choice_groups: MenuDailyMenuChoiceGroup[];
}): string[] {
  const nombrePorGrupo = new Map(
    menu.choice_groups.map((g) => [g.choice_group_id, g.label] as const),
  );

  const pasos: string[] = [];
  const vistos = new Set<string>();

  for (const c of [...menu.components].sort((a, b) => a.sort_order - b.sort_order)) {
    if (c.kind === "choice" && c.choice_group_id) {
      if (vistos.has(c.choice_group_id)) continue;
      vistos.add(c.choice_group_id);
      const nombre = (
        nombrePorGrupo.get(c.choice_group_id) ??
        c.choice_group_label ??
        ""
      ).trim();
      if (nombre) pasos.push(nombre);
      continue;
    }
    const nombre = (c.label ?? "").trim() || (c.product_name ?? "").trim();
    if (nombre) pasos.push(nombre);
  }

  return pasos;
}

/** Lunes primero: la semana del restaurante no arranca el domingo. */
const SEMANA = [1, 2, 3, 4, 5, 6, 0];

const SINGULAR = [
  "domingo",
  "lunes",
  "martes",
  "miércoles",
  "jueves",
  "viernes",
  "sábado",
];

const PLURAL = [
  "domingos",
  "lunes",
  "martes",
  "miércoles",
  "jueves",
  "viernes",
  "sábados",
];

/**
 * Cuándo se ofrece el menú, en castellano y en una línea: es lo que la carta
 * pone donde iría la descripción.
 *
 * Tres formas, de más corta a más precisa: «Todos los días», el rango corrido
 * («De lunes a viernes») y la enumeración («Los lunes, miércoles y viernes»).
 * El rango pide **tres o más** días seguidos porque con dos queda peor de lo
 * que resuelve: el fin de semana se lee «Los sábados y domingos», no «De sábado
 * a domingo».
 *
 * Sin días configurados devuelve string vacío y la carta no dibuja la línea:
 * la columna arranca en `'{}'` (spec 109) y afirmar una disponibilidad que no
 * existe es peor que no decir nada.
 */
export function disponibilidadTexto(days: number[] | null | undefined): string {
  const dias = SEMANA.filter((dow) => (days ?? []).includes(dow));
  if (dias.length === 0) return "";
  if (dias.length === SEMANA.length) return "Todos los días";

  const desde = SEMANA.indexOf(dias[0]);
  const corrido = dias.every((dow, i) => SEMANA.indexOf(dow) === desde + i);
  if (corrido && dias.length >= 3) {
    return `De ${SINGULAR[dias[0]]} a ${SINGULAR[dias[dias.length - 1]]}`;
  }

  const nombres = dias.map((dow) => PLURAL[dow]);
  const ultimo = nombres.pop() as string;
  return nombres.length === 0
    ? `Los ${ultimo}`
    : `Los ${nombres.join(", ")} y ${ultimo}`;
}
