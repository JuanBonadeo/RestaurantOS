// @ts-nocheck
/**
 * import-maxirest-empleados-kcc.ts — Migra el padrón de KCC (Kentucky Club
 * House) desde el backup de MaxiRest (`mxemp`, base mx_51617, corte
 * 2026-07-20) a `business_users`, con su PIN de fichaje.
 *
 * Mismo esquema que golf-jcr (ver wiki/decisions/migracion-empleados-maxirest-golf-jcr.md),
 * con la iteración v2 de credenciales ya aplicada:
 *
 *   PIN       código de MaxiRest zero-padeado a 4 (único en origen; el máximo
 *             real es 54, así que no choca con los PINs de seed 1111-5555)
 *   email     nombre.apellido@kcc.internal — sin el PIN adentro (v1 lo exponía)
 *   password  <prefijo>+PIN, con el prefijo en la env `EMPLOYEE_PASSWORD_PREFIX`
 *             — determinística y distinta por persona, pero el esquema NO queda
 *             en el repo: con los códigos acá abajo alcanzaría para derivar
 *             todas las contraseñas. Las de verdad viven en el archivo de
 *             accesos, fuera de git (`wiki/negocio/*-accesos.md` está ignorado).
 *
 * Mapeo de roles (MaxiRest → RestaurantOS):
 *   M (mozo)        → mozo
 *   T (telefonista) → mozo       ← toma pedidos de delivery por teléfono, y
 *                                  cargar un pedido requiere /mozo
 *   O (operario)    → personal   ← cocina/limpieza: sólo fichan
 *   sin tipo        → personal   ← mínimo riesgo, se sube después si hace falta
 *
 * De los 54 legajos se excluyen 6 que no son personas sino cuentas de sistema o
 * plantillas genéricas de MaxiRest: SUPERVISOR, «Mozo», «Telefonista»,
 * «Repartidor», «RETIRO» y «CADETES».
 *
 * KCC **no tiene ningún encargado ni admin** en MaxiRest (su único tipo G era
 * la cuenta SUPERVISOR del sistema). Queda pendiente que el cliente diga quién
 * maneja el local; mientras tanto nadie del padrón puede entrar a /admin.
 *
 * Uso: `npx tsx scripts/import-maxirest-empleados-kcc.ts`
 */

import { resolve } from "path";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: resolve(__dirname, "../.env.cloud") });

const SLUG = "kcc";
const PASSWORD_PREFIX = process.env.EMPLOYEE_PASSWORD_PREFIX;

type Row = {
  codigo: number;
  nombre: string;
  apellido: string;
  email: string;
  role: "mozo" | "personal" | "encargado";
};

