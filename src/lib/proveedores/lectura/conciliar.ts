import { interpretacionesNumeroAR } from "./numeros-ar";

/**
 * La aritmética decide — spec 172·D1.
 *
 * El modelo transcribe tres números por renglón: cantidad, precio unitario y
 * total de línea. **`cantidad × precio = total` tiene que cerrar siempre**: es
 * aritmética del papel, y si no cierra es que leímos mal un número.
 *
 * (Ojo con la otra identidad, que es distinta: `Σ renglones = total del
 * comprobante` **NO** tiene que cerrar. La factura trae ítems que no cargamos —
 * limpieza, bebida— y en 2026 sólo 585 de 1.502 comprobantes del Golf cuadraban
 * exacto. Eso es la 165·D2 y se muestra, no se corrige.)
 *
 * Acá se usa esa identidad para dos cosas:
 *
 * 1. **Desambiguar el separador decimal.** Si la lectura argentina de un número
 *    no cierra y la alternativa sí, gana la que cierra. Es el modelo proponiendo
 *    y la aritmética decidiendo.
 * 2. **Reconstruir el campo que falta.** El ticket térmico parte la línea en dos
 *    y la factura A4 desalinea las columnas: es normal que uno de los tres no se
 *    lea. Con los otros dos se recupera, y queda marcado como reconstruido.
 */
export type RenglonLeido = {
  cantidad: string | null;
  precioUnitario: string | null;
  totalLinea: string | null;
};

export type EstadoConciliacion =
  /** Los tres números cierran entre sí. */
  | "cuadra"
  /** Faltaba uno y se dedujo de los otros dos. */
  | "reconstruido"
  /** Los tres están y no cierran con ninguna lectura: leímos mal alguno. */
  | "no_cuadra"
  /** Faltan dos o más: no hay con qué. Es el estado normal de una lista de pedido. */
  | "incompleto";

export type RenglonConciliado = {
  cantidad: number | null;
  precioUnitario: number | null;
  totalLinea: number | null;
  estado: EstadoConciliacion;
  /** Cuál campo se dedujo, si `estado` es `reconstruido`. */
  reconstruido: "cantidad" | "precio" | "total" | null;
};

/**
 * Medio peso de tolerancia, o 0,5% del total de la línea si es grande.
 *
 * No es holgura para errores de lectura: es para el redondeo del papel. Un
 * proveedor que imprime `0,4260 u × 1.652,89` y redondea el total a `704,13`
 * está bien; exigir igualdad exacta marcaría media factura como rota.
 */
const tolerancia = (total: number) => Math.max(0.5, Math.abs(total) * 0.005);

export function conciliarRenglon(leido: RenglonLeido): RenglonConciliado {
  const cants = interpretacionesNumeroAR(leido.cantidad);
  const precios = interpretacionesNumeroAR(leido.precioUnitario);
  const totales = interpretacionesNumeroAR(leido.totalLinea);

  const presentes = [cants, precios, totales].filter((x) => x.length > 0).length;

  if (presentes === 3) {
    // Se recorren las combinaciones y gana la de menor peso entre las que
    // cierran. El peso mide cuánto hay que apartarse de la lectura argentina.
    //
    // El TOTAL pesa el doble que el precio y el cuádruple que la cantidad, y eso
    // no es arbitrario: cuando dos combinaciones cierran, la aritmética ya no
    // puede desempatar —las dos son coherentes— y hay que elegir por otra razón.
    // El total es el número que el papel imprime más grande, más a la derecha y
    // con menos abreviaturas, y es contra el que la persona compara. Así
    // «4 × 2,500 = 10.000» se lee 4 × $2.500 y no 4 × $2,50 = $10.
    let mejor: RenglonConciliado | null = null;
    let mejorPeso = Infinity;

    for (let i = 0; i < cants.length; i++) {
      for (let j = 0; j < precios.length; j++) {
        for (let k = 0; k < totales.length; k++) {
          const rango = i + j * 2 + k * 4;
          if (rango >= mejorPeso) continue;
          const [c, p, t] = [cants[i]!, precios[j]!, totales[k]!];
          if (Math.abs(c * p - t) <= tolerancia(t)) {
            mejor = {
              cantidad: c,
              precioUnitario: p,
              totalLinea: t,
              estado: "cuadra",
              reconstruido: null,
            };
            mejorPeso = rango;
          }
        }
      }
    }
    if (mejor) return mejor;

    // Ninguna combinación cierra. NO se descarta la línea y NO se «arregla»:
    // descartarla en silencio pierde una compra real, y arreglarla es adivinar
    // cuál de los tres está mal. Se muestran los tres y decide la persona.
    return {
      cantidad: cants[0]!,
      precioUnitario: precios[0]!,
      totalLinea: totales[0]!,
      estado: "no_cuadra",
      reconstruido: null,
    };
  }

  if (presentes === 2) {
    const c = cants[0] ?? null;
    const p = precios[0] ?? null;
    const t = totales[0] ?? null;

    if (c !== null && p !== null) {
      return { cantidad: c, precioUnitario: p, totalLinea: c * p, estado: "reconstruido", reconstruido: "total" };
    }
    if (c !== null && t !== null && c !== 0) {
      return { cantidad: c, precioUnitario: t / c, totalLinea: t, estado: "reconstruido", reconstruido: "precio" };
    }
    if (p !== null && t !== null && p !== 0) {
      return { cantidad: t / p, precioUnitario: p, totalLinea: t, estado: "reconstruido", reconstruido: "cantidad" };
    }
  }

  // Uno o ninguno. Es el estado ESPERADO de la lista de pedido de la verdulería,
  // que casi nunca trae precios — la UI tiene que decirlo así y no como un error.
  return {
    cantidad: cants[0] ?? null,
    precioUnitario: precios[0] ?? null,
    totalLinea: totales[0] ?? null,
    estado: "incompleto",
    reconstruido: null,
  };
}
