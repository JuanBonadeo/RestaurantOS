#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────
// test-env-local — apunta los TESTS al stack local, sin tocar la app.
//
// Escribe `.env.test` con las credenciales de `supabase status`. Si ese archivo
// existe, `vitest.setup.ts` lo carga antes que el `.env.local` de cada test, así
// que los tests de integración corren contra la base local.
//
// Por qué existe, teniendo `env-switch`: ése cambia `.env.local`, o sea mueve
// **la app y los tests juntos**. Acá se separan — la app puede seguir apuntando
// a la cloud mientras los tests corren en local.
//
// Por qué importa: contra la cloud hay ~304ms de RTT por query; en local, ~7ms.
// La suite completa pasa de ~70s a ~25s, y los tests de integración de 40s a
// 1.6s. Los rojos por `Test timed out` que aparecían contra la cloud no eran
// bugs: era la red.
//
//   node scripts/test-env-local.mjs
// ─────────────────────────────────────────────────────────────────────────
import { writeFileSync } from "node:fs";
import { execSync } from "node:child_process";

const MAP = {
  API_URL: "NEXT_PUBLIC_SUPABASE_URL",
  SERVICE_ROLE_KEY: "SUPABASE_SERVICE_ROLE_KEY",
  ANON_KEY: "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  PUBLISHABLE_KEY: "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
};

let raw;
try {
  // `npx` porque el CLI es devDependency: no siempre está en el PATH global.
  raw = execSync("npx supabase status -o env", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
} catch {
  console.error(
    "No se pudo leer `supabase status`. ¿Levantaste el stack?\n" +
      "  npx supabase start && npx supabase db reset",
  );
  process.exit(1);
}

const out = ["# Generado por scripts/test-env-local.mjs — NO commitear.",
  "# Claves de desarrollo del CLI de Supabase: iguales en cualquier máquina.",
  "# Si este archivo existe, `pnpm test` corre contra la base LOCAL."];

for (const line of raw.split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)="?([^"]*)"?$/);
  if (!m) continue;
  const key = MAP[m[1]];
  if (key) out.push(`${key}="${m[2]}"`);
}

if (out.length <= 3) {
  console.error("`supabase status` no devolvió credenciales.");
  process.exit(1);
}

writeFileSync(".env.test", out.join("\n") + "\n");
console.log("✓ .env.test escrito — los tests ahora corren contra la base local.");
console.log("  Para volver a la cloud: borrá .env.test.");
