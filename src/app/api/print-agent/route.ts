import { NextResponse } from "next/server";

import { notifyPrintFailed } from "@/lib/notifications/events";
import {
  buildControlTicketContent,
  type ControlTicketData,
} from "@/lib/print/control-ticket";
import { buildComandaContent } from "@/lib/print/ticket";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

import { unauthorized, verifyAgentKey } from "./agent-auth";

/**
 * Sanea texto que va al stream ESC/POS de la comandera: quita bytes de control
 * (ESC 0x1B, GS 0x1D, etc.) que un cliente podría inyectar vía `notes` de un
 * pedido online para mandar comandos crudos a la impresora (corte de papel,
 * apertura de cajón, etc.). Conserva tab y newline. Security review #8.
 */
function sanitizeTicketText(s: string | null | undefined): string | null {
  if (s == null) return null;
  // eslint-disable-next-line no-control-regex
  return s.replace(/[\x00-\x08\x0B-\x1F\x7F]/g, "");
}

/**
 * GET /api/print-agent?business_id=X[&station_id=Y]
 *
 * Devuelve las comandas imprimibles: las `pendiente` (recién marchadas) y las
 * que tienen una reimpresión pedida (`reprint_requested_at`, spec 35) aunque ya
 * hayan avanzado de estado. Así el agente vuelve a imprimir un ticket a demanda
 * sin ningún cambio de su lado (imprime lo que el GET trae).
 * Si se pasa `station_id`, filtra por sector; si no, devuelve todas las del
 * negocio. El print agent llama esto en loop (pull).
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const businessId = url.searchParams.get("business_id");
  // Auth con el business_id ya parseado (spec 046): acepta key global o del negocio.
  if (!(await verifyAgentKey(req, businessId))) return unauthorized();
  if (!businessId) {
    return NextResponse.json(
      { error: "missing business_id" },
      { status: 400 },
    );
  }

  const service = createSupabaseServiceClient();

  let query = service
    .from("comandas")
    .select(
      `
      id,
      station_id,
      batch,
      status,
      emitted_at,
      cancelled_at,
      cancelled_reason,
      reprint_requested_at,
      stations!inner(name, printer_ip, printer_port, printer_enabled),
      orders!inner(
        id,
        business_id,
        table_id,
        tables!orders_table_id_fkey(label)
      ),
      comanda_items(
        order_item_id,
        order_items!inner(
          id,
          quantity,
          notes,
          unit_price_cents,
          products(name),
          order_item_modifiers(modifiers(name))
        )
      )
    `,
    )
    // `pendiente` (recién marchada) OR reimpresión pedida (spec 35). Una
    // comanda `en_preparacion`/`entregado` con `reprint_requested_at` seteado
    // vuelve a aparecerle al agente sin cambiar su estado de cocina.
    .or("status.eq.pendiente,reprint_requested_at.not.is.null")
    .eq("orders.business_id", businessId)
    .order("emitted_at", { ascending: true });

  const stationId = url.searchParams.get("station_id");
  if (stationId) {
    query = query.eq("station_id", stationId);
  }

  const { data: comandas, error } = await query;
  if (error) {
    console.error("print-agent GET", error);
    return NextResponse.json({ error: "query failed" }, { status: 500 });
  }

  const printable = (comandas ?? []).map((c) => {
    const order = c.orders as unknown as {
      id: string;
      business_id: string;
      table_id: string | null;
      tables: { label: string } | null;
    };
    const station = c.stations as unknown as {
      name: string;
      printer_ip: string | null;
      printer_port: number;
      printer_enabled: boolean;
    };

    const comanda = {
      comanda_id: c.id,
      station_id: c.station_id,
      station_name: sanitizeTicketText(station?.name) ?? "—",
      // Destino de impresión del sector (spec 28). El agente imprime en esta IP
      // sin mapeo local; si es null, saltea la comanda y la deja `pendiente`.
      printer_ip: station?.printer_ip ?? null,
      printer_port: station?.printer_port ?? 9100,
      printer_enabled: station?.printer_enabled ?? true,
      batch: c.batch,
      emitted_at: c.emitted_at,
      // Spec 049: comanda anulada → el agente imprime un ticket «ANULADA».
      // Campos aditivos: un agente viejo los ignora y reimprime el ticket normal.
      cancelled: Boolean(c.cancelled_at),
      cancelled_reason: sanitizeTicketText(c.cancelled_reason as string | null),
      // Reimpresión pedida (spec 35): editar/reimprimir vuelve a mandar la
      // comanda. El agente imprime un ticket «REIMPRESIÓN» para que cocina sepa
      // que reemplaza a uno anterior. Campo aditivo (un agente viejo lo ignora).
      reprint: Boolean(c.reprint_requested_at),
      table_label: sanitizeTicketText(order?.tables?.label) ?? "—",
      items: ((c.comanda_items ?? []) as unknown[]).map((ci) => {
        const item = ci as {
          order_item_id: string;
          order_items: {
            id: string;
            quantity: number;
            notes: string | null;
            unit_price_cents: number;
            products: { name: string } | null;
            order_item_modifiers: { modifiers: { name: string } | null }[];
          };
        };
        return {
          product_name: sanitizeTicketText(item.order_items?.products?.name) ?? "—",
          quantity: item.order_items?.quantity ?? 1,
          notes: sanitizeTicketText(item.order_items?.notes),
          modifiers: (item.order_items?.order_item_modifiers ?? [])
            .map((m) => sanitizeTicketText(m.modifiers?.name))
            .filter(Boolean),
        };
      }),
    };
    // Spec 051: el server pre-renderiza el ticket (ESC/POS en base64 + texto
    // plano). El agente relay lo imprime tal cual; un agente viejo ignora estos
    // campos y renderiza con su lógica local (aditivo → retrocompat).
    const content = buildComandaContent(comanda);
    return {
      ...comanda,
      content_escpos_b64: content.escpos_b64,
      content_plain: content.plain,
    };
  });

  // ── Controles de pedido (spec 063) ────────────────────────────────────────
  // Viajan en el MISMO array que las comandas, con su propio UUID, su IP y su
  // contenido ya renderizado: para el agente instalado en el local son un ítem
  // más de la lista y no hace falta recompilar nada (D2 del spec).
  const controls = await buildPrintableControlTickets(service, businessId);

  return NextResponse.json({ comandas: [...printable, ...controls] });
}

/**
 * Los controles de pedido `pendiente` (o con reimpresión pedida) del negocio,
 * con la forma que el agente ya sabe consumir. Devuelve `[]` sin ruido si el
 * negocio no tiene comandera de control configurada o la tiene apagada — el
 * resto de la impresión no se entera.
 */
