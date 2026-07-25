// Respalda el objeto actual del bucket y sube el .zip instalador (spec 046 f2).
// La key la ponés vos en el env — este script NO la guarda ni la imprime.
//
// Uso: SUPABASE_SERVICE_ROLE_KEY=xxx node deploy-zip.mjs [ruta-al-zip] [objeto]
import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";

const URL = "https://tjfufswzsxfujcpoxapx.supabase.co";
const BUCKET = "print-agent-releases";
const ZIP = process.argv[2] || "./print-agent.zip";
const OBJECT = process.argv[3] || "print-agent.zip";

const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!key) { console.error("✗ Falta SUPABASE_SERVICE_ROLE_KEY"); process.exit(1); }
if (!fs.existsSync(ZIP)) { console.error(`✗ No encuentro el zip: ${ZIP}`); process.exit(1); }

const sb = createClient(URL, key, { auth: { persistSession: false } });

// Backup best-effort del objeto actual (para rollback).
const { data: dl } = await sb.storage.from(BUCKET).download(OBJECT);
if (dl) {
  fs.writeFileSync(`./${OBJECT}.backup`, Buffer.from(await dl.arrayBuffer()));
  console.log(`· backup del actual → ./${OBJECT}.backup`);
}

const bytes = fs.readFileSync(ZIP);
const contentType = OBJECT.endsWith(".zip") ? "application/zip" : "application/octet-stream";
const { error } = await sb.storage
  .from(BUCKET)
  .upload(OBJECT, bytes, { upsert: true, contentType });
if (error) { console.error("✗ subida falló:", error.message); process.exit(1); }
console.log(`✓ subido ${(bytes.length / 1e6).toFixed(1)} MB → ${BUCKET}/${OBJECT}`);
