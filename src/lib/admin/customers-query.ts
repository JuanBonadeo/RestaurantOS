import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import {
  computeSegments,
  matchesSegment,
  type CustomerSegment,
} from "@/lib/customers/segments";
import type { OrderStatus } from "@/lib/orders/status";

/**
 * NOTE for Fase 2/3 (WABA campaign launcher):
 * Phones in `customers.phone` are stored verbatim from what the customer typed
 * in the checkout form. WhatsApp Cloud API requires E.164 (e.g. "+5491155551234").
 * Before we can ship outbound messaging we need to:
 *   1. Add a `phone_e164` column (or normalize-on-write).
 *   2. Run a backfill via `libphonenumber-js`.
 *   3. Reject orders whose phone can't be normalized.
 * For now the list view shows whatever was typed.
 */

const NON_CANCELLED: OrderStatus[] = [
  "pending",
  "confirmed",
  "preparing",
  "ready",
  "on_the_way",
  "delivered",
];

export type CustomerListItem = {
  id: string;
  name: string | null;
  phone: string;
  email: string | null;
  created_at: string;
  order_count: number;
  total_spent_cents: number;
  last_order_at: string | null;
  avg_ticket_cents: number;
  segments: CustomerSegment[];
};

export type CustomerListSort = "spent" | "orders" | "recent" | "name";

export type CustomerListFilters = {
  search?: string;
  segment?: CustomerSegment | "all";
  sort?: CustomerListSort;
  page?: number;
  limit?: number;
};

export type CustomerListResult = {
  customers: CustomerListItem[];
  total: number; // total que matchea el filtro (después de segmentar in-memory)
  page: number;
  pageSize: number;
  pageCount: number;
  topSpenderThresholdCents: number;
};

type CustomerRow = {
  id: string;
  name: string | null;
  phone: string;
  email: string | null;
  created_at: string;
};

type OrderAggRow = {
  customer_id: string | null;
  total_cents: number | string;
  created_at: string;
  status: OrderStatus;
};

/**
 * Returns the list of customers for a business with order aggregates and
 * segmentation chips. We aggregate in JS rather than rely on Postgres GROUP BY
 * because Supabase's PostgREST doesn't expose aggregate functions on FK joins
 * directly without RPC — and the volumes (typically <2k customers/business)
 * make this perfectly fine. If a business grows past ~5k clientes lo migramos
 * a una RPC con GROUP BY o a una vista materializada.
 */
