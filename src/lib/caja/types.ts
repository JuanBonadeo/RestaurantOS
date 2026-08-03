export type Caja = {
  id: string;
  business_id: string;
  name: string;
  is_active: boolean;
  sort_order: number;
  /** Dónde caen los cobros sin cajero (pago online). Máx 1 por negocio. */
  is_default: boolean;
};

export type CajaCorte = {
  id: string;
  caja_id: string;
  business_id: string;
  encargado_id: string;
  expected_cash_cents: number;
  closing_cash_cents: number;
  difference_cents: number;
  closing_notes: string | null;
  denomination_count: Record<string, number> | null;
  created_at: string;
};

export type CajaMovimientoKind = "sangria" | "ingreso";

export type CajaMovimiento = {
  id: string;
  caja_id: string;
  business_id: string;
  kind: CajaMovimientoKind;
  amount_cents: number;
  reason: string | null;
  created_by: string | null;
  created_at: string;
  /** Anulado (spec 070): sigue visible en el libro, no cuenta para el arqueo. */
  cancelled_at: string | null;
  cancelled_reason: string | null;
};

// ── Libro de movimientos (spec 070) ─────────────────────────────

export type LibroTipo = "cobro" | "sangria" | "ingreso";

/**
 * Una línea de caja, sea un cobro o un movimiento. El libro las muestra
 * mezcladas y en orden cronológico, igual que el panel del período — pero con
 * rango, filtros, lo anulado a la vista y la línea accionable.
 */
export type LibroEntry = {
  tipo: LibroTipo;
  id: string;
  created_at: string;
  caja_id: string;
  caja_name: string;
  /** Cobro: lo cobrado (propina incluida). Movimiento: el monto movido. */
  amount_cents: number;
  tip_cents: number;
  method: PaymentMethod | null;
  attributed_mozo_id: string | null;
  attributed_mozo_name: string | null;
  /** Mesa 12 · Juan Pérez · #128, o el motivo de la sangría. */
  descripcion: string;
  order_id: string | null;
  order_number: number | null;
  anulado: boolean;
  anulado_reason: string | null;
  /** Tiene al menos un renglón en `caja_audit_log`. */
  corregido: boolean;
  /** Por qué NO se puede corregir, en castellano. `null` = se puede. */
  bloqueo: string | null;
  /** Corregible, pero con límites (mozo que ya rindió). */
  advertencias: string[];
  /**
   * Comprobante autorizado de la cuenta, si hay. NO limita la corrección del
   * cobro (la factura se emite sobre la cuenta, no sobre el pago): está para
   * poder saltar a él cuando lo que hay que arreglar es el comprobante.
   */
  factura: {
    id: string;
    tipo_comprobante: string;
    punto_venta: number;
    numero: number | null;
  } | null;
};

export type LibroTotales = {
  cobrado_cents: number;
  propinas_cents: number;
  cobros_count: number;
  ingresos_cents: number;
  sangrias_cents: number;
  por_metodo: Record<PaymentMethod, number>;
};

export type LibroFiltros = {
  from: string;
  to: string;
  cajaId?: string | null;
  tipo?: LibroTipo | null;
  method?: PaymentMethod | null;
  mozoId?: string | null;
  search?: string | null;
};

export type CorreccionLog = {
  id: string;
  field: string;
  from_value: string | null;
  to_value: string | null;
  reason: string;
  created_at: string;
  by_name: string | null;
};

export type PaymentMethod =
  | "cash"
  | "card_manual"
  | "mp_link"
  | "mp_qr"
  | "transfer"
  | "other";

/**
 * De dónde vino la plata, derivado de `orders.delivery_type`.
 * Ojo: la venta de mostrador se guarda como `dine_in`, así que hoy cae en
 * `salon` — no está separada.
 */
export type VentaOrigen = "salon" | "delivery" | "takeaway" | "otro";

export type CajaLiveStats = {
  caja_id: string;
  total_ventas_cents: number;
  total_propinas_cents: number;
  ventas_por_metodo: Record<PaymentMethod, number>;
  ventas_por_origen: Record<VentaOrigen, number>;
  cobros_count: number;
  expected_cash_cents: number;
  periodo_desde: string;
};

export type CajaConEstado = Caja & {
  ultimo_corte: CajaCorte | null;
  periodo_desde: string;
};

export type PaymentMethodConfig = {
  id: string;
  business_id: string;
  method: PaymentMethod;
  adjustment_percent: number;
  label: string | null;
  is_active: boolean;
  sort_order: number;
};

export type MozoRendicion = {
  id: string;
  business_id: string;
  mozo_id: string;
  registered_by: string;
  expected_cash_cents: number;
  delivered_cash_cents: number;
  difference_cents: number;
  notes: string | null;
  por_metodo: Record<PaymentMethod, number>;
  created_at: string;
};

export type RendicionMozoPendiente = {
  mozo_id: string;
  mozo_name: string;
  efectivo_cents: number;
  tickets_cents: number;
  por_metodo: Record<PaymentMethod, number>;
  total_propinas_cents: number;
  pagos_count: number;
};

export type CajaUserAssignment = {
  id: string;
  business_id: string;
  caja_id: string;
  user_id: string;
  created_at: string;
};
