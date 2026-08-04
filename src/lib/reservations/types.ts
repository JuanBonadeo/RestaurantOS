/**
 * Reservation domain types — shared between admin floor-plan editor, customer
 * booking flow, and DB layer. Lives outside `admin/` so the public flow can
 * import without pulling server-only admin deps.
 */

export type TableShape = "circle" | "square" | "rect";
export type TableStatus = "active" | "disabled";

export type FloorPlan = {
  id: string;
  business_id: string;
  name: string;
  width: number;
  height: number;
  background_image_url: string | null;
  background_opacity: number;
  /** Spec 067: las mesas ocupadas de este plano muestran el nombre del cliente
   *  sentado en vez del número de mesa + tiempo abierto. */
  show_customer_name: boolean;
  created_at: string;
  updated_at: string;
};

export type OperationalStatus = "libre" | "ocupada" | "pidio_cuenta";

export type FloorTable = {
  id: string;
  floor_plan_id: string;
  label: string;
  seats: number;
  shape: TableShape;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  status: TableStatus;
  created_at: string;
  // Added in migration 0023 — optional so existing code without these columns compiles
  operational_status?: OperationalStatus;
  current_order_id?: string | null;
  opened_at?: string | null;
  // Added in migration 0029 (CU-09) — mozo asignado actualmente.
  mozo_id?: string | null;
  // Added in migration 0055 (spec 08) — mesa de barra: venta directa, fuera
  // del motor de reservas. Opcional para compilar sin la columna.
  is_bar?: boolean;
};

/**
 * Single day schedule. `slots` are local "HH:MM" strings (business timezone).
 * Empty `slots` + `open: true` = open with no slots configured = no
 * availability that day.
 */
export type DaySchedule = {
  open: boolean;
  slots: string[];
};

/**
 * Keys are day-of-week 0..6 (0=Sunday). Missing keys are treated as closed.
 */
export type WeeklySchedule = Partial<Record<"0" | "1" | "2" | "3" | "4" | "5" | "6", DaySchedule>>;

export type ReservationSettings = {
  business_id: string;
  slot_duration_min: number;
  buffer_min: number;
  lead_time_min: number;
  advance_days_max: number;
  max_party_size: number;
  /** Minutos tras `starts_at` antes de marcar una reserva confirmada como
   *  no_show automáticamente (spec 22). */
  no_show_grace_min: number;
  schedule: WeeklySchedule;
  /** Spec 059 — modo de reservas del negocio. Opcional para compilar sin la
   *  columna (default `estricto` en DB). */
  mode?: ReservationMode;
  updated_at: string;
};

export type ReservationStatus =
  | "confirmed"
  | "seated"
  | "completed"
  | "no_show"
  | "cancelled";

export type ReservationSource = "web" | "admin" | "chatbot";

/**
 * Spec 059 — estrategia de reservas por negocio.
 * - `estricto`: modelo actual (slots fijos + `pickTable` + GIST anti-overlap).
 * - `flexible`: "libro de reservas" (mesa opcional, una por mesa/servicio, la
 *   hora ancla el bloqueo hasta el cierre del servicio, capacidad blanda).
 */
export type ReservationMode = "estricto" | "flexible";

export const RESERVATION_MODES: ReservationMode[] = ["estricto", "flexible"];

/**
 * Spec 059 — un servicio del negocio en modo flexible (ej. Mediodía, Cena),
 * con ventana de atención y umbral de capacidad blanda opcional. Reemplaza los
 * `schedule.slots` del modo estricto. Config por negocio (y opcional por día
 * de semana y por zona).
 */
export type ReservationService = {
  id: string;
  business_id: string;
  name: string;
  /** 0..6 (0=Domingo). null = aplica todos los días. */
  day_of_week: number | null;
  /** "HH:MM" local (TZ del negocio). */
  opens_at: string;
  /** "HH:MM" local. Si es <= `opens_at` se interpreta que cruza medianoche. */
  closes_at: string;
  /**
   * Cupo de cubiertos del servicio. null = sin umbral. Desde la spec 077 es
   * **duro para el cliente** y advisory para el encargado.
   */
  soft_capacity: number | null;
  /**
   * Spec 081 — mesas de la zona que quedan siempre libres para walk-ins. El
   * tope de reservas del servicio es `mesas activas de la zona - hold_tables`.
   * Opcional para compilar sin la columna (default 0 en DB).
   */
  hold_tables?: number;
  /** Zona (floor_plan) a la que aplica el cupo. null = servicio entero. */
  floor_plan_id: string | null;
};

/**
 * "Live" statuses: occupy the table and count against availability. Matches
 * the SQL exclusion constraint filter on reservations_no_overlap.
 */
export const LIVE_RESERVATION_STATUSES: ReservationStatus[] = ["confirmed", "seated"];

export type Reservation = {
  id: string;
  business_id: string;
  table_id: string | null;
  user_id: string | null;
  customer_name: string;
  customer_phone: string;
  party_size: number;
  starts_at: string;
  ends_at: string;
  status: ReservationStatus;
  notes: string | null;
  source: ReservationSource;
  // Spec 059 (modo flexible) — opcionales para compilar sin las columnas.
  /** Servicio (mediodía/cena…) al que pertenece la reserva flexible. */
  service?: string | null;
  /** Zona/salón de una reserva genérica (sin mesa). Las con-mesa derivan la
   *  zona de la mesa. */
  floor_plan_id?: string | null;
  created_at: string;
  updated_at: string;
};

export const DEFAULT_FLOOR_PLAN_WIDTH = 1000;
export const DEFAULT_FLOOR_PLAN_HEIGHT = 700;

export const DEFAULT_RESERVATION_SETTINGS: Omit<ReservationSettings, "business_id" | "updated_at"> = {
  slot_duration_min: 90,
  buffer_min: 15,
  lead_time_min: 60,
  advance_days_max: 30,
  max_party_size: 12,
  no_show_grace_min: 30,
  schedule: {},
};