const EMPLOYEES: Row[] = [
  // ── mozo ──
  { codigo: 1, nombre: "Facundo", apellido: "Gimenez", email: "facundo.gimenez@kcc.internal", role: "mozo" },
  { codigo: 6, nombre: "Antonella", apellido: "Hernandez", email: "antonella.hernandez@kcc.internal", role: "mozo" },
  { codigo: 8, nombre: "Gaston", apellido: "Toro", email: "gaston.toro@kcc.internal", role: "mozo" },
  { codigo: 10, nombre: "Sabrina", apellido: "Toro", email: "sabrina.toro@kcc.internal", role: "mozo" },
  { codigo: 11, nombre: "Marcos", apellido: "Gonzalez", email: "marcos.gonzalez@kcc.internal", role: "mozo" },
  { codigo: 16, nombre: "Araceli Milagros", apellido: "Galvez", email: "araceli.galvez@kcc.internal", role: "mozo" },
  { codigo: 18, nombre: "Andres", apellido: "Jaques", email: "andres.jaques@kcc.internal", role: "mozo" },
  { codigo: 19, nombre: "Matias", apellido: "Deangeli", email: "matias.deangeli@kcc.internal", role: "mozo" },
  { codigo: 20, nombre: "Rafael Fernando", apellido: "Chavez", email: "rafael.chavez@kcc.internal", role: "mozo" },
  { codigo: 21, nombre: "Belen", apellido: "Cerqueiro", email: "belen.cerqueiro@kcc.internal", role: "mozo" },
  { codigo: 24, nombre: "Lauria", apellido: "Celeste", email: "lauria.celeste@kcc.internal", role: "mozo" },
  { codigo: 25, nombre: "Sara", apellido: "Escobar", email: "sara.escobar@kcc.internal", role: "mozo" },
  { codigo: 33, nombre: "Flor", apellido: "Almiron", email: "flor.almiron@kcc.internal", role: "mozo" },
  { codigo: 36, nombre: "Florencia", apellido: "Gomez", email: "florencia.gomez@kcc.internal", role: "mozo" },
  { codigo: 39, nombre: "Carla", apellido: "Ortiz", email: "carla.ortiz@kcc.internal", role: "mozo" },
  { codigo: 41, nombre: "Aixa", apellido: "Marini", email: "aixa.marini@kcc.internal", role: "mozo" },
  { codigo: 44, nombre: "Daniela Soledad", apellido: "Loza", email: "daniela.loza@kcc.internal", role: "mozo" },
  { codigo: 48, nombre: "Mariana", apellido: "Roldan", email: "mariana.roldan@kcc.internal", role: "mozo" },
  { codigo: 50, nombre: "Milena", apellido: "Duarte", email: "milena.duarte@kcc.internal", role: "mozo" },
  { codigo: 54, nombre: "Aneley", apellido: "Rodriguez", email: "aneley.rodriguez@kcc.internal", role: "mozo" },
  // ── personal ──
  { codigo: 7, nombre: "Yoana", apellido: "Saucedo", email: "yoana.saucedo@kcc.internal", role: "personal" },
  { codigo: 12, nombre: "Nestor Fabian", apellido: "Saucedo", email: "nestor.saucedo@kcc.internal", role: "personal" },
  { codigo: 13, nombre: "Roxana", apellido: "Antunez", email: "roxana.antunez@kcc.internal", role: "personal" },
  { codigo: 14, nombre: "Mirian", apellido: "Saucedo", email: "mirian.saucedo@kcc.internal", role: "personal" },
  { codigo: 15, nombre: "Alejandra", apellido: "Beade", email: "alejandra.beade@kcc.internal", role: "personal" },
  { codigo: 17, nombre: "Lautaro", apellido: "Vega", email: "lautaro.vega@kcc.internal", role: "personal" },
  { codigo: 22, nombre: "Lupe", apellido: "Martinez", email: "lupe.martinez@kcc.internal", role: "personal" },
  { codigo: 23, nombre: "Selva", apellido: "Lucero", email: "selva.lucero@kcc.internal", role: "personal" },
  { codigo: 26, nombre: "Antonia", apellido: "Almiron", email: "antonia.almiron@kcc.internal", role: "personal" },
  { codigo: 27, nombre: "Nancy", apellido: "Pippolo", email: "nancy.pippolo@kcc.internal", role: "personal" },
  { codigo: 28, nombre: "Lucas Ezequiel", apellido: "Flores", email: "lucas.flores@kcc.internal", role: "personal" },
  { codigo: 29, nombre: "Romina Alejandra", apellido: "Moreira", email: "romina.moreira@kcc.internal", role: "personal" },
  { codigo: 30, nombre: "Romina", apellido: "Caceres", email: "romina.caceres@kcc.internal", role: "personal" },
  { codigo: 31, nombre: "Silvia Beatriz", apellido: "Azcona", email: "silvia.azcona@kcc.internal", role: "personal" },
  { codigo: 32, nombre: "Romina", apellido: "Moreira", email: "romina.moreira2@kcc.internal", role: "personal" },
  { codigo: 35, nombre: "Sebastian", apellido: "Ruiz", email: "sebastian.ruiz@kcc.internal", role: "personal" },
  { codigo: 37, nombre: "Juan Cruz", apellido: "Richard", email: "juan.richard@kcc.internal", role: "personal" },
  { codigo: 38, nombre: "Diego", apellido: "Bo", email: "diego.bo@kcc.internal", role: "personal" },
  { codigo: 40, nombre: "Hipolito", apellido: "Monzon", email: "hipolito.monzon@kcc.internal", role: "personal" },
  { codigo: 42, nombre: "Raul", apellido: "Cisneros", email: "raul.cisneros@kcc.internal", role: "personal" },
  { codigo: 43, nombre: "Valeria", apellido: "Moreira", email: "valeria.moreira@kcc.internal", role: "personal" },
  { codigo: 45, nombre: "Jeronimo", apellido: "Martinez", email: "jeronimo.martinez@kcc.internal", role: "personal" },
  { codigo: 46, nombre: "Sebastian", apellido: "Masuelli", email: "sebastian.masuelli@kcc.internal", role: "personal" },
  { codigo: 47, nombre: "Manuel", apellido: "Juan", email: "manuel.juan@kcc.internal", role: "personal" },
  { codigo: 49, nombre: "Brian", apellido: "Albornoz", email: "brian.albornoz@kcc.internal", role: "personal" },
  { codigo: 51, nombre: "Romina", apellido: "Ordoñez", email: "romina.ordonez@kcc.internal", role: "personal" },
  { codigo: 52, nombre: "", apellido: "Priscila", email: "priscila@kcc.internal", role: "personal" },
  { codigo: 53, nombre: "Carina", apellido: "Carina", email: "carina.carina@kcc.internal", role: "personal" },];

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