async function buildPrintableControlTickets(
  service: ReturnType<typeof createSupabaseServiceClient>,
  businessId: string,
) {
  const { data: business } = await service
    .from("businesses")
    .select(
      "name, address, phone, control_printer_ip, control_printer_port, control_printer_enabled",
    )
    .eq("id", businessId)
    .maybeSingle();

  const biz = business as {
    name: string;
    address: string | null;
    phone: string | null;
    control_printer_ip: string | null;
    control_printer_port: number | null;
    control_printer_enabled: boolean | null;
  } | null;

  if (!biz || !biz.control_printer_ip?.trim() || biz.control_printer_enabled === false) {
    return [];
  }

  const { data: tickets, error } = await service
    .from("control_tickets")
    .select(
      `
      id,
      status,
      emitted_at,
      reprint_requested_at,
      orders!inner(
        order_number,
        delivery_type,
        customer_name,
        customer_phone,
        delivery_address,
        delivery_notes,
        subtotal_cents,
        delivery_fee_cents,
        discount_cents,
        total_cents,
        payment_method,
        payment_status,
        scheduled_at,
        order_items(
          quantity,
          unit_price_cents,
          notes,
          cancelled_at,
          products(name),
          order_item_modifiers(modifiers(name))
        )
      )
    `,
    )
    .eq("business_id", businessId)
    .or("status.eq.pendiente,reprint_requested_at.not.is.null")
    .order("emitted_at", { ascending: true });

  if (error) {
    // No tumba el GET: las comandas de cocina se devuelven igual.
    console.error("print-agent GET · control_tickets", error);
    return [];
  }

  return (tickets ?? []).map((t) => {
    const order = t.orders as unknown as {
      order_number: number;
      delivery_type: string;
      customer_name: string | null;
      customer_phone: string | null;
      delivery_address: string | null;
      delivery_notes: string | null;
      subtotal_cents: number;
      delivery_fee_cents: number;
      discount_cents: number;
      total_cents: number;
      payment_method: string | null;
      payment_status: string | null;
      scheduled_at: string | null;
      order_items: {
        quantity: number;
        unit_price_cents: number;
        notes: string | null;
        cancelled_at: string | null;
        products: { name: string } | null;
        order_item_modifiers: { modifiers: { name: string } | null }[];
      }[];
    };

    const data: ControlTicketData = {
      control_ticket_id: t.id,
      business_name: sanitizeTicketText(biz.name) ?? "—",
      business_address: sanitizeTicketText(biz.address),
      business_phone: sanitizeTicketText(biz.phone),
      order_number: order.order_number,
      delivery_type: order.delivery_type === "delivery" ? "delivery" : "pickup",
      emitted_at: t.emitted_at,
      scheduled_at: order.scheduled_at,
      customer_name: sanitizeTicketText(order.customer_name),
      customer_phone: sanitizeTicketText(order.customer_phone),
      delivery_address: sanitizeTicketText(order.delivery_address),
      delivery_notes: sanitizeTicketText(order.delivery_notes),
      subtotal_cents: order.subtotal_cents,
      delivery_fee_cents: order.delivery_fee_cents,
      discount_cents: order.discount_cents,
      total_cents: order.total_cents,
      payment_method: order.payment_method,
      payment_status: order.payment_status,
      reprint: Boolean(t.reprint_requested_at),
      items: (order.order_items ?? [])
        // Un ítem anulado no se lleva ni se cobra.
        .filter((it) => !it.cancelled_at)
        .map((it) => ({
          product_name: sanitizeTicketText(it.products?.name) ?? "—",
          quantity: it.quantity,
          line_total_cents: it.unit_price_cents * it.quantity,
          notes: sanitizeTicketText(it.notes),
          modifiers: (it.order_item_modifiers ?? [])
            .map((m) => sanitizeTicketText(m.modifiers?.name))
            .filter(Boolean),
        })),
    };

    const content = buildControlTicketContent(data);
    return {
      // El agente confirma con este id; el POST lo resuelve contra
      // `control_tickets` cuando no está en `comandas`.
      comanda_id: t.id,
      station_id: null,
      station_name: "CONTROL",
      printer_ip: biz.control_printer_ip,
      printer_port: biz.control_printer_port ?? 9100,
      printer_enabled: true,
      batch: 1,
      emitted_at: t.emitted_at,
      cancelled: false,
      cancelled_reason: null,
      reprint: Boolean(t.reprint_requested_at),
      table_label: `#${order.order_number}`,
      items: data.items ?? [],
      content_escpos_b64: content.escpos_b64,
      content_plain: content.plain,
    };
  });
}

