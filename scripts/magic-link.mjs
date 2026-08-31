/**
 * Un link de acceso para entrar a la app sin tipear contraseña.
 *
 * Para qué: el verify en vivo pide entrar con el **rol real** (nunca
 * service_role), y el agente no ingresa contraseñas en formularios. Esto genera
 * un magic link con la Admin API de Supabase —la misma mecánica que usa la
 * invitación de empleados (`members-actions.ts`)— y lo arma contra
 * `/auth/confirm`, que hace el `verifyOtp` y deja la cookie de sesión del
 * server puesta.
 *
 * Uso:
 *   node scripts/magic-link.mjs sofia@demo.test "/demo/admin/operacion?tab=caja"
 *   BASE_URL=http://localhost:3000 node scripts/magic-link.mjs admin@demo.test
 *
 * El token es de un solo uso y caduca (~1 h). Es una credencial efímera: no lo
 * pegues en un issue ni en el canal.
 *
 * ⚠️ El negocio `demo` vive en la MISMA base cloud que golf-jcr y kcc: el
 * aislamiento es de datos, no de infraestructura. Entrá con un usuario del
 * negocio que vas a probar y no toques otro.
 */
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local" });

const email = process.argv[2];
const next = process.argv[3] ?? "/";
const baseUrl = process.env.BASE_URL ?? "http://localhost:3002";

if (!email) {
  console.error(
    'Falta el email. Uso: node scripts/magic-link.mjs <email> ["/ruta/destino"]',
  );
  process.exit(1);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error(
    "Faltan NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY en .env.local.",
  );
  process.exit(1);
}

const supabase = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const { data, error } = await supabase.auth.admin.generateLink({
  type: "magiclink",
  email,
});

if (error) {
  console.error(`No se pudo generar el link para ${email}: ${error.message}`);
  process.exit(1);
}

const params = new URLSearchParams({
  token_hash: data.properties.hashed_token,
  type: "magiclink",
  next,
});

console.log(`${baseUrl}/auth/confirm?${params}`);