async function main() {
  if (!PASSWORD_PREFIX) {
    console.error("✗ Falta EMPLOYEE_PASSWORD_PREFIX (el prefijo de las contraseñas de arranque).");
    process.exit(1);
  }
  const { data: business, error: bizErr } = await sb
    .from("businesses")
    .select("id")
    .eq("slug", SLUG)
    .single();
  if (bizErr || !business) {
    console.error(`✗ Negocio '${SLUG}' no encontrado:`, bizErr?.message);
    process.exit(1);
  }
  const businessId = business.id;
  console.log(`✓ Negocio ${SLUG} = ${businessId}\n`);

  const { data: existingUsers } = await sb.auth.admin.listUsers({ perPage: 1000 });
  let creados = 0;
  let reusados = 0;

  for (const emp of EMPLOYEES) {
    const pin = String(emp.codigo).padStart(4, "0");
    const fullName = `${emp.nombre} ${emp.apellido}`.trim();
    const password = `${PASSWORD_PREFIX}${pin}`;

    let userId: string;
    const existing = existingUsers?.users?.find(
      (u) => u.email?.toLowerCase() === emp.email.toLowerCase(),
    );

    if (existing) {
      userId = existing.id;
      reusados++;
    } else {
      const { data: newUser, error } = await sb.auth.admin.createUser({
        email: emp.email,
        password,
        email_confirm: true,
        user_metadata: { full_name: fullName },
      });
      if (error || !newUser?.user) {
        console.error(`✗ Auth user ${fullName} (${pin}):`, error?.message);
        continue;
      }
      userId = newUser.user.id;
      creados++;
    }

    const { error: uErr } = await sb
      .from("users")
      .upsert({ id: userId, email: emp.email, full_name: fullName }, { onConflict: "id" });
    if (uErr) {
      console.error(`✗ users ${fullName}:`, uErr.message);
      continue;
    }

    const { error: buErr } = await sb.from("business_users").upsert(
      {
        business_id: businessId,
        user_id: userId,
        role: emp.role,
        pin,
        full_name: fullName,
        disabled_at: null,
      },
      { onConflict: "business_id,user_id" },
    );
    if (buErr) {
      console.error(`✗ business_users ${fullName} (${pin}):`, buErr.message);
      continue;
    }

    console.log(`✓ ${fullName.padEnd(30)} PIN ${pin}  ${emp.role.padEnd(9)} ${emp.email}`);
  }

  console.log(`\nListo. ${creados} usuarios creados, ${reusados} ya existían.`);
}

main();