export async function listCustomers(
  businessId: string,
  filters: CustomerListFilters = {},
): Promise<CustomerListResult> {
  const supabase = await createSupabaseServerClient();

  // 1. All customers for this business (the FROM side).
  const { data: customersRaw } = await supabase
    .from("customers")
    .select("id, name, phone, email, created_at")
    .eq("business_id", businessId);

  const customers: CustomerRow[] = customersRaw ?? [];

  if (customers.length === 0) {
    return {
      customers: [],
      total: 0,
      page: 1,
      pageSize: filters.limit ?? 24,
      pageCount: 1,
      topSpenderThresholdCents: 0,
    };
  }

  // 2. All non-cancelled orders for this business — only the columns we need.
  const { data: ordersRaw } = await supabase
    .from("orders")
    .select("customer_id, total_cents, created_at, status")
    .eq("business_id", businessId)
    .in("status", NON_CANCELLED as unknown as string[]);

  const orders: OrderAggRow[] = (ordersRaw ?? []).map((r) => ({
    customer_id: r.customer_id,
    total_cents: Number(r.total_cents),
    created_at: r.created_at,
    status: r.status as OrderStatus,
  }));

  // 3. Group orders by customer.
  const aggregates = new Map<
    string,
    { count: number; sumCents: number; lastAt: string | null }
  >();
  for (const o of orders) {
    if (!o.customer_id) continue;
    const cur = aggregates.get(o.customer_id) ?? {
      count: 0,
      sumCents: 0,
      lastAt: null,
    };
    cur.count += 1;
    cur.sumCents += Number(o.total_cents);
    if (!cur.lastAt || o.created_at > cur.lastAt) cur.lastAt = o.created_at;
    aggregates.set(o.customer_id, cur);
  }

  // 4. Compute top-spender threshold (p90 of customers with orders).
  const totals = Array.from(aggregates.values())
    .map((a) => a.sumCents)
    .filter((v) => v > 0)
    .sort((a, b) => a - b);
  const topSpenderThresholdCents =
    totals.length > 0 ? (totals[Math.floor(totals.length * 0.9)] ?? 0) : 0;

  // 5. Build enriched items with segments.
  const now = new Date();
  let items: CustomerListItem[] = customers.map((c) => {
    const agg = aggregates.get(c.id);
    const order_count = agg?.count ?? 0;
    const total_spent_cents = agg?.sumCents ?? 0;
    const last_order_at = agg?.lastAt ?? null;
    const avg_ticket_cents =
      order_count > 0 ? Math.round(total_spent_cents / order_count) : 0;
    const segments = computeSegments(
      {
        order_count,
        total_spent_cents,
        last_order_at,
        created_at: c.created_at,
      },
      { topSpenderThresholdCents, now },
    );
    return {
      id: c.id,
      name: c.name,
      phone: c.phone,
      email: c.email,
      created_at: c.created_at,
      order_count,
      total_spent_cents,
      last_order_at,
      avg_ticket_cents,
      segments,
    };
  });

  // 6. Apply filters (search + segment).
  if (filters.search && filters.search.trim()) {
    const q = filters.search.trim().toLowerCase();
    items = items.filter(
      (c) =>
        (c.name ?? "").toLowerCase().includes(q) ||
        c.phone.toLowerCase().includes(q) ||
        (c.email ?? "").toLowerCase().includes(q),
    );
  }

  if (filters.segment && filters.segment !== "all") {
    items = items.filter((c) =>
      matchesSegment(
        {
          order_count: c.order_count,
          total_spent_cents: c.total_spent_cents,
          last_order_at: c.last_order_at,
          created_at: c.created_at,
        },
        { topSpenderThresholdCents, now },
        filters.segment!,
      ),
    );
  }

  // 7. Sort.
  const sort = filters.sort ?? "spent";
  items.sort((a, b) => {
    switch (sort) {
      case "spent":
        return b.total_spent_cents - a.total_spent_cents;
      case "orders":
        return b.order_count - a.order_count;
      case "recent":
        return (
          new Date(b.last_order_at ?? 0).getTime() -
          new Date(a.last_order_at ?? 0).getTime()
        );
      case "name":
        return (a.name ?? a.phone).localeCompare(b.name ?? b.phone, "es");
    }
  });

  // 8. Paginate.
  const total = items.length;
  const pageSize = Math.max(1, Math.min(100, filters.limit ?? 24));
  const page = Math.max(1, filters.page ?? 1);
  const start = (page - 1) * pageSize;
  const paginated = items.slice(start, start + pageSize);
  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  return {
    customers: paginated,
    total,
    page,
    pageSize,
    pageCount,
    topSpenderThresholdCents,
  };
}

// ─── Customer detail ─────────────────────────────────────────────────────────

export type CustomerAddress = {
  id: string;
  label: string | null;
  street: string;
  number: string | null;
  apartment: string | null;
  notes: string | null;
};

export type CustomerOrderRow = {
  id: string;
  order_number: number;
  created_at: string;
  status: OrderStatus;
  delivery_type: "delivery" | "pickup";
  total_cents: number;
  payment_method: string;
  payment_status: string;
};

export type CustomerTopProduct = {
  product_name: string;
  quantity: number;
  total_spent_cents: number;
};

export type CustomerDetail = {
  id: string;
  name: string | null;
  phone: string;
  email: string | null;
  created_at: string;
  order_count: number;
  total_spent_cents: number;
  avg_ticket_cents: number;
  last_order_at: string | null;
  days_since_last_order: number | null;
  segments: CustomerSegment[];
  addresses: CustomerAddress[];
  orders: CustomerOrderRow[];
  top_products: CustomerTopProduct[];
  /** spec 141 · US1 — habilitado para fiar. */
  credit_enabled: boolean;
};

const DAY_MS = 24 * 60 * 60 * 1000;

