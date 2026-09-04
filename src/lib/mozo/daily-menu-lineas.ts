/**
 * Varios menús del día en una sola pasada del asistente (spec 155).
 *
 * El asistente de la spec 072 resuelve **un** menú: un `DailyMenuSelections` y
 * una cantidad al final, que multiplica. Eso significa que «cantidad 4» son
 * cuatro menús IDÉNTICOS — y en una mesa de cuatro eso casi nunca pasa, así que
 * había que recorrer el asistente entero cuatro veces. La encargada de golf lo
 * dijo corto: *«no me deja poner dos de una»*.
 *
 * Acá el estado pasa a ser **N líneas**, cada una con sus propias elecciones, y
 * el asistente pregunta **por vuelta de mesa**: la bebida de los cuatro, después
 * el principal de los cuatro. Que es como se toma el pedido parado en la mesa.
 *
 * ── El nudo: los pasos no son uniformes ────────────────────────────────────
 *
 * Con grupos condicionales (spec 074) cada línea tiene SU propia lista de
 * pasos: la que eligió Milanesa tiene «Guarnición», la que eligió Ñoquis no.
 * Por eso no se puede «elegir todo por paso y combinar al final»: hay que saber
 * a qué líneas les toca cada paso, y eso sólo se sabe con lo ya elegido.
 *
 * La salida es no inventar nada: se le pregunta a `buildMenuSteps` por CADA
 * línea —la misma función que usa el asistente de a uno— y se agrupan los pasos
 * que resultan iguales. Una línea que no tiene el paso, simplemente no cuenta
 * para el contador.
 *
 * ── La atribución es arbitraria, a propósito ───────────────────────────────
 *
 * Al elegir «Gaseosa» en un paso que espera 4, se le asigna a la primera línea
 * que todavía no eligió. Que la gaseosa caiga en la línea 1 y el vino en la 3
 * **no dice quién pidió qué**: ese dato nadie lo captura. Lo que importa es que
 * el conjunto sea correcto, y tanto la comanda (cada plato a su sector) como el
 * total de la mesa son invariantes ante cómo se reparta.
 */

import {
  buildMenuSteps,
  choicesDeltaCents,
  type DailyMenuSelection,
  type DailyMenuSelections,
  type MenuStep,
} from "./daily-menu-steps";
import type { DailyMenuChoiceGroup } from "./daily-menus-query";

/** Las elecciones de un menú. Una por comensal. */
export type Linea = DailyMenuSelections;

/**
 * Identidad de un paso a través de líneas distintas. Dos líneas comparten paso
 * cuando es *la misma pregunta*:
 *
 *  - `choice` → el grupo del menú («Bebida»), igual para todas.
 *  - `modifiers` → el grupo del combo MÁS el grupo de modificadores, porque
 *    depende del producto elegido: «Salsa» de las que eligieron pasta y
 *    «Guarnición» de las que eligieron milanesa son **preguntas distintas**
 *    aunque las dos cuelguen del paso «Plato principal».
 */
export function claveDePaso(step: MenuStep): string {
  if (step.kind === "choice") return `choice:${step.group.choice_group_id}`;
  if (step.kind === "modifiers")
    return `mods:${step.choiceGroupId}:${step.group.id}`;
  return "confirm";
}

/** Un paso del asistente, con las líneas a las que les toca. */
export type PasoAgrupado = {
  clave: string;
  /** El paso a dibujar. Sale de la primera línea que lo pide. */
  step: MenuStep;
  /** Índices de las líneas que necesitan este paso. */
  lineas: number[];
  /** Cuántas de ésas ya eligieron. */
  resueltas: number;
  /** Cuántas faltan. `0` ⇒ el paso está completo. */
  faltan: number;
};

/** ¿La línea ya resolvió este paso? */
function resuelto(linea: Linea, step: MenuStep): boolean {
  if (step.kind === "choice") return linea.has(step.group.choice_group_id);
  if (step.kind === "modifiers") {
    const sel = linea.get(step.choiceGroupId);
    if (!sel) return false;
    // Resuelto si alguno de los modificadores elegidos pertenece a este grupo.
    const idsDelGrupo = new Set(step.group.modifiers.map((m) => m.id));
    return (sel.modifier_ids ?? []).some((id) => idsDelGrupo.has(id));
  }
  return true;
}

/**
 * Todos los pasos del bloque, en orden, agrupando los que son la misma
 * pregunta. El `confirm` no entra: lo agrega el componente al final.
 *
 * El orden lo define la primera línea que introduce cada paso, que respeta el
 * orden del menú (`activeChoiceGroups`) — así «Bebida» va antes que «Plato
 * principal» aunque la línea 1 esté más avanzada que la 3.
 */
export function pasosDelBloque(
  groups: DailyMenuChoiceGroup[],
  lineas: Linea[],
): PasoAgrupado[] {
  const porClave = new Map<string, PasoAgrupado>();

  for (const [i, linea] of lineas.entries()) {
    for (const step of buildMenuSteps(groups, linea)) {
      if (step.kind === "confirm") continue;
      const clave = claveDePaso(step);
      const previo = porClave.get(clave);
      const yaEsta = resuelto(linea, step);
      if (previo) {
        previo.lineas.push(i);
        if (yaEsta) previo.resueltas += 1;
        previo.faltan = previo.lineas.length - previo.resueltas;
      } else {
        porClave.set(clave, {
          clave,
          step,
          lineas: [i],
          resueltas: yaEsta ? 1 : 0,
          faltan: yaEsta ? 0 : 1,
        });
      }
    }
  }

  return [...porClave.values()];
}

