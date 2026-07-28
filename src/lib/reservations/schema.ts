import { z } from "zod";

const TIME_HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export const TableShapeSchema = z.enum(["circle", "square", "rect"]);
export const TableStatusSchema = z.enum(["active", "disabled"]);

export const FloorTableInputSchema = z.object({
  id: z.string().uuid().optional(),
  label: z.string().trim().min(1, "El nombre es obligatorio.").max(40),
  seats: z.coerce.number().int().min(1).max(50),
  shape: TableShapeSchema,
  x: z.coerce.number().int(),
  y: z.coerce.number().int(),
  width: z.coerce.number().int().min(20),
  height: z.coerce.number().int().min(20),
  rotation: z.coerce.number().int().min(-360).max(360).default(0),
  status: TableStatusSchema.default("active"),
  // Mesa de barra (spec 08): venta directa, fuera del motor de reservas.
  is_bar: z.boolean().default(false),
});

export const SaveFloorPlanInputSchema = z.object({
  business_slug: z.string().min(1),
  /** Si viene, edita ese floor_plan específico. Si no, comportamiento legacy
   *  (primero existente o crea uno). Necesario para multi-salón. */
  floor_plan_id: z.string().uuid().nullable().optional(),
  name: z.string().trim().min(1).max(60).default("Salón"),
  width: z.coerce.number().int().min(100).max(5000),
  height: z.coerce.number().int().min(100).max(5000),
  background_image_url: z
    .string()
    .url()
    .nullable()
    .optional()
    .transform((v) => v ?? null),
  background_opacity: z.coerce.number().int().min(0).max(100).default(60),
  tables: z.array(FloorTableInputSchema).max(200),
});

export type SaveFloorPlanInput = z.infer<typeof SaveFloorPlanInputSchema>;
export type FloorTableInput = z.infer<typeof FloorTableInputSchema>;

export const DayScheduleSchema = z.object({
  open: z.boolean(),
  slots: z
    .array(z.string().regex(TIME_HHMM, "Formato HH:MM"))
    .max(30),
});

export const WeeklyScheduleSchema = z.record(
  z.enum(["0", "1", "2", "3", "4", "5", "6"]),
  DayScheduleSchema,
);

export const ReservationSettingsInputSchema = z.object({
  business_slug: z.string().min(1),
  slot_duration_min: z.coerce.number().int().min(15).max(600),
  buffer_min: z.coerce.number().int().min(0).max(180),
  lead_time_min: z.coerce.number().int().min(0).max(60 * 24 * 7),
  advance_days_max: z.coerce.number().int().min(1).max(365),
  max_party_size: z.coerce.number().int().min(1).max(100),
  no_show_grace_min: z.coerce.number().int().min(0).max(600),
  schedule: WeeklyScheduleSchema,
  /** Spec 059 — modo de reservas del negocio. Opcional: si no viene, no se toca. */
  mode: z.enum(["estricto", "flexible"]).optional(),
});

export type ReservationSettingsInput = z.infer<typeof ReservationSettingsInputSchema>;

// ── Spec 059 · modo flexible ────────────────────────────────────────────────

/** Cambiar solo el modo de reservas del negocio (toggle en la config). */
export const SetReservationModeInputSchema = z.object({
  business_slug: z.string().min(1),
  mode: z.enum(["estricto", "flexible"]),
});
export type SetReservationModeInput = z.infer<typeof SetReservationModeInputSchema>;

/** Crear/editar un servicio (Mediodía/Cena…) del modo flexible. */
export const ReservationServiceInputSchema = z.object({
  business_slug: z.string().min(1),
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1).max(40),
  /** 0..6 (0=Domingo); null/omitido = todos los días. */
  day_of_week: z.coerce.number().int().min(0).max(6).nullable().optional(),
  opens_at: z.string().regex(TIME_HHMM, "Hora inválida"),
  closes_at: z.string().regex(TIME_HHMM, "Hora inválida"),
  /** Cupo blando (cubiertos) — advisory, no bloquea. null = sin umbral. */
  soft_capacity: z.coerce.number().int().min(1).max(100000).nullable().optional(),
  /** Zona a la que aplica el cupo; null = servicio entero. */
  floor_plan_id: z.string().uuid().nullable().optional(),
});
export type ReservationServiceInput = z.infer<typeof ReservationServiceInputSchema>;

export const DeleteReservationServiceInputSchema = z.object({
  business_slug: z.string().min(1),
  id: z.string().uuid(),
});

/**
 * Alta/edición de un servicio para VARIOS días de una (spec 059). Reemplaza al
 * alta fila-por-día: el grupo se identifica por (nombre, zona) y se reescribe
 * entero, así editar días o horarios es una sola acción — y de paso limpia
 * duplicados del mismo nombre/zona.
 */
export const ReservationServiceGroupInputSchema = z
  .object({
    business_slug: z.string().min(1),
    name: z.string().trim().min(1).max(40),
    /** Nombre anterior, cuando se está renombrando un grupo existente. */
    previous_name: z.string().trim().max(40).optional(),
    /** Días 0..6 (0=Domingo). Ignorado si `every_day` es true. */
    days: z.array(z.coerce.number().int().min(0).max(6)).default([]),
    /** true = una sola fila que aplica a todos los días (day_of_week NULL). */
    every_day: z.boolean().default(false),
    opens_at: z.string().regex(TIME_HHMM, "Hora inválida"),
    closes_at: z.string().regex(TIME_HHMM, "Hora inválida"),
    soft_capacity: z.coerce.number().int().min(1).max(100000).nullable().optional(),
    floor_plan_id: z.string().uuid().nullable().optional(),
  })
  .refine((v) => v.every_day || v.days.length > 0, {
    message: "Elegí al menos un día.",
    path: ["days"],
  });
