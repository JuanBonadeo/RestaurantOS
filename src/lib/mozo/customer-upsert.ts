import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { customerPhoneKey } from "@/lib/phone";

type GenericClient = SupabaseClient;

/**
 * Upsert de cliente por `(business_id, phone)`. Idempotente.
 *
 * La clave va normalizada (issue #114) para que el mismo número tipeado en
 * otro formato acá, en el checkout o en una reserva sea el mismo cliente.
 *
 * Sin teléfono no hay cliente: el nombre solo no identifica a nadie y llenaría
 * el CRM de "Juan" sueltos. Devuelve `null` en ese caso —no es un error, es el
 * caso normal de una mesa a la que no se le pidió el teléfono.
 */
export async function upsertCustomerByPhone(
  service: GenericClient,
  businessId: string,
  phone: string | undefined | null,
  name: string | undefined | null,
): Promise<{ ok: true; customerId: string | null } | { ok: false }> {
  const phoneKey = customerPhoneKey(phone ?? undefined);
  if (!phoneKey) return { ok: true, customerId: null };

  const { data: existing } = await service
    .from("customers")
    .select("id, name")
    .eq("business_id", businessId)
    .eq("phone", phoneKey)
    .maybeSingle();
  const existingRow = existing as { id: string; name: string | null } | null;

  if (existingRow) {
    if (name && name !== existingRow.name) {
      const { error: updErr } = await service
        .from("customers")
        .update({ name })
        .eq("id", existingRow.id);
      if (updErr) console.error("upsertCustomerByPhone update", updErr);
    }
    return { ok: true, customerId: existingRow.id };
  }

  const { data: created, error: insErr } = await service
    .from("customers")
    .insert({ business_id: businessId, phone: phoneKey, name: name ?? null })
    .select("id")
    .single();
  if (insErr) {
    console.error("upsertCustomerByPhone insert", insErr);
    return { ok: false };
  }
  return { ok: true, customerId: (created as { id: string }).id };
}
