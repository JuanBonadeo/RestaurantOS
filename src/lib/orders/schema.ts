import { z } from "zod";

/**
 * Ítem de carrito. Puede ser un producto normal o un menú del día (combo).
 * Usamos un discriminated union por `kind` — omitirlo defaultea a `"product"`
 * por back-compat con ítems persistidos antes de la feature.
 */
const OrderProductItem = z.object({
  kind: z.literal("product").optional(),
  product_id: z.string().uuid(),
  quantity: z.number().int().min(1).max(99),
  notes: z.string().max(200).optional(),
  modifier_ids: z.array(z.string().uuid()).default([]),
});

const OrderSelectedChoice = z.object({
  choice_group_id: z.string().uuid(),
  choice_group_label: z.string(),
  product_id: z.string().uuid(),
  product_name: z.string(),
  modifier_ids: z.array(z.string().uuid()).default([]),
});

const OrderDailyMenuItem = z.object({
  kind: z.literal("daily_menu"),
  daily_menu_id: z.string().uuid(),
  quantity: z.number().int().min(1).max(99),
  notes: z.string().max(200).optional(),
  selected_choices: z.array(OrderSelectedChoice).default([]),
});

export const OrderItemInput = z.union([OrderProductItem, OrderDailyMenuItem]);
export type OrderItemInput = z.infer<typeof OrderItemInput>;

export const CreateOrderInput = z
  .object({
    business_slug: z.string().min(1),
    delivery_type: z.enum(["delivery", "pickup"]),
    customer_name: z.string().min(1).max(100),
    customer_phone: z.string().min(6).max(20),
    customer_email: z
      .string()
      .email("Email inválido.")
      .max(200)
      .optional(),
    delivery_address: z.string().max(200).optional(),
    delivery_notes: z.string().max(500).optional(),
    payment_method: z.enum(["cash", "mp"]).optional(),
    /**
     * Optional promo code typed by the customer in checkout. The DB lookup
     * is case-insensitive — we don't normalize here. Empty strings are
     * treated as "no code" by persist-order.
     */
    promo_code: z.string().trim().max(40).optional(),
    /**
     * Pedido diferido (spec 31): instante ISO de retiro futuro. Ausente = "para
     * ahora". Las reglas contextuales (horario, anticipación, ventana) se
     * validan server-side con los `business_hours` del negocio en persist-order;
     * acá sólo la coherencia que no necesita contexto.
     */
    scheduled_at: z.string().datetime({ offset: true }).optional(),
    items: z.array(OrderItemInput).min(1),
  })
  .superRefine((data, ctx) => {
    if (data.delivery_type === "delivery" && !data.delivery_address) {
      ctx.addIssue({
        code: "custom",
        message: "Ingresá una dirección de entrega.",
        path: ["delivery_address"],
      });
    }
    // `scheduled_at` no tiene reglas cruzadas acá (spec 061): retiro y delivery
    // se programan con cualquier método de pago. Las reglas que quedan —
    // anticipación, ventana, horario del local, y que `dine_in` no se programa —
    // dependen del negocio (timezone + business_hours) y viven en
    // `validateScheduledOrder`, que corre en `persistOrder`.
  });

export type CreateOrderInput = z.infer<typeof CreateOrderInput>;

/**
 * Input para cargar un pedido para llevar / delivery a mano desde operación
 * (spec 054), más laxo que el público `CreateOrderInput`:
 * - `customer_name` opcional (el mostrador anónimo cae en "Mostrador").
 * - `customer_phone` opcional en pickup (se guarda "-"); requerido en delivery.
 * - sin `scheduled_at` / `promo_code` / `payment_method` (el cobro es aparte,
 *   US3): el pedido nace en efectivo/pendiente y se cobra desde la card.
 * El action `cargarPedidoStaff` mapea esto a `CreateOrderInput` aplicando los
 * defaults antes de llamar a `persistOrder`.
 */
export const StaffOrderInput = z
  .object({
    business_slug: z.string().min(1),
    delivery_type: z.enum(["delivery", "pickup"]),
    customer_name: z.string().max(100).optional(),
    customer_phone: z.string().max(20).optional(),
    delivery_address: z.string().max(200).optional(),
    delivery_notes: z.string().max(500).optional(),
    items: z.array(OrderItemInput).min(1),
  })
  .superRefine((data, ctx) => {
    if (data.delivery_type === "delivery") {
      if (!data.delivery_address || data.delivery_address.trim().length === 0) {
        ctx.addIssue({
          code: "custom",
          message: "Ingresá una dirección de entrega.",
          path: ["delivery_address"],
        });
      }
      if (!data.customer_phone || data.customer_phone.trim().length < 6) {
        ctx.addIssue({
          code: "custom",
          message: "Ingresá un teléfono para el delivery.",
          path: ["customer_phone"],
        });
      }
    }
  });

export type StaffOrderInput = z.infer<typeof StaffOrderInput>;

/**
 * Contrato **interno** de `persistOrder`, más ancho que el público: suma
 * `dine_in` para la venta de mostrador (spec 058), que nace sin mesa y no pasa
 * por el board. El checkout público sigue tipado con `CreateOrderInput` (dos
 * valores) — `CreateOrderInput` es asignable a esto, así que ningún caller
 * existente cambia.
 */
export type PersistableOrderInput = Omit<CreateOrderInput, "delivery_type"> & {
  delivery_type: CreateOrderInput["delivery_type"] | "dine_in";
};

/**
 * Venta rápida de mostrador / kiosko / barra (spec 058): productos reales de la
 * carta, **sin mesa y sin datos de cliente**, que se carga y se cobra en un solo
 * gesto. A diferencia de `StaffOrderInput` (que deja el pedido abierto en el
 * board para triage), acá el cobro viaja en el mismo input porque la venta nace
 * pagada y cerrada.
 *
 * `tip_cents` existe para no cerrarle la puerta al frasco de propinas de la
 * barra, pero la UI de fase 1 manda siempre 0.
 */
export const VentaMostradorInput = z.object({
  business_slug: z.string().min(1),
  items: z.array(OrderItemInput).min(1, "Agregá al menos un producto."),
  method: z.enum(["cash", "card_manual", "transfer", "other"]),
  caja_id: z.string().uuid(),
  tip_cents: z.number().int().min(0).default(0),
  last_four: z.string().length(4).optional(),
  card_brand: z.enum(["visa", "mastercard", "amex", "otro"]).optional(),
  notes: z.string().max(500).optional(),
  /** Clave de idempotencia del intento de cobro (dedup en la RPC, issue #58). */
  request_id: z.string().uuid().optional(),
});

export type VentaMostradorInput = z.infer<typeof VentaMostradorInput>;
