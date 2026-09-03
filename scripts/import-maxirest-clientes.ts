/**
 * import-maxirest-clientes.ts — importa los receptores de factura de MaxiRest
 * (`mxcli`) a `fiscal_entities` (spec 152, #228).
 *
 * Uso:
 *   npx tsx scripts/import-maxirest-clientes.ts --slug golf-jcr --json <mxcli.json>
 *   npx tsx scripts/import-maxirest-clientes.ts --slug golf-jcr --json <mxcli.json> --apply
 *
 * **Por defecto es dry-run**: imprime el reporte y no escribe nada. Escribe sólo
 * con `--apply`.
 *
 * El JSON lo produce `extract-maxirest-clientes.mjs` a partir del dump. El mapeo
 * (qué entra, cómo se llama, qué condición de IVA le corresponde y cómo se
 * resuelven los CUIT repetidos) vive en `src/lib/afip/maxirest-import.ts`, que
 * está testeado — acá sólo se lee, se llama y se escribe.
 *
 * Un re-import NO pisa lo que ya está (D5): si alguien corrigió una razón social
 * en la pantalla de Facturación, el import del mes siguiente no la deshace. Se
 * insertan las que faltan y se reportan las que ya estaban.
 */

import { readFileSync } from "fs";
import { resolve } from "path";

import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";

import {
  planificarImport,
  type MxcliRow,
} from "../src/lib/afip/maxirest-import";

config({ path: resolve(__dirname, "../.env.local") });

/** Insertar de a lotes: 410 filas en una sola sentencia es innecesario y hace
 *  ilegible el error si una sola viola un CHECK. */
const BATCH = 50;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const slug = arg("slug");
  const jsonPath = arg("json");
  const apply = process.argv.includes("--apply");

  if (!slug || !jsonPath) {
    console.error(
      "Uso: npx tsx scripts/import-maxirest-clientes.ts --slug <slug> --json <mxcli.json> [--apply]",
    );
    process.exit(1);
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("Faltan NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.");
    process.exit(1);
  }
  const supabase = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: business } = await supabase
    .from("businesses")
    .select("id, name")
    .eq("slug", slug)
    .maybeSingle();
  if (!business) {
    console.error(`Negocio "${slug}" no encontrado.`);
    process.exit(1);
  }

  const rows = JSON.parse(readFileSync(jsonPath, "utf8")) as MxcliRow[];
  const plan = planificarImport(rows);

  // ── Reporte ────────────────────────────────────────────────────
  console.log(`\n═══ ${slug} (${business.name}) ═══`);
  console.log(`  filas en mxcli:            ${rows.length}`);
  console.log(`  sin CUIT (comensales):     ${plan.sinCuit}`);
  console.log(`  entidades a importar:      ${plan.entidades.length}`);
  console.log(`  descartadas:               ${plan.descartadas.length}`);
  console.log(`  duplicadas (CUIT repetido): ${plan.duplicadas.length}`);

  const porCondicion = new Map<number, number>();
  for (const e of plan.entidades) {
    porCondicion.set(e.condicion_iva, (porCondicion.get(e.condicion_iva) ?? 0) + 1);
  }
  const LABEL: Record<number, string> = {
    1: "Resp. Inscripto",
    4: "Exento",
    5: "Consumidor Final",
    6: "Monotributo",
  };
  console.log("\n  condición de IVA:");
  for (const [cond, n] of [...porCondicion.entries()].sort()) {
    console.log(`    ${String(cond).padStart(2)} ${LABEL[cond].padEnd(17)} ${n}`);
  }

  if (plan.descartadas.length) {
    console.log("\n  ── descartadas ──");
    for (const d of plan.descartadas) {
      console.log(`    cod ${d.codigo.padStart(5)} | ${d.cuit.padEnd(14)} | ${d.motivo}`);
    }
  }
  if (plan.conflictos.length) {
    console.log("\n  ── CUIT repetido con razón social distinta (se importó la primera) ──");
    for (const c of plan.conflictos) {
      console.log(`    ${c.cuit} | "${c.importada}"  ←  descartada: ${c.descartadas.map((d) => `"${d}"`).join(", ")}`);
    }
  }
  if (plan.aRevisar.length) {
    console.log("\n  ── a revisar ──");
    for (const r of plan.aRevisar) {
      console.log(`    cod ${r.codigo.padStart(5)} | ${r.cuit} | ${r.nota}`);
    }
  }

  if (!apply) {
    console.log("\n  DRY-RUN — no se escribió nada. Agregá --apply para importar.\n");
    return;
  }

  // ── Escritura ──────────────────────────────────────────────────
  // D5 — `on conflict do nothing` sobre el unique (business_id, cuit): lo que ya
  // está no se pisa, ni siquiera si el backup trae un dato distinto.
  const { data: previas } = await supabase
    .from("fiscal_entities")
    .select("cuit")
    .eq("business_id", business.id);
  const yaEstaban = new Set((previas ?? []).map((p: { cuit: string }) => p.cuit));

  let insertadas = 0;
  let existentes = 0;

  for (let i = 0; i < plan.entidades.length; i += BATCH) {
    const lote = plan.entidades.slice(i, i + BATCH);
    const nuevas = lote.filter((e) => !yaEstaban.has(e.cuit));
    existentes += lote.length - nuevas.length;
    if (!nuevas.length) continue;

    const { data, error } = await supabase
      .from("fiscal_entities")
      .upsert(
        nuevas.map((e) => ({ ...e, business_id: business.id })),
        { onConflict: "business_id,cuit", ignoreDuplicates: true },
      )
      .select("id");

    if (error) {
      console.error(`\n  ✗ lote ${i / BATCH + 1}: ${error.message}`);
      process.exit(1);
    }
    insertadas += data?.length ?? 0;
  }

  console.log(`\n  ✓ importadas:  ${insertadas}`);
  console.log(`    ya estaban:  ${existentes} (no se pisaron)\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