/**
 * El paso donde está parado el asistente: el primero que todavía tiene líneas
 * sin resolver. `null` ⇒ está todo elegido y toca confirmar.
 *
 * Se recalcula entero en cada elección **a propósito**: elegir Milanesa en la
 * línea 2 puede hacer aparecer un paso «Guarnición» que antes no existía, y
 * avanzar con un índice guardado dejaría el asistente apuntando a un paso que
 * cambió de lugar.
 */
export function pasoActual(
  groups: DailyMenuChoiceGroup[],
  lineas: Linea[],
): PasoAgrupado | null {
  return pasosDelBloque(groups, lineas).find((p) => p.faltan > 0) ?? null;
}

/** La primera línea del paso que todavía no eligió. `-1` si están todas. */
export function proximaLineaDe(paso: PasoAgrupado, lineas: Linea[]): number {
  return paso.lineas.find((i) => !resuelto(lineas[i]!, paso.step)) ?? -1;
}

/**
 * Aplica una elección a la primera línea pendiente del paso. Devuelve un array
 * nuevo (las líneas son estado de React) y **no muta** el original.
 *
 * Si el paso ya estaba completo devuelve las líneas tal cual: es el doble tap
 * sobre la misma opción, que no debería agregar un quinto menú.
 */
export function elegirEnPaso(
  lineas: Linea[],
  paso: PasoAgrupado,
  seleccion: DailyMenuSelection,
): Linea[] {
  const i = proximaLineaDe(paso, lineas);
  if (i < 0) return lineas;

  const out = lineas.map((l) => new Map(l) as Linea);
  const linea = out[i]!;

  if (paso.step.kind === "choice") {
    linea.set(seleccion.choice_group_id, seleccion);
    // Cambiar la elección de un grupo invalida los modificadores que colgaban
    // del producto anterior: los trae la propia `seleccion`, que nace limpia.
  } else if (paso.step.kind === "modifiers") {
    const previo = linea.get(paso.step.choiceGroupId);
    if (!previo) return lineas;
    const idsDelGrupo = new Set(paso.step.group.modifiers.map((m) => m.id));
    // Se reemplazan sólo los de ESTE grupo: un plato puede tener dos grupos de
    // modificadores y elegir la salsa no puede borrar el punto de cocción.
    const otros = (previo.modifier_ids ?? []).filter(
      (id) => !idsDelGrupo.has(id),
    );
    const otrosMods = (previo.modifiers ?? []).filter(
      (m) => !idsDelGrupo.has(m.id),
    );
    linea.set(paso.step.choiceGroupId, {
      ...previo,
      modifier_ids: [...otros, ...(seleccion.modifier_ids ?? [])],
      modifiers: [...otrosMods, ...(seleccion.modifiers ?? [])],
    });
  }

  return out;
}

/**
 * Deshace la última elección del paso, para el «volver» sin salir del bloque.
 * Saca la de la última línea que eligió, que es la simétrica de `elegirEnPaso`.
 */
export function deshacerEnPaso(lineas: Linea[], paso: PasoAgrupado): Linea[] {
  const conElección = paso.lineas.filter((i) =>
    resuelto(lineas[i]!, paso.step),
  );
  const i = conElección[conElección.length - 1];
  if (i == null) return lineas;

  const out = lineas.map((l) => new Map(l) as Linea);
  const linea = out[i]!;

  if (paso.step.kind === "choice") {
    linea.delete(paso.step.group.choice_group_id);
  } else if (paso.step.kind === "modifiers") {
    const previo = linea.get(paso.step.choiceGroupId);
    if (!previo) return lineas;
    const idsDelGrupo = new Set(paso.step.group.modifiers.map((m) => m.id));
    linea.set(paso.step.choiceGroupId, {
      ...previo,
      modifier_ids: (previo.modifier_ids ?? []).filter(
        (id) => !idsDelGrupo.has(id),
      ),
      modifiers: (previo.modifiers ?? []).filter((m) => !idsDelGrupo.has(m.id)),
    });
  }

  return out;
}

/** Arranca un bloque de `cantidad` líneas vacías. */
export function lineasVacias(cantidad: number): Linea[] {
  return Array.from(
    { length: Math.max(1, cantidad) },
    () => new Map() as Linea,
  );
}

/**
 * Cambia la cantidad conservando lo ya elegido: agregar suma líneas vacías al
 * final, sacar corta desde el final. Se usa cuando el mozo corrige el número
 * después de haber empezado — no queremos que pierda lo cargado.
 */
export function redimensionar(lineas: Linea[], cantidad: number): Linea[] {
  const n = Math.max(1, cantidad);
  if (n === lineas.length) return lineas;
  if (n < lineas.length) return lineas.slice(0, n);
  return [...lineas, ...lineasVacias(n - lineas.length)];
}

/**
 * Lo que sale el bloque: la suma de las líneas, **no** `precio × cantidad`
 * (spec 155 · D5).
 *
 * Con adicionales por opción (spec 029) y modificadores con precio (spec 083)
 * cada línea puede valer distinto: la que lleva copa de vino suma su delta y la
 * de agua no. Resumirlo como un precio único multiplicado sería mentir sobre
 * plata en la pantalla donde se decide qué se cobra.
 */
export function totalDelBloqueCents(
  precioMenuCents: number,
  lineas: Linea[],
): number {
  return lineas.reduce(
    (total, linea) => total + precioMenuCents + choicesDeltaCents(linea),
    0,
  );
}

/** ¿Las líneas valen todas lo mismo? Define si el resumen muestra desglose. */
export function lineasValenIgual(lineas: Linea[]): boolean {
  if (lineas.length < 2) return true;
  const primero = choicesDeltaCents(lineas[0]!);
  return lineas.every((l) => choicesDeltaCents(l) === primero);
}
