"use server";

import { actionError, actionOk, type ActionResult } from "@/lib/actions";
import {
  getAvailability,
  getBusinessBySlug,
  getBusinessSalones,
  getFlexibleAvailability,
  getReservationServices,
  getReservationSettings,
} from "@/lib/reservations/queries";
import {
  AvailabilityQuerySchema,
  FlexibleAvailabilityQuerySchema,
  ListSalonesQuerySchema,
} from "@/lib/reservations/schema";
import type { ReservationMode, ReservationService } from "@/lib/reservations/types";

type AvailableSlotDTO = {
  slot: string;
  starts_at: string;
  ends_at: string;
};

type SalonDTO = { id: string; name: string };

type ReservationContextDTO = {
  mode: ReservationMode;
  services: ReservationService[];
};

type FlexibleAvailabilityDTO = {
  freeTables: Array<{ id: string; label: string; seats: number }>;
  reservedCovers: number;
  softCapacity: number | null;
  overCapacity: boolean;
  available: boolean;
  reason?: string;
};

/**
 * Public-facing action — anonymous users can call this to populate the slot
 * grid before logging in. We use the service client because RLS hides
 * reservations from non-members; reading them is needed to compute who's
 * full but the data leaving here is just a list of "HH:MM" strings, so no
 * customer data leaks.
 */
export async function fetchAvailability(
  input: unknown,
): Promise<ActionResult<AvailableSlotDTO[]>> {
  const parsed = AvailabilityQuerySchema.safeParse(input);
  if (!parsed.success) {
    return actionError(parsed.error.issues[0]?.message ?? "Datos inválidos.");
  }
  const b = await getBusinessBySlug(parsed.data.business_slug);
  if (!b) return actionError("Negocio no encontrado.");

  const slots = await getAvailability(
    b.id,
    b.timezone,
    {
      date: parsed.data.date,
      partySize: parsed.data.party_size,
      floorPlanId: parsed.data.floor_plan_id ?? null,
    },
    { useService: true },
  );

  return actionOk(
    slots.map((s) => ({
      slot: s.slot,
      starts_at: s.starts_at.toISOString(),
      ends_at: s.ends_at.toISOString(),
    })),
  );
}

/**
 * Public-facing action — anonymous users can call this to know if the
 * business has multiple bookable salones. Returns the ordered list
 * `[{id, name}]`. Only salones with at least one active table are included.
 */
export async function fetchBusinessSalones(
  input: unknown,
): Promise<ActionResult<SalonDTO[]>> {
  const parsed = ListSalonesQuerySchema.safeParse(input);
  if (!parsed.success) {
    return actionError(parsed.error.issues[0]?.message ?? "Datos inválidos.");
  }
  const b = await getBusinessBySlug(parsed.data.business_slug);
  if (!b) return actionError("Negocio no encontrado.");

  const salones = await getBusinessSalones(b.id, { useService: true });
  return actionOk(salones);
}

// ── Spec 059 · modo flexible ────────────────────────────────────────────────

/**
 * Contexto de reservas del negocio: modo + servicios configurados. Lo usan las
 * pantallas de reserva (modal del admin, flujo del cliente) para saber si
 * mostrar la grilla de slots (estricto) o el picker de servicios (flexible).
 */
export async function fetchReservationContext(
  input: unknown,
): Promise<ActionResult<ReservationContextDTO>> {
  const parsed = ListSalonesQuerySchema.safeParse(input);
  if (!parsed.success) {
    return actionError(parsed.error.issues[0]?.message ?? "Datos inválidos.");
  }
  const b = await getBusinessBySlug(parsed.data.business_slug);
  if (!b) return actionError("Negocio no encontrado.");

  const [settings, services] = await Promise.all([
    getReservationSettings(b.id, { useService: true }),
    getReservationServices(b.id, { useService: true }),
  ]);
  return actionOk({ mode: (settings.mode ?? "estricto") as ReservationMode, services });
}

/**
 * Disponibilidad del modo flexible para un servicio: mesas libres del servicio
 * + cubiertos reservados (capacidad blanda). Análogo a `fetchAvailability` pero
 * para el libro de reservas.
 */
export async function fetchFlexibleAvailability(
  input: unknown,
): Promise<ActionResult<FlexibleAvailabilityDTO>> {
  const parsed = FlexibleAvailabilityQuerySchema.safeParse(input);
  if (!parsed.success) {
    return actionError(parsed.error.issues[0]?.message ?? "Datos inválidos.");
  }
  const b = await getBusinessBySlug(parsed.data.business_slug);
  if (!b) return actionError("Negocio no encontrado.");

  const avail = await getFlexibleAvailability(
    b.id,
    b.timezone,
    {
      date: parsed.data.date,
      service: parsed.data.service,
      partySize: parsed.data.party_size,
      floorPlanId: parsed.data.floor_plan_id ?? null,
      enforceCapacity: parsed.data.enforce_capacity,
    },
    { useService: true },
  );
  if (!avail) return actionError("Ese servicio no está disponible ese día.");

  return actionOk({
    freeTables: avail.freeTables.map((t) => ({ id: t.id, label: t.label, seats: t.seats })),
    reservedCovers: avail.reservedCovers,
    softCapacity: avail.softCapacity,
    overCapacity: avail.overCapacity,
    available: avail.available,
    reason: avail.reason,
  });
}
