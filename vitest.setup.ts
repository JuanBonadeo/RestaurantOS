import { existsSync } from "node:fs";
import { config } from "dotenv";

import "@testing-library/jest-dom/vitest";

// ── Dónde corren los tests de integración ────────────────────────────────
//
// Si existe `.env.test`, gana: los tests apuntan al stack local
// (`npx supabase start` + `npx supabase db reset`). Si no, cae en `.env.local`
// como siempre y corre contra la cloud.
//
// Por qué importa: contra la cloud hay ~300ms de RTT por query. Un
// `registrarPago` son ~6 round-trips, así que un test que crea la orden, cobra
// y verifica pasa de 4s — y los rojos que aparecían no eran bugs sino la red.
// En local el RTT es de ~1ms.
//
// El orden es lo que hace que funcione: dotenv **no pisa** variables ya
// presentes en `process.env`, y este setup corre antes que el
// `config({ path: ".env.local" })` de cada archivo de test.
if (existsSync(".env.test")) {
  config({ path: ".env.test" });
}
