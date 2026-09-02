"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { headers } from "next/headers";

import { actionError, type ActionResult } from "@/lib/actions";
import { parseIdentificador } from "@/lib/auth/identificador";
import { limitLogin } from "@/lib/rate-limit";
import { clientIpFromForwarded } from "@/lib/rrhh/ip-allowlist";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

const SignInInput = z.object({
  business_slug: z.string().min(1),
  // Spec 142: email **o** PIN de 4 dígitos. Se sigue llamando `email` en el
  // wire para no romper a quien ya llama esta action; lo que valida el formato
  // es `parseIdentificador`, no Zod.
  email: z.string().min(1),
  password: z.string().min(1),
});

/**
 * Spec 142 · D2 — un solo mensaje para todos los modos de fallar: PIN que no
 * existe, PIN con contraseña equivocada, email que no existe, contraseña mala.
 *
 * Si difieren, el login se vuelve un oráculo para enumerar los PINs válidos del
 * negocio, y un PIN válido sirve para fichar por otro (`clockPunch`).
 */
const CREDENCIALES_INVALIDAS = "Email/PIN o contraseña incorrectos.";

export async function signIn(input: unknown): Promise<ActionResult<never>> {
  const parsed = SignInInput.safeParse(input);
  if (!parsed.success) return actionError("Datos inválidos.");
  const { business_slug, email: rawIdentificador, password } = parsed.data;

  const identificador = parseIdentificador(rawIdentificador);
  if (!identificador) return actionError(CREDENCIALES_INVALIDAS);

  // D3: el techo por IP es lo que hace inviable recorrer los 10.000 PINs
  // posibles. Va antes de tocar la base, así que un bot ni siquiera llega a
  // preguntar si un PIN existe.
  const h = await headers();
  const ip = clientIpFromForwarded(h.get("x-forwarded-for"));
  const { success: allowed } = await limitLogin(ip ?? "unknown");
  if (!allowed) {
    return actionError(
      "Demasiados intentos. Esperá un minuto y probá de nuevo.",
    );
  }

  const service = createSupabaseServiceClient();
  const { data: business } = await service
    .from("businesses")
    .select("id")
    .eq("slug", business_slug)
    .eq("is_active", true)
    .maybeSingle();
  if (!business) {
    return actionError("Negocio no encontrado.");
  }

  // El PIN identifica dentro del negocio (`business_users_pin_unique_idx` es
  // por `business_id`), así que la resolución necesita el business ya cargado.
  // El mismo PIN puede ser de otra persona en otro local: por eso el slug de la
  // URL no es decorativo acá.
  let loginEmail: string;
  if (identificador.tipo === "pin") {
    const { data: member } = await service
      .from("business_users")
      .select("user_id, users:user_id(email)")
      .eq("business_id", business.id)
      .eq("pin", identificador.valor)
      .is("disabled_at", null)
      .maybeSingle();
    const found = (member as { users?: { email: string | null } } | null)?.users
      ?.email;
    // Sin PIN encontrado no se corta distinto: se devuelve el mismo error que
    // una contraseña mala (D2).
    if (!found) return actionError(CREDENCIALES_INVALIDAS);
    loginEmail = found;
  } else {
    loginEmail = identificador.valor;
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email: loginEmail,
    password,
  });
  if (error || !data.user) {
    return actionError(CREDENCIALES_INVALIDAS);
  }

  const { data: membership } = await service
    .from("business_users")
    .select("role")
    .eq("business_id", business.id)
    .eq("user_id", data.user.id)
    .maybeSingle();
  if (!membership) {
    await supabase.auth.signOut();
    return actionError("No tenés acceso a este negocio.");
  }

  // Los mozos operan desde /mozo (Mis mesas), no desde /admin (que está
  // pensado para admin y encargado). Encargado y admin van al panel.
  const role = (membership as { role: string }).role;
  if (role === "mozo") {
    redirect(`/${business_slug}/mozo`);
  }
  // La terminal (spec 140) no tiene dashboard: su pantalla es el operativo, y
  // `/admin` la rebotaría igual. Se la manda derecho.
  if (role === "terminal") {
    redirect(`/${business_slug}/admin/operacion`);
  }
  redirect(`/${business_slug}/admin`);
}
