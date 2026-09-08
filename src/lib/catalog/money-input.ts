/**
 * Lectura de un importe en pesos tipeado a mano (P14 · hallazgo 3).
 *
 * Por qué existe: los campos de plata del catálogo parseaban con
 * `parseInt(e.target.value)`, que corta en el primer separador. El dueño
 * escribía «18.500» —así se escribe dieciocho mil quinientos acá— y el asado
 * quedaba en $18: `parseInt("18.500") === 18`, después `Math.round(18*100)` y
 * a la carta. Nada abajo lo frenaba (el zod pedía un entero ≥ 0 y 18 lo es, y
 * la columna es `bigint` sin CHECK), así que el error viajaba entero hasta la
 * mesa: el mozo ve $18 y cobra $18, para él el sistema no falló.
 *
 * El criterio, escrito una sola vez para que no se vuelva a decidir en cada
 * `onChange`:
 *
 * - Un separador con TRES dígitos detrás es de miles («18.500», «18,500»): un
 *   precio con tres decimales no existe, y el que teclea en un layout inglés
 *   escribe la coma igual.
 * - Con uno o dos dígitos detrás es de centavos («12,75», «12.5»).
 * - Con los dos separadores presentes manda el último («18.500,50» y
 *   «18,500.50» son lo mismo).
 * - Lo ambiguo se rechaza en vez de adivinarse: tres decimales, grupos de miles
 *   mal armados, letras. Y el campo vacío NO vale $0 — ése era el error
 *   simétrico del truncado, igual de silencioso.
 *
 * Lo que se pierde: ya no se puede tipear un precio con más de dos decimales
 * (no era plata) ni pegar un número con separadores raros (espacio fino de
 * miles, apóstrofo suizo). Se planta y avisa, que es lo que pide el hallazgo.
 */

/**
 * Techo de un precio de carta: $10.000.000. No es una regla de negocio, es un
 * guardarraíl contra el cero de más — el error simétrico del truncado, que
 * hasta ahora también pasaba derecho porque el zod no tenía máximo.
 */
export const MAX_PRICE_CENTS = 1_000_000_000;

export type ParsedPesos =
  | { ok: true; cents: number; pesos: number }
  | { ok: false; error: string };

const AMBIGUO = "Precio inválido. Escribilo como 18.500 o 18.500,50.";

export function parsePesos(raw: string): ParsedPesos {
  // El `$` y los espacios (incluido el no-rompible que llega al pegar) son
  // ruido de copiar y pegar, no información.
  const limpio = raw.replace(/[\s $]/g, "");
  if (limpio === "") return { ok: false, error: "Ingresá un precio." };
  if (!/^[\d.,]+$/.test(limpio)) return { ok: false, error: AMBIGUO };

  // Separador colgando: estado de tránsito mientras se tipea «18.500». Se lee
  // como el entero que ya está escrito en vez de pintar el campo de rojo — pero
  // tampoco se le inventa el grupo que todavía no escribió.
  const cuerpo = limpio.replace(/[.,]+$/, "");
  if (cuerpo === "") return { ok: false, error: AMBIGUO };

  const ultimoPunto = cuerpo.lastIndexOf(".");
  const ultimaComa = cuerpo.lastIndexOf(",");

  let decimalIdx = -1;
  if (ultimoPunto >= 0 && ultimaComa >= 0) {
    // Los dos presentes: el último es el decimal, el otro es de miles.
    decimalIdx = Math.max(ultimoPunto, ultimaComa);
  } else {
    const idx = Math.max(ultimoPunto, ultimaComa);
    if (idx >= 0) {
      const detras = cuerpo.length - idx - 1;
      const unicoSeparador = cuerpo.indexOf(cuerpo[idx]!) === idx; // no hay otro igual antes
      if (detras <= 2 && unicoSeparador) decimalIdx = idx;
      else if (detras !== 3) return { ok: false, error: AMBIGUO };
    }
  }

  const entera = decimalIdx >= 0 ? cuerpo.slice(0, decimalIdx) : cuerpo;
  const decimal = decimalIdx >= 0 ? cuerpo.slice(decimalIdx + 1) : "";

  if (decimal !== "" && !/^\d{1,2}$/.test(decimal)) {
    return { ok: false, error: AMBIGUO };
  }

  // La parte entera puede venir agrupada de a tres. Cualquier grupo que no
  // cierre («1.23.456») es un tipeo que no se puede interpretar sin adivinar.
  const grupos = entera.split(/[.,]/);
  if (grupos.length > 1) {
    const [primero, ...resto] = grupos;
    if (!/^\d{1,3}$/.test(primero!)) return { ok: false, error: AMBIGUO };
    if (!resto.every((g) => /^\d{3}$/.test(g))) {
      return { ok: false, error: AMBIGUO };
    }
  } else if (!/^\d*$/.test(grupos[0]!)) {
    return { ok: false, error: AMBIGUO };
  }

  const enteros = grupos.join("");
  if (enteros === "" && decimal === "") return { ok: false, error: AMBIGUO };

  // Aritmética entera hasta el final: los centavos no se calculan multiplicando
  // un float por 100.
  const cents =
    Number(enteros || "0") * 100 + Number(decimal.padEnd(2, "0") || "0");

  if (!Number.isSafeInteger(cents)) return { ok: false, error: AMBIGUO };
  if (cents > MAX_PRICE_CENTS) {
    return {
      ok: false,
      error: `Máximo $${(MAX_PRICE_CENTS / 100).toLocaleString("es-AR")}. ¿Sobró un cero?`,
    };
  }

  return { ok: true, cents, pesos: cents / 100 };
}

/**
 * Cómo se muestra un importe guardado dentro del input. Se formatea con el
 * separador de miles a propósito: así el valor que el campo muestra es el mismo
 * que `parsePesos` sabe leer, y editar un precio existente no lo rompe.
 */
export function formatPesosInput(cents: number): string {
  if (!Number.isFinite(cents)) return "";
  const centavos = Math.round(cents) % 100;
  const enteros = Math.floor(Math.round(cents) / 100);
  const miles = enteros.toLocaleString("es-AR", { useGrouping: true });
  return centavos === 0
    ? miles
    : `${miles},${String(centavos).padStart(2, "0")}`;
}