/**
 * POST /api/print-agent
 * Body: { comanda_id: string, result?: "ok" | "failed", error?: string }
 *
 * - `result:"ok"` (default, retrocompatible): el agente imprimió → transiciona
 *   `pendiente → en_preparacion` y limpia los flags laterales (fallo +
 *   reimpresión pedida). Si la comanda ya estaba avanzada (reimpresión, spec
 *   35), NO regresa el estado: solo limpia `reprint_requested_at`/`print_failed_at`.
 * - `result:"failed"` (spec 33): el agente no pudo imprimir → setea
 *   `print_failed_at` y avisa (notificación `comanda.impresion_fallida`), una sola
 *   vez por comanda (dedup vía `print_failed_at`). La comanda **no** cambia de
 *   estado (sigue `pendiente`, se reintenta).
 */
export async function POST(req: Request) {
  let body: {
    comanda_id?: string;
    business_id?: string;
    result?: "ok" | "failed";
    error?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  // Auth con el business_id ya parseado (spec 046): acepta key global o del negocio.
  if (!(await verifyAgentKey(req, body.business_id))) return unauthorized();

  // `business_id` obligatorio: es la base del check de ownership de abajo. Antes
  // era opcional y el check se salteaba al omitirlo, dejando transicionar
  // comandas de cualquier negocio con la key global (security review #4).
  if (!body.business_id) {
    return NextResponse.json(
      { error: "missing business_id" },
      { status: 400 },
    );
  }

  const comandaId = body.comanda_id;
  if (!comandaId) {
    return NextResponse.json(
      { error: "missing comanda_id" },
      { status: 400 },
    );
  }
  const result = body.result ?? "ok";

  const service = createSupabaseServiceClient();

  const { data: row } = await service
    .from("comandas")
    .select(
      "id, status, print_failed_at, reprint_requested_at, orders!inner(business_id)",
    )
    .eq("id", comandaId)
    .maybeSingle();

  if (!row) {
    // Spec 063: puede ser un control de pedido. El agente reporta cualquier
    // impresión con el campo `comanda_id`, así que el id se resuelve contra la
    // otra tabla antes de dar por perdido el reporte.
    return handleControlTicketReport(
      service,
      comandaId,
      body.business_id,
      result,
    );
  }

  // Ownership por tenant (spec 36): la key del agente es global, así que
  // validamos que la comanda pertenezca al `business_id` que reporta el agente
  // (el mismo que usa en el GET). Sin esto un agente podría transicionar
  // comandas de OTRO negocio. Se exige cuando el agente lo manda; el agente de
  // referencia lo envía siempre.
  const ownerBusinessId = (row.orders as unknown as { business_id: string })
    .business_id;
  // Incondicional: `business_id` ya es obligatorio (arriba). La comanda debe
  // pertenecer al negocio que el agente reporta.
  if (body.business_id !== ownerBusinessId) {
    return NextResponse.json({ error: "comanda not found" }, { status: 404 });
  }

  // ── Reporte de fallo de impresión (spec 33) ──
  if (result === "failed") {
    // Dedup: si ya quedó marcada como fallida, no re-notificar en cada reintento.
    if (row.print_failed_at) {
      return NextResponse.json({
        status: row.status,
        notified: false,
        alreadyFlagged: true,
      });
    }
    await service
      .from("comandas")
      .update({ print_failed_at: new Date().toISOString() })
      .eq("id", comandaId);
    await notifyPrintFailed({ businessId: ownerBusinessId, comandaId });
    return NextResponse.json({ status: row.status, notified: true });
  }

  // ── Confirmación OK: pendiente → en_preparacion + limpia flags laterales ──
  // Una comanda ya avanzada (reimpresión, spec 35) se confirma sin regresar el
  // estado: solo se limpian `reprint_requested_at` + `print_failed_at`.
  if (row.status !== "pendiente") {
    if (row.print_failed_at || row.reprint_requested_at) {
      await service
        .from("comandas")
        .update({ print_failed_at: null, reprint_requested_at: null })
        .eq("id", comandaId);
    }
    return NextResponse.json({ status: row.status, changed: false });
  }

  const { error } = await service
    .from("comandas")
    .update({
      status: "en_preparacion",
      print_failed_at: null,
      reprint_requested_at: null,
    })
    .eq("id", comandaId);

  if (error) {
    console.error("print-agent confirm", error);
    return NextResponse.json(
      { error: "update failed" },
      { status: 500 },
    );
  }

  return NextResponse.json({ status: "en_preparacion", changed: true });
}

/**
 * Confirmación / fallo de un **control de pedido** (spec 063). Espeja el
 * tratamiento de las comandas: `ok` lo marca impreso y limpia los flags
 * laterales, `failed` setea `print_failed_at` sin cambiar el estado (se
 * reintenta en el próximo pull).
 *
 * A diferencia de la comanda, no notifica: el aviso de impresión fallida (spec
 * 33) está pensado para cocina, y un control que no salió no bloquea la
 * preparación. Queda el flag para verlo.
 */
async function handleControlTicketReport(
  service: ReturnType<typeof createSupabaseServiceClient>,
  ticketId: string,
  businessId: string,
  result: "ok" | "failed",
) {
  const { data } = await service
    .from("control_tickets")
    .select("id, business_id, status, print_failed_at, reprint_requested_at")
    .eq("id", ticketId)
    .maybeSingle();

  const ticket = data as {
    business_id: string;
    status: string;
    print_failed_at: string | null;
    reprint_requested_at: string | null;
  } | null;

  // Mismo mensaje que la comanda: no se le confirma al agente que el id existe
  // pero es de otro negocio (ownership por tenant, spec 36).
  if (!ticket || ticket.business_id !== businessId) {
    return NextResponse.json({ error: "comanda not found" }, { status: 404 });
  }

  if (result === "failed") {
    if (ticket.print_failed_at) {
      return NextResponse.json({
        status: ticket.status,
        notified: false,
        alreadyFlagged: true,
      });
    }
    await service
      .from("control_tickets")
      .update({ print_failed_at: new Date().toISOString() })
      .eq("id", ticketId);
    return NextResponse.json({ status: ticket.status, notified: false });
  }

  const { error } = await service
    .from("control_tickets")
    .update({
      status: "impreso",
      printed_at: new Date().toISOString(),
      print_failed_at: null,
      reprint_requested_at: null,
    })
    .eq("id", ticketId);

  if (error) {
    console.error("print-agent confirm · control", error);
    return NextResponse.json({ error: "update failed" }, { status: 500 });
  }

  return NextResponse.json({ status: "impreso", changed: true });
}
