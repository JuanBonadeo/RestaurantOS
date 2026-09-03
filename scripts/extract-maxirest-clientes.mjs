/**
 * extract-maxirest-clientes.mjs — saca la tabla `mxcli` de un dump de MaxiRest
 * y la escribe como JSON, para que el importador (spec 152) trabaje sobre datos
 * y no sobre 667 MB de SQL.
 *
 * Uso:
 *   node scripts/extract-maxirest-clientes.mjs <dump.sql> <salida.json>
 *
 * Dos cosas que el dump obliga a hacer bien:
 *
 * 1. **Es latin1**, no UTF-8. Leerlo como UTF-8 rompe cada ñ y cada acento de
 *    las razones sociales — y las razones sociales son el dato que se importa.
 * 2. **Los `INSERT` son una línea gigantesca por tabla.** Cortar por comas
 *    rompe con cualquier razón social que tenga una ("EUGENIO BARALDI E HIJOS,
 *    SRL"), así que el parseo va carácter por carácter respetando comillas y
 *    escapes.
 *
 * Es hermano de `extract-maxirest.mjs` (insumos y recetas), pero ese hardcodea
 * un path de Windows y números de línea del backup de 2025; acá el path va por
 * argumento y la tabla se busca por su `INSERT INTO`.
 */

import { createReadStream, writeFileSync } from "fs";
import { createInterface } from "readline";

const TABLE = "mxcli";

/** Orden de columnas del `CREATE TABLE mxcli` (backup Golf 2025-12-23). */
const COLUMNS = [
  "id", "codigo", "nombre", "apellido", "razon", "dni", "cod_cal", "cod_map",
  "calle", "altura", "pisodto", "entre1", "entre2", "sector", "telefono",
  "celular", "localidad", "foto", "cod_postal", "provincia", "geoloc",
  "e_mail", "fecha_nac", "fecha_ing", "turno_ing", "categoria", "cod_dto",
  "tipo_iva", "cuit", "observac", "detalles", "vtas_acum", "impo_acum",
  "fecha_parc", "vtas_parc", "impo_parc", "bloq_cred", "tope_cred", "cpb_defa",
  "texto1", "texto2", "texto3", "puntos", "cod_tarj", "zona", "sinc",
  "cod_unif", "sinc_bd", "conyuge", "fotoblob", "aliascbu", "pais", "cod_doc",
];

/** Sólo lo que el importador necesita. El resto (fotoblob, puntos, geoloc…) se
 *  descarta acá para que el JSON sea manejable. `bloq_cred`/`tope_cred` quedan
 *  porque son la cuenta corriente (spec 141) y salen de la misma fila. */
const KEEP = [
  "codigo", "nombre", "apellido", "razon", "dni", "cuit", "tipo_iva", "cod_doc",
  "calle", "altura", "localidad", "provincia", "cod_postal",
  "telefono", "celular", "e_mail", "cpb_defa", "bloq_cred", "tope_cred",
];

/**
 * Parte `(...),(...),(...)` en tuplas, respetando comillas simples y escapes.
 * Devuelve un array de arrays de strings (o `null` para el NULL de SQL).
 */
function parseTuples(values) {
  const rows = [];
  let i = 0;
  const n = values.length;

  while (i < n) {
    // Buscar el "(" que abre la tupla, fuera de comillas.
    while (i < n && values[i] !== "(") i++;
    if (i >= n) break;
    i++; // consumir "("

    const cols = [];
    let cur = "";
    let quoted = false;
    let inString = false;

    while (i < n) {
      const ch = values[i];

      if (inString) {
        if (ch === "\\") {
          // Escape de MySQL: \' \" \\ \n \r \0 \Z. Nos quedamos con el literal
          // salvo los saltos, que en un char() de MaxiRest no aportan nada.
          const next = values[i + 1];
          if (next === "n") cur += "\n";
          else if (next === "r") cur += "\r";
          else if (next === "0" || next === "Z") cur += "";
          else cur += next;
          i += 2;
          continue;
        }
        if (ch === "'") {
          inString = false;
          i++;
          continue;
        }
        cur += ch;
        i++;
        continue;
      }

      if (ch === "'") {
        inString = true;
        quoted = true;
        i++;
        continue;
      }
      if (ch === ",") {
        cols.push(finish(cur, quoted));
        cur = "";
        quoted = false;
        i++;
        continue;
      }
      if (ch === ")") {
        cols.push(finish(cur, quoted));
        i++;
        break;
      }
      cur += ch;
      i++;
    }

    if (cols.length) rows.push(cols);
  }

  return rows;
}

/** Un valor sin comillas que dice NULL es el NULL de SQL; el resto, texto. */
function finish(raw, quoted) {
  if (!quoted && raw.trim().toUpperCase() === "NULL") return null;
  return quoted ? raw : raw.trim();
}

/** Streamea un dump y devuelve las tuplas de una tabla, ya parseadas. */
export async function readTable(dumpPath, table, onRow) {
  const prefix = `INSERT INTO \`${table}\` VALUES `;
  const rl = createInterface({
    input: createReadStream(dumpPath, "latin1"),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    if (!line.startsWith(prefix)) continue;
    const values = line.slice(prefix.length).replace(/;\s*$/, "");
    for (const cols of parseTuples(values)) onRow(cols);
  }
}

export { parseTuples };

async function main() {
  const [dumpPath, outPath] = process.argv.slice(2);
  if (!dumpPath || !outPath) {
    console.error(
      "Uso: node scripts/extract-maxirest-clientes.mjs <dump.sql> <salida.json>",
    );
    process.exit(1);
  }

  const prefix = `INSERT INTO \`${TABLE}\` VALUES `;
  const rl = createInterface({
    input: createReadStream(dumpPath, "latin1"),
    crlfDelay: Infinity,
  });

  const rows = [];
  for await (const line of rl) {
    if (!line.startsWith(prefix)) continue;
    // El `;` final no es parte de la última tupla.
    const values = line.slice(prefix.length).replace(/;\s*$/, "");
    for (const cols of parseTuples(values)) {
      if (cols.length !== COLUMNS.length) {
        console.warn(
          `⚠️  fila con ${cols.length} columnas (esperaba ${COLUMNS.length}) — se saltea`,
        );
        continue;
      }
      const row = {};
      COLUMNS.forEach((name, idx) => {
        if (KEEP.includes(name)) row[name] = cols[idx];
      });
      rows.push(row);
    }
  }

  writeFileSync(outPath, JSON.stringify(rows, null, 2), "utf8");
  const conCuit = rows.filter((r) => (r.cuit ?? "").replace(/\D/g, "").length === 11);
  console.log(`${TABLE}: ${rows.length} filas → ${outPath}`);
  console.log(`  con CUIT de 11 dígitos: ${conCuit.length}`);
}

// Sólo corre si se lo invoca directo: el parser se importa desde otros scripts.
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop())) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
