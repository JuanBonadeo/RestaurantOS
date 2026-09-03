import { normalizarCuit } from "./cuit";
import type { CondicionIvaReceptor } from "./types";

// ============================================================================
// De `mxcli` (MaxiRest) a `fiscal_entities` — el mapeo puro (spec 152).
//
// Vive acá y no en `scripts/` porque es lógica de datos fiscales: lo que salga
// de estas funciones termina impreso en un comprobante. Acá se testea; el
// script de arriba sólo lee el dump, llama a esto y escribe.
// ============================================================================

/** Las columnas de `mxcli` que el import mira. Todas llegan como texto: son
 *  `char(n)` en MaxiRest, incluido el `codigo`. */
export type MxcliRow = {
  codigo: string;
  nombre: string;
  apellido: string;
  razon: string;
  cuit: string;
  tipo_iva: string;
  calle: string;
  altura: string;
  localidad: string;
  provincia: string;
  cod_postal: string;
  telefono: string;
  celular: string;
  e_mail: string;
};

/** Una fila lista para insertar en `fiscal_entities`. */
export type EntidadImportada = {
  cuit: string;
  razon_social: string;
  condicion_iva: CondicionIvaReceptor;
  domicilio: string | null;
  localidad: string | null;
  provincia: string | null;
  cod_postal: string | null;
  email: string | null;
  phone: string | null;
  /** `mxcli.codigo`, para que un re-import sepa qué ya trajo. */
  external_ref: string;
};

export type FilaDescartada = { codigo: string; cuit: string; motivo: string };
export type FilaARevisar = { codigo: string; cuit: string; nota: string };
export type ConflictoDeRazon = {
  cuit: string;
  importada: string;
  descartadas: string[];
};

export type PlanDeImport = {
  entidades: EntidadImportada[];
  /** Cuántas filas no tenían CUIT. No son un problema: son comensales, no
   *  receptores — el 85 % de `mxcli`. Se cuentan, no se listan. */
  sinCuit: number;
  descartadas: FilaDescartada[];
  /** Filas perdidas por deduplicación, con qué código ganó. */
  duplicadas: FilaDescartada[];
  /** Duplicados cuya razón social difería: hay que mirarlos. */
  conflictos: ConflictoDeRazon[];
  aRevisar: FilaARevisar[];
};

const t = (v: string | null | undefined): string => (v ?? "").trim();
const orNull = (v: string | null | undefined): string | null => t(v) || null;

/**
 * El nombre con el que la entidad va a aparecer en la lista y en la factura.
 *
 * `razon_social` es NOT NULL con `check (length(trim(razon_social)) > 0)`, y
 * **139 de los 410 con CUIT de Golf no tienen razón social cargada**: son
 * personas físicas con CUIT, cargadas por nombre y apellido. Sin este fallback
 * esas 139 rebotan contra la base.
 *
 * Devuelve `null` cuando no hay con qué: inventar un nombre desde el CUIT
 * ("CUIT 30-…-5") deja una fila que nadie puede reconocer en el buscador, que
 * es peor que no traerla.
 */
export function razonSocialDe(row: MxcliRow): string | null {
  const razon = t(row.razon);
  if (razon) return razon;

  const apellido = t(row.apellido);
  const nombre = t(row.nombre);
  if (!apellido || !nombre) return apellido || nombre || null;

  // En 24 de las 138 filas que llegan acá, `nombre` y `apellido` son EL MISMO
  // texto: el usuario de MaxiRest escribió la empresa en los dos campos. Sin
  // esto quedaban como "TANONI HNOS SA, TANONI HNOS SA".
  const a = apellido.toUpperCase();
  const n = nombre.toUpperCase();
  if (a === n) return apellido;
  // Y en otras 3 uno contiene al otro ("DE CAPUA" / "DE CAPUA CESAR ARIEL"):
  // el más largo ya dice todo lo que dice el corto.
  if (n.includes(a)) return nombre;
  if (a.includes(n)) return apellido;

  return `${apellido}, ${nombre}`;
}

/**
 * `mxcli.tipo_iva` → `condicion_iva` (ARCA RG 5616).
 *
 * ⚠️ **Los códigos de MaxiRest NO son los de ARCA.** Allá el `1` es justamente
 * el que **no** tiene CUIT; copiar el número declararía Responsable Inscripto a
 * un consumidor final, en la tabla desde la que se emite un comprobante fiscal.
 *
 * El mapeo sale de los datos del backup de Golf, cruzados contra los 189.380
 * comprobantes de `mxfac`:
 *
 * | MaxiRest | Clientes | Con CUIT | Comprobantes que recibieron | → ARCA |
 * |---|---|---|---|---|
 * | `1` | 2.376 | 3 | B y H, ninguna A | **5** Consumidor Final |
 * | `2` | 399 | 396 | **2.782 Facturas A** | **1** Resp. Inscripto |
 * | `6` | 11 | 11 | G, B, H, L — **ninguna A** | **4** Exento |
 *
 * El `6` es el que parecía Monotributo por tener el mismo dígito que el código
 * de ARCA. No lo es: los 11 son clubes, federaciones, mutuales y fundaciones
 * (CUIT 30/33, ni una persona física) y **en 189.380 comprobantes no recibieron
 * ni una Factura A** — un monotributista sí puede recibirla. Son exentos.
 */
