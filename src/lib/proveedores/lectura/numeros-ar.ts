/**
 * Leer un número de un papel argentino — spec 172.
 *
 * El modelo devuelve los números **como texto y verbatim**: `"82,600"`,
 * `"17.500"`, `"1.445.500"`, `"0,4260"`. Los separadores son información — son
 * las dos pistas que permiten desambiguar por convención argentina y, cuando eso
 * no alcanza, por aritmética. Si el modelo devolviera `number` ya habría decidido
 * si `17.500` es diecisiete mil quinientos o diecisiete y medio, y lo habría
 * decidido en el único lugar donde no lo podemos verificar.
 *
 * Por eso esto no devuelve UN número sino **las lecturas posibles, ordenadas por
 * convención argentina**. `conciliar.ts` usa el resto de la línea para elegir: si
 * la lectura AR no cierra contra el total impreso y la otra sí, gana la que
 * cierra. Es «el modelo propone, la aritmética decide» aplicado al separador
 * decimal.
 */

/** La primera interpretación, que es la argentina. `null` si no se pudo leer. */
export function parseNumeroAR(raw: string | null | undefined): number | null {
  return interpretacionesNumeroAR(raw)[0] ?? null;
}

export function interpretacionesNumeroAR(raw: string | null | undefined): number[] {
  if (raw === null || raw === undefined) return [];

  let s = String(raw).trim();
  if (!s) return [];

  const negativo = /^\(.*\)$/.test(s) || s.includes("-");

  // Fracciones: la carnicería escribe «1/2» y la verdulería «1/2 caj».
  const fraccion = s.match(/^(\d+)\s+(\d+)\s*\/\s*(\d+)/) ?? s.match(/^(\d+)\s*\/\s*(\d+)/);
  if (fraccion) {
    const [entero, num, den] =
      fraccion.length === 4
        ? [Number(fraccion[1]), Number(fraccion[2]), Number(fraccion[3])]
        : [0, Number(fraccion[1]), Number(fraccion[2])];
    if (den === 0) return [];
    const v = entero + num / den;
    return [negativo ? -v : v];
  }

  // Fuera todo lo que no sea dígito o separador: `$`, espacios, `kg`, `u`, `%`.
  s = s.replace(/[^\d.,]/g, "");
  if (!s || !/\d/.test(s)) return [];

  const comas = (s.match(/,/g) ?? []).length;
  const puntos = (s.match(/\./g) ?? []).length;

  const salida: number[] = [];
  const agregar = (n: number) => {
    if (Number.isFinite(n) && !salida.includes(n)) salida.push(n);
  };
  const limpio = (txt: string, decimal: "," | "." | null): number => {
    if (decimal === null) return Number(txt.replace(/[.,]/g, ""));
    const otro = decimal === "," ? "." : ",";
    return Number(txt.split(otro).join("").replace(decimal, "."));
  };

  if (comas > 0 && puntos > 0) {
    // Con los dos presentes, el que aparece ÚLTIMO es el decimal. `1.234,56` es
    // AR y `1,234.56` es la notación que a veces imprime un controlador fiscal:
    // las dos dan el mismo número y no hay ambigüedad que resolver.
    const decimal = s.lastIndexOf(",") > s.lastIndexOf(".") ? "," : ".";
    agregar(limpio(s, decimal));
    return negativo ? salida.map((n) => -n) : salida;
  }

  if (comas > 1 || puntos > 1) {
    // Más de un separador del mismo tipo sólo puede ser miles: `1.445.500`.
    agregar(limpio(s, null));
    return negativo ? salida.map((n) => -n) : salida;
  }

  const unico = comas === 1 ? "," : puntos === 1 ? "." : null;
  if (unico === null) {
    agregar(Number(s));
    return negativo ? salida.map((n) => -n) : salida;
  }

  const [izq, der] = s.split(unico);
  const tresDetras = der?.length === 3;

  if (unico === ",") {
    // La coma es decimal en Argentina, siempre. `82,600` son 82 kilos 600
    // gramos, que es como la carnicería escribe el peso.
    agregar(limpio(s, ","));
    // Pero si detrás hay exactamente 3 dígitos, alguien pudo escribir la coma
    // como separador de miles. Va SEGUNDA: sólo gana si la aritmética la elige.
    if (tresDetras && (izq?.length ?? 0) <= 3) agregar(limpio(s, null));
  } else {
    // El punto con 3 dígitos detrás es separador de miles: `17.500` son
    // diecisiete mil quinientos. Confundirlo divide el importe por mil, que es
    // uno de los errores que ya se pagó caro en el módulo de facturas hermano.
    if (tresDetras) {
      agregar(limpio(s, null));
      agregar(limpio(s, "."));
    } else {
      agregar(limpio(s, "."));
    }
  }

  return negativo ? salida.map((n) => -n) : salida;
}