export async function getCustomerDetail(
  businessId: string,
  customerId: string,
): Promise<CustomerDetail | null> {
  const supabase = await createSupabaseServerClient();

  // 1. Customer row (scoped by business_id for safety).
  const { data: customer } = await supabase
    .from("customers")
    .select("id, name, phone, email, created_at, credit_enabled")
    .eq("business_id", businessId)
    .eq("id", customerId)
    .maybeSingle();
  if (!customer) return null;

  // 2. Addresses + orders + items in parallel.
  const [{ data: addrRaw }, { data: orderRaws }] = await Promise.all([
    supabase
      .from("customer_addresses")
      .select("id, label, street, number, apartment, notes")
      .eq("customer_id", customer.id)
      .order("created_at", { ascending: false }),
    supabase
      .from("orders")
      .select(
        "id, order_number, created_at, status, delivery_type, total_cents, payment_method, payment_status, order_items(product_name, quantity, subtotal_cents, cancelled_at)",
      )
      .eq("business_id", businessId)
      .eq("customer_id", customer.id)
      .order("created_at", { ascending: false })
      .limit(50),
  ]);

  const addresses: CustomerAddress[] = (addrRaw ?? []).map((a) => ({
    id: a.id,
    label: a.label,
    street: a.street,
    number: a.number,
    apartment: a.apartment,
    notes: a.notes,
  }));

  const allOrderRows = orderRaws ?? [];

  // 3. Compute aggregates from non-cancelled orders.
  const nonCancelled = allOrderRows.filter(
    (o) => (o.status as OrderStatus) !== "cancelled",
  );
  const order_count = nonCancelled.length;
  const total_spent_cents = nonCancelled.reduce(
    (a, o) => a + Number(o.total_cents),
    0,
  );
  const avg_ticket_cents =
    order_count > 0 ? Math.round(total_spent_cents / order_count) : 0;
  const last_order_at = nonCancelled[0]?.created_at ?? null; // ordered DESC already
  const now = new Date();
  const days_since_last_order = last_order_at
    ? Math.floor((now.getTime() - new Date(last_order_at).getTime()) / DAY_MS)
    : null;

  // 4. Top products: aggregate items across non-cancelled orders.
  const productMap = new Map<
    string,
    { product_name: string; quantity: number; total_spent_cents: number }
  >();
  for (const o of nonCancelled) {
    for (const it of o.order_items ?? []) {
      // issue #190 — lo que el cliente pidió y se anuló no es lo que consume.
      if (it.cancelled_at) continue;
      const cur = productMap.get(it.product_name) ?? {
        product_name: it.product_name,
        quantity: 0,
        total_spent_cents: 0,
      };
      cur.quantity += Number(it.quantity);
      cur.total_spent_cents += Number(it.subtotal_cents);
      productMap.set(it.product_name, cur);
    }
  }
  const top_products = Array.from(productMap.values())
    .sort((a, b) => b.quantity - a.quantity)
    .slice(0, 5);

  // 5. For segments: need the per-business top-spender threshold. Cheap query.
  const { data: spentRows } = await supabase
    .from("orders")
    .select("customer_id, total_cents")
    .eq("business_id", businessId)
    .in("status", NON_CANCELLED as unknown as string[]);
  const totalsByCustomer = new Map<string, number>();
  for (const r of spentRows ?? []) {
    if (!r.customer_id) continue;
    totalsByCustomer.set(
      r.customer_id,
      (totalsByCustomer.get(r.customer_id) ?? 0) + Number(r.total_cents),
    );
  }
  const sortedTotals = Array.from(totalsByCustomer.values()).sort(
    (a, b) => a - b,
  );
  const topSpenderThresholdCents =
    sortedTotals.length > 0
      ? (sortedTotals[Math.floor(sortedTotals.length * 0.9)] ?? 0)
      : 0;

  const segments = computeSegments(
    {
      order_count,
      total_spent_cents,
      last_order_at,
      created_at: customer.created_at,
    },
    { topSpenderThresholdCents, now },
  );

  // 6. Compact orders payload (without items, those are aggregated above).
  const orders: CustomerOrderRow[] = allOrderRows.map((o) => ({
    id: o.id,
    order_number: o.order_number,
    created_at: o.created_at,
    status: o.status as OrderStatus,
    delivery_type: o.delivery_type as "delivery" | "pickup",
    total_cents: Number(o.total_cents),
    payment_method: o.payment_method,
    payment_status: o.payment_status,
  }));

  return {
    id: customer.id,
    name: customer.name,
    phone: customer.phone,
    email: customer.email,
    created_at: customer.created_at,
    credit_enabled: customer.credit_enabled ?? false,
    order_count,
    total_spent_cents,
    avg_ticket_cents,
    last_order_at,
    days_since_last_order,
    segments,
    addresses,
    orders,
    top_products,
  };
}

// ─── Chatbot conversation ──────────────────────────────────────────────────
//
// Devuelve la conversación más reciente del cliente con el chatbot del negocio.
// Hace match por `chatbot_contacts.identifier` con el `phone` del cliente,
// comparando dígitos (los teléfonos vienen en formato libre, "+54 9 11..."
// vs "+5491122..." vs "1122...").