export function condicionIvaDesdeTipoIva(
  tipoIva: string,
): CondicionIvaReceptor | null {
  switch (t(tipoIva)) {
    case "1":
      return 5; // Consumidor Final
    case "2":
      return 1; // Responsable Inscripto
    case "6":
      return 4; // Exento
    default:
      return null;
  }
}

/** `calle` + `altura` en un solo campo, que es como lo guarda `fiscal_entities`. */
export function domicilioDe(row: MxcliRow): string | null {
  const calle = t(row.calle);
  if (!calle) return null;
  const altura = t(row.altura);
  return altura ? `${calle} ${altura}` : calle;
}

/** Un candidato, antes de resolver los duplicados. */
type Candidato = {
  row: MxcliRow;
  cuit: string;
  razonSocial: string;
  condicionIva: CondicionIvaReceptor;
};

/**
 * Convierte las filas de `mxcli` en un plan de import, sin tocar la base.
 *
 * Aplica el D2 (entra sólo quien tiene CUIT), el D3 (la razón social y su
 * fallback), el D4 (deduplicación por CUIT) y el D6 (el mapeo de la condición).
 * Todo lo que no entra se reporta con su `codigo` de MaxiRest, para poder
 * mirarlo si el local pregunta.
 */
export function planificarImport(rows: MxcliRow[]): PlanDeImport {
  const descartadas: FilaDescartada[] = [];
  const duplicadas: FilaDescartada[] = [];
  const conflictos: ConflictoDeRazon[] = [];
  const aRevisar: FilaARevisar[] = [];
  let sinCuit = 0;

  const porCuit = new Map<string, Candidato[]>();

  for (const row of rows) {
    const crudo = t(row.cuit);
    const cuit = normalizarCuit(crudo);

    // D2 — sin CUIT no es un receptor de factura, es un comensal.
    if (!crudo) {
      sinCuit++;
      continue;
    }
    if (cuit.length !== 11) {
      // Alguien quiso cargar un CUIT y quedó a medias: eso sí se reporta.
      descartadas.push({
        codigo: row.codigo,
        cuit: crudo,
        motivo: "CUIT inválido (no son 11 dígitos)",
      });
      continue;
    }

    const razonSocial = razonSocialDe(row);
    if (!razonSocial) {
      descartadas.push({
        codigo: row.codigo,
        cuit,
        motivo: "sin razón social, nombre ni apellido",
      });
      continue;
    }

    const condicionIva = condicionIvaDesdeTipoIva(row.tipo_iva);
    if (condicionIva == null) {
      descartadas.push({
        codigo: row.codigo,
        cuit,
        motivo: `tipo_iva desconocido: "${t(row.tipo_iva)}"`,
      });
      continue;
    }

    porCuit.set(cuit, [
      ...(porCuit.get(cuit) ?? []),
      { row, cuit, razonSocial, condicionIva },
    ]);
  }

  const entidades: EntidadImportada[] = [];

  for (const [cuit, candidatos] of porCuit) {
    // D4 — gana la que tiene razón social propia (no el fallback del nombre);
    // entre iguales, el `codigo` más bajo, que es el registro más viejo. El
    // orden en que vengan las filas no puede cambiar el resultado.
    const ordenados = [...candidatos].sort((a, b) => {
      const aTieneRazon = t(a.row.razon) ? 0 : 1;
      const bTieneRazon = t(b.row.razon) ? 0 : 1;
      if (aTieneRazon !== bTieneRazon) return aTieneRazon - bTieneRazon;
      return Number(a.row.codigo) - Number(b.row.codigo);
    });

    const ganador = ordenados[0]!;
    const perdedores = ordenados.slice(1);

    for (const p of perdedores) {
      duplicadas.push({
        codigo: p.row.codigo,
        cuit,
        motivo: `CUIT duplicado — se importó el código ${ganador.row.codigo}`,
      });
    }

    // Que dos filas del mismo CUIT digan cosas distintas es lo que hay que
    // mirar: casi siempre es la misma empresa escrita de dos formas, pero
    // elegir por el local sin decirlo no.
    const otrasRazones = perdedores
      .map((p) => p.razonSocial)
      .filter((r) => r !== ganador.razonSocial);
    if (otrasRazones.length > 0) {
      conflictos.push({
        cuit,
        importada: ganador.razonSocial,
        descartadas: [...new Set(otrasRazones)],
      });
    }

    // Se marca DESPUÉS de deduplicar y sólo la que entró: avisar sobre una fila
    // descartada es ruido, porque la condición que queda guardada es la del
    // ganador.
    if (ganador.condicionIva === 5) {
      aRevisar.push({
        codigo: ganador.row.codigo,
        cuit,
        nota: "MaxiRest lo tiene como consumidor final pero tiene CUIT",
      });
    }

    const row = ganador.row;
    entidades.push({
      cuit,
      razon_social: ganador.razonSocial,
      condicion_iva: ganador.condicionIva,
      domicilio: domicilioDe(row),
      localidad: orNull(row.localidad),
      provincia: orNull(row.provincia),
      cod_postal: orNull(row.cod_postal),
      email: orNull(row.e_mail),
      // De los 410 con CUIT, 20 tienen teléfono. Es una base fiscal, no de
      // contacto: se trae lo que hay y no se pide nada.
      phone: orNull(row.telefono) ?? orNull(row.celular),
      external_ref: row.codigo,
    });
  }

  return { entidades, sinCuit, descartadas, duplicadas, conflictos, aRevisar };
}