export type ReservationServiceGroupInput = z.infer<typeof ReservationServiceGroupInputSchema>;

export const DeleteReservationServiceGroupInputSchema = z.object({
  business_slug: z.string().min(1),
  name: z.string().trim().min(1).max(40),
  floor_plan_id: z.string().uuid().nullable().optional(),
});

/**
 * Crear una reserva en modo flexible. La mesa es opcional (genérica → se sienta
 * al llegar), la hora es opcional (sin hora → inicio del servicio). El servicio
 * es obligatorio.
 */
export const CreateFlexibleReservationInputSchema = z.object({
  business_slug: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida (YYYY-MM-DD)"),
  /** Nombre del servicio (matchea reservation_services.name). */
  service: z.string().trim().min(1).max(40),
  /** Hora de llegada (HH:MM). Obligatoria: el local siempre carga la reserva con horario. */
  arrival_time: z
    .string({ error: "Elegí un horario de llegada." })
    .regex(TIME_HHMM, "Hora inválida"),
  party_size: z.coerce.number().int().min(1).max(100),
  /** Mesa puntual (opcional). Si no viene, la reserva es genérica. */
  table_id: z.string().uuid().optional(),
  /** Zona/salón (para genéricas). */
  floor_plan_id: z.string().uuid().optional(),
  customer_name: z.string().trim().min(1).max(80),
  customer_phone: z.string().trim().min(4).max(40),
  notes: z
    .string()
    .trim()
    .max(500)
    .optional()
    .transform((v) => (!v ? null : v)),
  source: z.enum(["web", "chatbot", "admin"]).default("web"),
});
export type CreateFlexibleReservationInput = z.infer<typeof CreateFlexibleReservationInputSchema>;

export const CreateReservationInputSchema = z.object({
  business_slug: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida (YYYY-MM-DD)"),
  slot: z.string().regex(TIME_HHMM, "Hora inválida"),
  party_size: z.coerce.number().int().min(1).max(100),
  customer_name: z.string().trim().min(1).max(80),
  customer_phone: z.string().trim().min(4).max(40),
  notes: z
    .string()
    .trim()
    .max(500)
    .optional()
    .transform((v) => (!v ? null : v)),
  /** Salón elegido cuando el negocio tiene más de uno. Si no viene, el
   *  flujo asume el primer floor_plan (legacy single-salón). */
  floor_plan_id: z.string().uuid().optional(),
  /** Canal de origen del cliente. La web directa no lo manda (default 'web');
   *  el handoff del chatbot lo setea en 'chatbot'. 'admin' no se acepta acá:
   *  los walk-ins van por AdminCreateReservationInputSchema. */
  source: z.enum(["web", "chatbot"]).default("web"),
});

export type CreateReservationInput = z.infer<typeof CreateReservationInputSchema>;

export const AdminCreateReservationInputSchema = CreateReservationInputSchema.extend({
  table_id: z.string().uuid().optional(),
});

export type AdminCreateReservationInput = z.infer<typeof AdminCreateReservationInputSchema>;

export const UpdateReservationStatusInputSchema = z.object({
  business_slug: z.string().min(1),
  id: z.string().uuid(),
  status: z.enum(["confirmed", "seated", "completed", "no_show", "cancelled"]),
});

export const SentarReservaInputSchema = z.object({
  business_slug: z.string().min(1),
  reservation_id: z.string().uuid(),
  /** Spec 059 — mesa elegida al sentar una reserva GENÉRICA (sin mesa fija).
   *  Las reservas con mesa fija la ignoran (usan la suya). */
  table_id: z.string().uuid().optional(),
});

export type UpdateReservationStatusInput = z.infer<typeof UpdateReservationStatusInputSchema>;

export const CancelOwnReservationInputSchema = z.object({
  id: z.string().uuid(),
});

export const UpdateReservationDetailsInputSchema = z.object({
  business_slug: z.string().min(1),
  reservation_id: z.string().uuid(),
  table_id: z.string().uuid(),
  party_size: z.coerce.number().int().min(1).max(100),
});

export type UpdateReservationDetailsInput = z.infer<typeof UpdateReservationDetailsInputSchema>;

export const AvailabilityQuerySchema = z.object({
  business_slug: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida (YYYY-MM-DD)"),
  party_size: z.coerce.number().int().min(1).max(100),
  /** Si viene, restringe los horarios a las mesas de ese salón. */
  floor_plan_id: z.string().uuid().optional(),
});

export const ListSalonesQuerySchema = z.object({
  business_slug: z.string().min(1),
});

/** Spec 059 — disponibilidad del modo flexible: mesas libres + cubiertos de un servicio. */
export const FlexibleAvailabilityQuerySchema = z.object({
  business_slug: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida (YYYY-MM-DD)"),
  service: z.string().trim().min(1).max(40),
  party_size: z.coerce.number().int().min(1).max(100),
  floor_plan_id: z.string().uuid().optional(),
});

export type ListSalonesQuery = z.infer<typeof ListSalonesQuerySchema>;

export type AvailabilityQuery = z.infer<typeof AvailabilityQuerySchema>;