export type CustomerChatbotMessage = {
  role: "user" | "assistant";
  content: string;
  created_at: string;
};

export type CustomerChatbotConversation = {
  conversation_id: string;
  contact_identifier: string;
  contact_display_name: string | null;
  channel: string;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  messages: CustomerChatbotMessage[];
};

export async function getCustomerChatbotConversation(
  businessId: string,
  customerPhone: string,
): Promise<CustomerChatbotConversation | null> {
  const digits = customerPhone.replace(/\D/g, "");
  if (!digits) return null;

  // Las tablas `chatbot_*` tienen RLS habilitado sin policy de SELECT para
  // staff, así que el cliente con cookie devuelve 0 filas. Usamos el service
  // client (igual que el resto del chatbot); el acceso ya está gateado por
  // `ensureAdminAccess` + scoping explícito por `business_id`.
  const supabase = createSupabaseServiceClient();

  // Filtramos por igualdad-de-dígitos en JS para evitar falsos positivos
  // (un identifier "1122" no debería matchear "11221234").
  const { data: contacts } = await supabase
    .from("chatbot_contacts")
    .select("id, identifier, display_name, channel")
    .eq("business_id", businessId);

  const candidates = (contacts ?? []).filter(
    (c) => c.identifier.replace(/\D/g, "") === digits,
  );
  if (candidates.length === 0) return null;

  const contactIds = candidates.map((c) => c.id);
  const { data: convs } = await supabase
    .from("chatbot_conversations")
    .select("id, contact_id, created_at, updated_at, closed_at")
    .in("contact_id", contactIds)
    .order("updated_at", { ascending: false })
    .limit(1);

  const conv = convs?.[0];
  if (!conv) return null;

  const contact =
    candidates.find((c) => c.id === conv.contact_id) ?? candidates[0];

  const { data: msgs } = await supabase
    .from("chatbot_messages")
    .select("role, content, created_at")
    .eq("conversation_id", conv.id)
    .order("created_at", { ascending: true });

  const messages: CustomerChatbotMessage[] = (msgs ?? [])
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
      created_at: m.created_at,
    }));

  return {
    conversation_id: conv.id,
    contact_identifier: contact.identifier,
    contact_display_name: contact.display_name,
    channel: contact.channel,
    created_at: conv.created_at,
    updated_at: conv.updated_at,
    closed_at: conv.closed_at,
    messages,
  };
}

// Para la card de la demo: agarra un cliente con conversación reciente para
// deep-linkear a /admin/clientes/{id}/chatbot. Si ningún cliente matchea, cae
// al cliente más reciente del negocio (la página del chatbot mostrará el
// estado vacío). Usa service client porque la demo es pública (sin auth).
export async function getSampleCustomerForChatbotDemo(
  businessId: string,
): Promise<{ id: string; hasConversation: boolean } | null> {
  const { createSupabaseServiceClient } =
    await import("@/lib/supabase/service");
  const service = createSupabaseServiceClient();

  const { data: convs } = await service
    .from("chatbot_conversations")
    .select("contact_id, updated_at")
    .eq("business_id", businessId)
    .order("updated_at", { ascending: false })
    .limit(50);

  const contactIds = Array.from(
    new Set((convs ?? []).map((c) => c.contact_id).filter(Boolean)),
  );

  if (contactIds.length > 0) {
    const [{ data: contacts }, { data: customers }] = await Promise.all([
      service
        .from("chatbot_contacts")
        .select("id, identifier")
        .in("id", contactIds),
      service
        .from("customers")
        .select("id, phone")
        .eq("business_id", businessId),
    ]);

    const customerByDigits = new Map<string, string>();
    for (const c of customers ?? []) {
      const digits = c.phone.replace(/\D/g, "");
      if (digits && !customerByDigits.has(digits)) {
        customerByDigits.set(digits, c.id);
      }
    }
    const contactsById = new Map(
      (contacts ?? []).map((c) => [c.id, c.identifier] as const),
    );

    for (const conv of convs ?? []) {
      const ident = contactsById.get(conv.contact_id);
      if (!ident) continue;
      const digits = ident.replace(/\D/g, "");
      const customerId = customerByDigits.get(digits);
      if (customerId) return { id: customerId, hasConversation: true };
    }
  }

  const { data: fallback } = await service
    .from("customers")
    .select("id")
    .eq("business_id", businessId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return fallback ? { id: fallback.id, hasConversation: false } : null;
}
