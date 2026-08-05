"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { actionError, actionOk, type ActionResult } from "@/lib/actions";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

const DeleteInput = z.object({
  order_id: z.string().uuid(),
  business_slug: z.string().min(1),
});

/**
 * Permanently delete a cancelled order (and cascades: order_items,
 * order_item_modifiers, order_status_history via on-delete-cascade FKs).
 *
 * Guardrails:
 *  - User must be authenticated and a member of the business
 *  - The order must already be in `cancelled` status — we don't let active
 *    orders be deleted, only cleaned up after cancellation
 */
export async function deleteOrder(
  input: unknown,
): Promise<ActionResult<null>> {
  const parsed = DeleteInput.safeParse(input);
  if (!parsed.success) return actionError("Datos inválidos.");
  const { order_id, business_slug } = parsed.data;

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return actionError("No autenticado.");

  const service = createSupabaseServiceClient();

  const { data: business } = await service
    .from("businesses")
    .select("id")
    .eq("slug", business_slug)
    .maybeSingle();
  if (!business) return actionError("Negocio no encontrado.");

  // Auth: must be a member of this business OR platform admin.
  const [{ data: profile }, { data: membership }] = await Promise.all([
    service
      .from("users")
      .select("is_platform_admin")
      .eq("id", user.id)
      .maybeSingle(),
    service
      .from("business_users")
      .select("role")
      .eq("business_id", business.id)
      .eq("user_id", user.id)
      .maybeSingle(),
  ]);
  // spec 096 · H-52 — no alcanza con **ser** miembro: hay que tener rango.
  //
  // Antes bastaba cualquier rol del negocio, incluido `mozo` y `personal`. Y el
  // borrado es duro: la cascada se lleva `order_items`,
  // `order_item_modifiers`, `order_status_history`, **`comandas`** y
  // **`order_splits`**; `invoices` e `ingredient_consumptions` quedan con el
  // FK en SET NULL, o sea comprobantes fiscales huérfanos de su venta.
  const rol = (membership as { role: string } | null)?.role;
  const puedeBorrar =
    profile?.is_platform_admin || rol === "encargado" || rol === "admin";
  if (!puedeBorrar) {
    return actionError("Solo encargado o admin pueden eliminar un pedido.");
  }

  // Load the order to validate status + tenant match.
  const { data: order } = await service
    .from("orders")
    .select("id, business_id, status")
    .eq("id", order_id)
    .maybeSingle();
  if (!order) return actionError("Pedido no encontrado.");
  if (order.business_id !== business.id) {
    return actionError("Pedido no pertenece a este negocio.");
  }
  if (order.status !== "cancelled") {
    return actionError(
      "Sólo se pueden eliminar pedidos cancelados. Cancelalo primero.",
    );
  }

  // Un pedido con comprobante fiscal no se borra: el FK de `invoices` es
  // SET NULL, así que la factura sobreviviría sin venta que la explique.
  // `payments` es RESTRICT y falla con un error genérico; mejor decirlo claro.
  const [{ count: facturas }, { count: pagos }] = await Promise.all([
    service
      .from("invoices")
      .select("id", { count: "exact", head: true })
      .eq("order_id", order_id),
    service
      .from("payments")
      .select("id", { count: "exact", head: true })
      .eq("order_id", order_id),
  ]);
  if ((facturas ?? 0) > 0) {
    return actionError(
      "Este pedido tiene un comprobante emitido — no se puede eliminar.",
    );
  }
  if ((pagos ?? 0) > 0) {
    return actionError(
      "Este pedido tiene pagos registrados — no se puede eliminar.",
    );
  }

  const { error } = await service.from("orders").delete().eq("id", order_id);
  if (error) {
    console.error("deleteOrder", error);
    return actionError("No pudimos eliminar el pedido.");
  }

  revalidatePath(`/${business_slug}/admin`);
  return actionOk(null);
}
