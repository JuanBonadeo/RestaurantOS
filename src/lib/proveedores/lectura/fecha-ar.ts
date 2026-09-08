/**
 * La fecha de un papel argentino — spec 172.
 *
 * Hermana de `numeros-ar.ts` y con el mismo criterio: el modelo transcribe
 * verbatim lo que ve y la interpretación se hace acá, donde se puede leer y
 * testear. La diferencia es qué hacemos con la duda.
 *
 * Con los números la duda se resuelve por aritmética: `conciliar.ts` prueba las
 * lecturas posibles contra el total de la línea y gana la que cierra. **Con la
 * fecha no hay contra qué cerrarla.** No hay una segunda columna que confirme
 * que `05/06` es junio y no mayo. Así que la regla es la otra mitad de la del
 * prompt: **ante la duda, `null`.**
 *
 * Y `null` en serio, nunca hoy. La fecha del comprobante es la que manda el
 * vencimiento de la cuenta corriente: una fecha inventada que cae en hoy hace
 * que un remito de hace tres semanas figure recién vencido, o al revés, que uno
 * de ayer se muestre como deuda vieja. Un campo vacío lo completa el encargado
 * en dos segundos mirando el papel que tiene en la mano; una fecha equivocada no
 * la nota nadie hasta que el proveedor reclama.
 *
 * Por eso tampoco hay ningún `new Date()` acá adentro: esta función no sabe qué
 * día es y no lo necesita. Si algún día hace falta acotar contra hoy, «hoy»
 * entra por parámetro.
 */

/** El orden argentino: día, mes, año. `1` = enero. */
const MESES: Record<string, number> = {
  ene: 1,
  feb: 2,
  mar: 3,
  abr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  ago: 8,
  sep: 9,
  set: 9, // «SET» es como abrevia septiembre media Argentina.
  oct: 10,
  nov: 11,
  dic: 12,
};

/**
 * Los años que aceptamos con cuatro dígitos.
 *
 * Un `1026` o un `2062` salidos de una foto son un dígito mal leído, no una
 * fecha. Rechazarlos cuesta que el encargado tipee seis caracteres; aceptarlos
 * cuesta un vencimiento a mil años vista en el listado de deuda.
 */
const ANIO_MIN = 1990;
const ANIO_MAX = 2099;

const DIAS_POR_MES = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function bisiesto(anio: number): boolean {
  return (anio % 4 === 0 && anio % 100 !== 0) || anio % 400 === 0;
}

/**
 * Arma el `YYYY-MM-DD` si el día existe de verdad, o `null`.
 *
 * Sin `Date`: `new Date(2026, 12, 32)` no falla, **rueda** al mes siguiente. Un
 * `32/13/2026` mal leído se convertiría en un 1 de febrero de 2027 con toda
 * naturalidad, y nadie volvería a mirarlo.
 */
function armar(dia: number, mes: number, anio: number): string | null {
  if (!Number.isInteger(dia) || !Number.isInteger(mes) || !Number.isInteger(anio)) return null;
  if (mes < 1 || mes > 12) return null;
  if (anio < ANIO_MIN || anio > ANIO_MAX) return null;

  const tope = mes === 2 && bisiesto(anio) ? 29 : DIAS_POR_MES[mes - 1]!;
  if (dia < 1 || dia > tope) return null;

  return `${String(anio).padStart(4, "0")}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
}

/** Dos dígitos son de este siglo. `26` es 2026, no 1926. */
function anioCompleto(txt: string): number {
  const n = Number(txt);
  return txt.length <= 2 ? 2000 + n : n;
}

/** El separador que usan los papeles: barra, guion, punto o espacio. */
const SEP = "[\\s./-]";

const ISO = new RegExp(`^(\\d{4})${SEP}(\\d{1,2})${SEP}(\\d{1,2})(?!\\d)`);
const NUMERICA = new RegExp(`^(\\d{1,2})${SEP}(\\d{1,2})${SEP}(\\d{2,4})(?!\\d)`);
const CON_MES_EN_LETRAS = new RegExp(`^(\\d{1,2})${SEP}*\\s*([A-Za-zÁÉÍÓÚáéíóúñÑ]{3,12})\\.?${SEP}*\\s*(\\d{2,4})(?!\\d)`);

/**
 * Texto de un comprobante → `YYYY-MM-DD`, o `null`.
 *
 * Lee `15/03/2026`, `15-03-26`, `15.03.2026`, `3/7/26`, `15 MAR 2026`,
 * `15 de marzo de 2026` y el ISO que a veces ya viene armado. Todo lo demás es
 * `null`.
 */
export function parseFechaAR(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;

  // Se recorta lo que venga pegado adelante (`Fecha:`, `Emisión`) y la hora que
  // traen los tickets térmicos detrás. El ancla `^` de los patrones corre sobre
  // lo que queda.
  const texto = String(raw)
    .trim()
    .replace(/^[^\d]*/, "")
    .trim();
  if (!texto) return null;

  // ISO primero: cuatro dígitos adelante sólo pueden ser el año. Si no se
  // chequeara antes, `2026-03-15` entraría por la regla argentina y daría el día
  // 2026 del mes 03 ⇒ null, perdiendo una fecha que estaba perfecta.
  const iso = texto.match(ISO);
  if (iso) return armar(Number(iso[3]), Number(iso[2]), Number(iso[1]));

  const num = texto.match(NUMERICA);
  if (num) {
    // Orden argentino, sin excepciones ni heurísticas: `05/06/2026` es el 5 de
    // JUNIO. La tentación es «si el primero es > 12 entonces es el día, si no
    // fijate», pero eso convierte el formato en algo que depende del número, y
    // las fechas ambiguas —que son las de los primeros doce días del mes— se
    // leerían al revés justo cuando nadie lo puede notar.
    return armar(Number(num[1]), Number(num[2]), anioCompleto(num[3]!));
  }

  // El «de» de «15 de marzo de 2026» se saca acá y no en el patrón: metido en
  // la expresión regular la vuelve ilegible, y como palabra suelta no aparece
  // dentro de ningún nombre de mes.
  const letras = texto.replace(/\bde\b/gi, " ").match(CON_MES_EN_LETRAS);
  if (letras) {
    const clave = letras[2]!
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .slice(0, 3);
    const mes = MESES[clave];
    if (mes === undefined) return null;
    return armar(Number(letras[1]), mes, anioCompleto(letras[3]!));
  }

  return null;
}
