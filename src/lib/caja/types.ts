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
};

export type PaymentMethod =
  | "cash"
  | "card_manual"
  | "mp_link"
  | "mp_qr"
  | "transfer"
  | "other";

export type CajaLiveStats = {
  caja_id: string;
  total_ventas_cents: number;
  total_propinas_cents: number;
  ventas_por_metodo: Record<PaymentMethod, number>;
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
