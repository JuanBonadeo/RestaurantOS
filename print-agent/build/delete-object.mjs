// Borra un objeto del bucket print-agent-releases (ej. limpiar un artefacto viejo).
// Uso: SUPABASE_SERVICE_ROLE_KEY=xxx node delete-object.mjs <objeto>
import { createClient } from "@supabase/supabase-js";

const URL = "https://tjfufswzsxfujcpoxapx.supabase.co";
const BUCKET = "print-agent-releases";
const OBJECT = process.argv[2];

if (!OBJECT) { console.error("✗ falta el nombre del objeto a borrar"); process.exit(1); }
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!key) { console.error("✗ Falta SUPABASE_SERVICE_ROLE_KEY"); process.exit(1); }

const sb = createClient(URL, key, { auth: { persistSession: false } });
const { error } = await sb.storage.from(BUCKET).remove([OBJECT]);
if (error) { console.error("✗ borrado falló:", error.message); process.exit(1); }
console.log(`✓ borrado ${BUCKET}/${OBJECT}`);
