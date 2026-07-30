"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { formatInTimeZone } from "date-fns-tz";
import { CalendarPlus, Check, Clock, Pencil, Search, UserPlus, X } from "lucide-react";
import { toast } from "sonner";

import { NewReservationModal } from "@/components/admin/local/new-reservation-modal";
import { matchesSalon, reservaSalonId } from "@/lib/admin/salon-filter";
import {
  sentarReserva,
  updateReservationDetails,
  updateReservationStatus,
} from "@/lib/reservations/booking-actions";
import type {
  FloorTable,
  Reservation,
  ReservationStatus,
} from "@/lib/reservations/types";
import { cn } from "@/lib/utils";

// ─── Types ──────────────────────────────────────────────────────────────────

export type AdminRow = Reservation & {
  tables: {
    label: string;
    floor_plans: { id: string; name: string } | null;
  } | null;
};

const STATUS_LABEL: Record<ReservationStatus, string> = {
  confirmed: "Confirmada",
  seated: "En mesa",
  completed: "Completada",
  no_show: "No vino",
  cancelled: "Cancelada",
};

const STATUS_DOT: Record<ReservationStatus, string> = {
  confirmed: "bg-blue-500",
  seated: "bg-emerald-500",
  completed: "bg-zinc-400",
  no_show: "bg-amber-500",
  cancelled: "bg-rose-500",
};

const STATUS_RING: Record<ReservationStatus, string> = {
  confirmed: "bg-blue-50 text-blue-700 ring-blue-200",
  seated: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  completed: "bg-zinc-100 text-zinc-600 ring-zinc-200",
  no_show: "bg-amber-50 text-amber-700 ring-amber-200",
  cancelled: "bg-rose-50 text-rose-700 ring-rose-200",
};

type Filter = "all" | "upcoming" | "seated" | "past";

/* ─── inline icons (kept from original) ─────────────────────────────────── */

const Ic = {
  chevL: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M15 18l-6-6 6-6" />
    </svg>
  ),
  chevR: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 18l6-6-6-6" />
    </svg>
  ),
  square: () => (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="4" width="16" height="16" rx="2" />
    </svg>
  ),
  cog: () => (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09a1.65 1.65 0 00-1-1.51 1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09a1.65 1.65 0 001.51-1 1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
    </svg>
  ),
  phone: () => (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.13.96.36 1.9.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0122 16.92z" />
    </svg>
  ),
  user: () => (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  ),
  globe: () => (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <path d="M2 12h20M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10A15.3 15.3 0 0112 2z" />
    </svg>
  ),
};

/* ─── helpers ────────────────────────────────────────────────────────────── */

function buildDateStrip(centerIso: string) {
  const [y, m, d] = centerIso.split("-").map(Number);
  const out: { iso: string; weekday: string; day: number }[] = [];
  for (let i = -3; i <= 6; i++) {
    const dt = new Date(Date.UTC(y, m - 1, d + i));
    const iso = dt.toISOString().slice(0, 10);
    const weekday = new Intl.DateTimeFormat("es-AR", {
      weekday: "short",
      timeZone: "UTC",
    }).format(dt);
    out.push({
      iso,
      weekday: weekday.replace(".", ""),
      day: dt.getUTCDate(),
    });
  }
  return out;
}

function shiftDate(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "recién";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

const CARD_SHADOW =
  "0 1px 0 rgba(24, 24, 27, 0.02), 0 6px 14px -8px rgba(24, 24, 27, 0.06)";
const ROW_SHADOW =
  "0 1px 0 rgba(24, 24, 27, 0.02), 0 4px 10px -6px rgba(24, 24, 27, 0.05)";

/* ─── main component ─────────────────────────────────────────────────────── */

export function AdminDayList({
  slug,
  date,
  rows: allRows,
  timezone,
  floorPlans,
  activeTables,
  salonIds = [],
  datePath,
}: {
  slug: string;
  date: string;
  rows: AdminRow[];
  timezone: string;
  floorPlans: Array<{ id: string; name: string }>;
  activeTables: FloorTable[];
  /**
   * Spec 065: salones elegidos en `/admin/operacion`. Vacío = sin filtro (es lo
   * que usa la página `/admin/reservas`, que no tiene selector propio).
   */
  salonIds?: string[];
  /**
   * Ruta a la que apunta el navegador de fechas. Default: la página
   * `/admin/reservas`. La tab de Operación pasa `/admin/operacion` para que
   * cambiar de día no la expulse del operativo (`?tab` se preserva solo).
   */
  datePath?: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, start] = useTransition();

  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [showNewReservation, setShowNewReservation] = useState(false);
  const [confirmAction, setConfirmAction] = useState<{
    id: string;
    status: "no_show" | "cancelled";
    customerName: string;
  } | null>(null);

  const multiSalon = floorPlans.length > 1;

  // Spec 065: el filtro por salón se aplica una sola vez, arriba de todo. De
  // acá para abajo `rows` YA es lo del salón elegido, así que los totales de la
  // cabecera, los chips de estado y la lista no pueden discrepar entre sí.
  const rows = useMemo(
    () => allRows.filter((r) => matchesSalon(salonIds, reservaSalonId(r))),
    [allRows, salonIds],
  );

  function setDate(next: string) {
    const params = new URLSearchParams(searchParams);
    params.set("date", next);
    const base = datePath ?? `/${slug}/admin/reservas`;
    router.push(`${base}?${params.toString()}`);
  }

  // ── Actions ──

  function handleSentar(reservationId: string) {
    start(async () => {
      const result = await sentarReserva({
        business_slug: slug,
        reservation_id: reservationId,
      });
      if (result.ok) {
        toast.success("Mesa abierta con reserva.");
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  function handleChangeStatus(id: string, status: ReservationStatus) {
    start(async () => {
      const result = await updateReservationStatus({
        business_slug: slug,
        id,
        status,
      });
      if (result.ok) {
        toast.success("Estado actualizado.");
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  function handleUpdateDetails(
    reservationId: string,
    tableId: string,
    partySize: number,
  ) {
    start(async () => {
      const result = await updateReservationDetails({
        business_slug: slug,
        reservation_id: reservationId,
        table_id: tableId,
        party_size: partySize,
      });
      if (result.ok) {
        toast.success("Reserva actualizada.");
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  function handleConfirmAction() {
    if (!confirmAction) return;
    handleChangeStatus(confirmAction.id, confirmAction.status);
    setConfirmAction(null);
  }

  // ── Computed ──

  const stats = useMemo(() => {
    const now = Date.now();
    const total = rows.length;
    const confirmed = rows.filter((r) => r.status === "confirmed").length;
    const guests = rows.reduce(
      (s, r) =>
        s +
        (r.status === "confirmed" || r.status === "seated"
          ? r.party_size
          : 0),
      0,
    );
    const seated = rows.filter((r) => r.status === "seated").length;
    const noShow = rows.filter((r) => r.status === "no_show").length;
    const cancelled = rows.filter((r) => r.status === "cancelled").length;
    const completed = rows.filter((r) => r.status === "completed").length;
    const upcoming = rows
      .filter(
        (r) =>
          r.status === "confirmed" &&
          new Date(r.starts_at).getTime() > now,
      )
      .sort((a, b) => +new Date(a.starts_at) - +new Date(b.starts_at))[0];
    const nextLabel = upcoming
      ? formatInTimeZone(new Date(upcoming.starts_at), timezone, "HH:mm")
      : "—";
    return { total, confirmed, guests, seated, noShow, cancelled, completed, nextLabel };
  }, [rows, timezone]);

  const filteredRows = useMemo(() => {
    const now = Date.now();
    let filtered = rows.filter((r) => {
      switch (filter) {
        case "upcoming":
          return (
            r.status === "confirmed" &&
            new Date(r.starts_at).getTime() > now - 5 * 60_000
          );
        case "seated":
          return r.status === "seated";
        case "past":
          return ["completed", "no_show", "cancelled"].includes(r.status);
        default:
          return true;
      }
    });
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      filtered = filtered.filter(
        (r) =>
          r.customer_name.toLowerCase().includes(q) ||
          (r.customer_phone && r.customer_phone.toLowerCase().includes(q)),
      );
    }
    return filtered;
  }, [rows, filter, search]);

  const dateStrip = buildDateStrip(date);

  return (
    <div className="space-y-6">
      {/* ── KPI row ──────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiCard label="Reservas" value={String(stats.total)} />
        <KpiCard
          label="Comensales"
          value={String(stats.guests)}
          sub={
            stats.confirmed > 0 && stats.seated > 0
              ? `${stats.confirmed} conf · ${stats.seated} mesa`
              : undefined
          }
        />
        <KpiCard
          label="En mesa"
          value={String(stats.seated)}
          accent={stats.seated > 0}
        />
        <KpiCard label="Próxima" value={stats.nextLabel} mono />
      </div>

      {/* Secondary stats: no-show + cancelled (solo si hubo) */}
      {(stats.noShow > 0 || stats.cancelled > 0 || stats.completed > 0) && (
        <div className="flex flex-wrap gap-3 px-1 text-xs text-zinc-500">
          {stats.completed > 0 && (
            <span>
              ✓ {stats.completed} completada{stats.completed > 1 ? "s" : ""}
            </span>
          )}
          {stats.noShow > 0 && (
            <span className="text-amber-700">
              ⚠ {stats.noShow} no vino
            </span>
          )}
          {stats.cancelled > 0 && (
            <span className="text-rose-600">
              ✕ {stats.cancelled} cancelada{stats.cancelled > 1 ? "s" : ""}
            </span>
          )}
        </div>
      )}

      {/* ── Date navigator + search + actions ────────────────────────────── */}
      <div
        className="rounded-2xl bg-white p-4 ring-1 ring-zinc-200/70"
        style={{ boxShadow: CARD_SHADOW }}
      >
        {/* Row 1: date nav + links */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setDate(shiftDate(date, -1))}
              className="grid h-8 w-8 place-items-center rounded-full text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900 active:scale-95"
              aria-label="Día anterior"
            >
              <Ic.chevL />
            </button>
            <button
              type="button"
              onClick={() => setDate(shiftDate(date, 1))}
              className="grid h-8 w-8 place-items-center rounded-full text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900 active:scale-95"
              aria-label="Día siguiente"
            >
              <Ic.chevR />
            </button>
          </div>

          <div className="no-scrollbar -mx-1 flex flex-1 gap-1.5 overflow-x-auto px-1">
            {dateStrip.map((d) => {
              const active = d.iso === date;
              return (
                <button
                  key={d.iso}
                  type="button"
                  onClick={() => setDate(d.iso)}
                  className={cn(
                    "relative my-1 flex min-w-[52px] flex-col items-center rounded-xl px-2.5 py-2 ring-1 transition active:scale-[0.97]",
                    active
                      ? "bg-zinc-900 text-white ring-zinc-900"
                      : "bg-white text-zinc-700 ring-zinc-200 hover:bg-zinc-50",
                  )}
                >
                  <span className="text-[10px] uppercase tracking-[0.14em] opacity-70">
                    {d.weekday}
                  </span>
                  <span className="font-mono text-base font-semibold tabular-nums">
                    {d.day}
                  </span>
                </button>
              );
            })}
          </div>

          <label className="relative">
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="absolute inset-0 cursor-pointer opacity-0"
            />
            <span className="inline-flex h-8 cursor-pointer items-center rounded-full bg-zinc-100 px-3 text-[11px] font-medium uppercase tracking-[0.14em] text-zinc-600 hover:bg-zinc-200">
              Saltar
            </span>
          </label>

          <div className="hidden h-6 w-px bg-zinc-200 sm:block" />

          <button
            type="button"
            onClick={() => setShowNewReservation(true)}
            className="inline-flex h-9 items-center gap-1.5 rounded-full bg-blue-600 px-4 text-xs font-semibold text-white shadow-sm transition hover:bg-blue-700 active:scale-[0.97]"
          >
            <CalendarPlus className="h-4 w-4" />
            Nueva reserva
          </button>

          <Link
            href={`/${slug}/admin/reservas/configuracion`}
            className="inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[11px] font-medium uppercase tracking-[0.14em] text-zinc-700 ring-1 ring-zinc-200 transition hover:bg-zinc-50"
          >
            <Ic.cog /> Config
          </Link>
        </div>

        {/* Row 2: search + filter tabs */}
        <div className="mt-3 flex flex-wrap items-center gap-3">
          {/* Search */}
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por nombre o teléfono…"
              className="h-8 w-56 rounded-full border-0 bg-zinc-100 pl-8 pr-8 text-xs text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-300"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-0.5 text-zinc-400 hover:text-zinc-700"
                aria-label="Limpiar búsqueda"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>

          {/* Filter tabs */}
          <div
            className="inline-flex rounded-full bg-zinc-100/80 p-1 ring-1 ring-zinc-200/60"
            role="tablist"
          >
            {(
              [
                { v: "all", l: `Todas (${rows.length})` },
                { v: "upcoming", l: "Próximas" },
                { v: "seated", l: "En mesa" },
                { v: "past", l: "Pasadas" },
              ] as { v: Filter; l: string }[]
            ).map((opt) => {
              const active = filter === opt.v;
              return (
                <button
                  key={opt.v}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setFilter(opt.v)}
                  className={cn(
                    "rounded-full px-3.5 py-1.5 text-xs font-medium transition",
                    active
                      ? "bg-white text-zinc-900 shadow-[0_1px_2px_rgba(24,24,27,0.06),0_4px_10px_-6px_rgba(24,24,27,0.18)]"
                      : "text-zinc-500 hover:text-zinc-900",
                  )}
                >
                  {opt.l}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* ── List ─────────────────────────────────────────────────────────── */}
      {filteredRows.length === 0 ? (
        <EmptyState filter={filter} search={search} />
      ) : (
        <ul className="space-y-2.5">
          {filteredRows.map((r) => (
            <ReservationRow
              key={r.id}
              row={r}
              timezone={timezone}
              pending={pending}
              multiSalon={multiSalon}
              activeTables={activeTables}
              floorPlans={floorPlans}
              onSentar={() => handleSentar(r.id)}
              onComplete={() => handleChangeStatus(r.id, "completed")}
              onNoShow={() =>
                setConfirmAction({
                  id: r.id,
                  status: "no_show",
                  customerName: r.customer_name,
                })
              }
              onCancel={() =>
                setConfirmAction({
                  id: r.id,
                  status: "cancelled",
                  customerName: r.customer_name,
                })
              }
              onUpdateDetails={(tableId, partySize) =>
                handleUpdateDetails(r.id, tableId, partySize)
              }
            />
          ))}
        </ul>
      )}

      {/* ── Modales ──────────────────────────────────────────────────────── */}
      {showNewReservation && (
        <NewReservationModal
          slug={slug}
          tables={activeTables}
          floorPlanId={null}
          onClose={() => setShowNewReservation(false)}
        />
      )}

      {/* Confirm dialog para acciones destructivas */}
      {confirmAction && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40"
          onClick={() => setConfirmAction(null)}
        >
          <div
            className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-base font-bold text-zinc-900">
              {confirmAction.status === "no_show"
                ? "¿Marcar como no vino?"
                : "¿Cancelar reserva?"}
            </h3>
            <p className="mt-1.5 text-sm text-zinc-600">
              {confirmAction.status === "no_show" ? (
                <>
                  La reserva de{" "}
                  <span className="font-semibold">{confirmAction.customerName}</span>{" "}
                  se marcará como no vino. La mesa queda disponible.
                </>
              ) : (
                <>
                  La reserva de{" "}
                  <span className="font-semibold">{confirmAction.customerName}</span>{" "}
                  se cancelará. Esta acción no se puede deshacer.
                </>
              )}
            </p>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => setConfirmAction(null)}
                disabled={pending}
                className="flex-1 rounded-xl bg-zinc-100 px-4 py-2.5 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-200 disabled:opacity-60"
              >
                Volver
              </button>
              <button
                type="button"
                onClick={handleConfirmAction}
                disabled={pending}
                className={cn(
                  "flex-1 rounded-xl px-4 py-2.5 text-sm font-semibold text-white transition disabled:opacity-60",
                  confirmAction.status === "no_show"
                    ? "bg-amber-600 hover:bg-amber-700"
                    : "bg-rose-600 hover:bg-rose-700",
                )}
              >
                {confirmAction.status === "no_show" ? "No vino" : "Cancelar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── KPI Card ───────────────────────────────────────────────────────────── */

function KpiCard({
  label,
  value,
  sub,
  mono,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  mono?: boolean;
  accent?: boolean;
}) {
  return (
    <div
      className="relative overflow-hidden rounded-2xl bg-white p-4 ring-1 ring-zinc-200/70"
      style={{ boxShadow: CARD_SHADOW }}
    >
      {accent ? (
        <span className="absolute right-3 top-3 grid h-2 w-2 place-items-center">
          <span className="absolute h-2 w-2 animate-ping rounded-full bg-emerald-500/40" />
          <span className="relative h-1.5 w-1.5 rounded-full bg-emerald-500" />
        </span>
      ) : null}
      <p className="text-[0.65rem] font-semibold uppercase tracking-[0.18em] text-zinc-500">
        {label}
      </p>
      <p
        className={cn(
          "mt-1.5 text-3xl font-semibold tracking-tight text-zinc-900",
          mono && "font-mono tabular-nums",
        )}
      >
        {value}
      </p>
      {sub && (
        <p className="mt-0.5 text-[10px] font-medium text-zinc-400">{sub}</p>
      )}
    </div>
  );
}

/* ─── Reservation Row ────────────────────────────────────────────────────── */

function ReservationRow({
  row,
  timezone,
  pending,
  multiSalon,
  activeTables,
  floorPlans,
  onSentar,
  onComplete,
  onNoShow,
  onCancel,
  onUpdateDetails,
}: {
  row: AdminRow;
  timezone: string;
  pending: boolean;
  multiSalon: boolean;
  activeTables: FloorTable[];
  floorPlans: Array<{ id: string; name: string }>;
  onSentar: () => void;
  onComplete: () => void;
  onNoShow: () => void;
  onCancel: () => void;
  onUpdateDetails: (tableId: string, partySize: number) => void;
}) {
  const timeStart = formatInTimeZone(
    new Date(row.starts_at),
    timezone,
    "HH:mm",
  );
  const timeEnd = formatInTimeZone(
    new Date(row.ends_at),
    timezone,
    "HH:mm",
  );
  const isSoftClosed = ["completed", "no_show", "cancelled"].includes(
    row.status,
  );
  const salonName = row.tables?.floor_plans?.name ?? null;
  const ago = timeAgo(row.created_at);

  // Build floor_plan lookup for table labels
  const floorPlanMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const fp of floorPlans) map.set(fp.id, fp.name);
    return map;
  }, [floorPlans]);

  const [editing, setEditing] = useState(false);
  const [editPartySize, setEditPartySize] = useState(row.party_size);
  const [editTableId, setEditTableId] = useState(row.table_id ?? "");

  function openEdit() {
    setEditPartySize(row.party_size);
    setEditTableId(row.table_id ?? "");
    setEditing(true);
  }

  function handleSave() {
    if (!editTableId) return;
    onUpdateDetails(editTableId, editPartySize);
    setEditing(false);
  }

  return (
    <li
      className={cn(
        "group relative rounded-2xl bg-white p-4 ring-1 ring-zinc-200/70 transition hover:ring-zinc-300",
        isSoftClosed && "opacity-65 hover:opacity-90",
      )}
      style={{ boxShadow: ROW_SHADOW }}
    >
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
        {/* Time range */}
        <div className="flex w-24 flex-col">
          <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-400">
            Hora
          </span>
          <span className="font-mono text-2xl font-semibold tabular-nums tracking-tight text-zinc-900">
            {timeStart}
          </span>
          <span className="font-mono text-xs tabular-nums text-zinc-400">
            → {timeEnd}
          </span>
        </div>

        <div className="h-10 w-px bg-zinc-200/80" />

        {/* Customer + meta */}
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 text-[15px] font-semibold text-zinc-900">
            <Ic.user />
            <span className="truncate">{row.customer_name}</span>
          </p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-500">
            <span className="font-medium text-zinc-700">
              {row.party_size}p
              {row.tables ? ` · ${row.tables.label}` : ""}
              {multiSalon && salonName ? ` · ${salonName}` : ""}
            </span>
            {row.customer_phone ? (
              <a
                href={`tel:${row.customer_phone}`}
                className="inline-flex items-center gap-1 hover:text-zinc-900 hover:underline"
              >
                <Ic.phone />
                {row.customer_phone}
              </a>
            ) : null}
          </p>
          {/* Notes + source + created */}
          <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1">
            {row.notes ? (
              <span className="max-w-[260px] truncate text-[11px] italic text-zinc-500">
                &ldquo;{row.notes}&rdquo;
              </span>
            ) : null}
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium ring-1",
                row.source === "web"
                  ? "bg-sky-50 text-sky-700 ring-sky-200"
                  : "bg-zinc-100 text-zinc-600 ring-zinc-200",
              )}
            >
              {row.source === "web" ? <Ic.globe /> : <Ic.user />}
              {row.source === "web" ? "Web" : "Admin"}
            </span>
            <span className="text-[10px] text-zinc-400" title={row.created_at}>
              {ago}
            </span>
          </div>
        </div>

        {/* Status */}
        <span
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium ring-1",
            STATUS_RING[row.status],
          )}
        >
          <span
            className={cn("h-1.5 w-1.5 rounded-full", STATUS_DOT[row.status])}
          />
          {STATUS_LABEL[row.status]}
        </span>

        {/* Actions */}
        <div className="flex flex-wrap items-center gap-2">
          {row.status === "confirmed" && !editing && (
            <>
              <button
                type="button"
                onClick={onSentar}
                disabled={pending}
                className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-emerald-600 px-3.5 text-xs font-semibold text-white shadow-sm transition hover:bg-emerald-700 active:scale-[0.97] disabled:opacity-60"
              >
                <UserPlus className="h-3.5 w-3.5" />
                Sentar
              </button>
              <button
                type="button"
                onClick={openEdit}
                disabled={pending}
                className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-zinc-100 px-3 text-xs font-semibold text-zinc-700 ring-1 ring-zinc-200 transition hover:bg-zinc-200 active:scale-[0.97] disabled:opacity-60"
              >
                <Pencil className="h-3.5 w-3.5" />
                Editar
              </button>
              <button
                type="button"
                onClick={onNoShow}
                disabled={pending}
                className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-amber-50 px-3 text-xs font-semibold text-amber-800 ring-1 ring-amber-200 transition hover:bg-amber-100 active:scale-[0.97] disabled:opacity-60"
              >
                <Clock className="h-3.5 w-3.5" />
                No vino
              </button>
              <button
                type="button"
                onClick={onCancel}
                disabled={pending}
                className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-rose-50 px-3 text-xs font-semibold text-rose-700 ring-1 ring-rose-200 transition hover:bg-rose-100 active:scale-[0.97] disabled:opacity-60"
              >
                <X className="h-3.5 w-3.5" />
                Cancelar
              </button>
            </>
          )}
          {row.status === "seated" && (
            <button
              type="button"
              onClick={onComplete}
              disabled={pending}
              className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-emerald-600 px-3.5 text-xs font-semibold text-white shadow-sm transition hover:bg-emerald-700 active:scale-[0.97] disabled:opacity-60"
            >
              <Check className="h-3.5 w-3.5" />
              Completar
            </button>
          )}
        </div>
      </div>

      {/* ── Inline edit panel ─────────────────────────────────────────── */}
      {editing && (
        <div className="mt-3 flex flex-wrap items-end gap-3 rounded-xl bg-zinc-50 p-3 ring-1 ring-zinc-200/60">
          <div>
            <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
              Comensales
            </label>
            <input
              type="number"
              min={1}
              max={100}
              value={editPartySize}
              onChange={(e) => {
                const v = parseInt(e.target.value, 10);
                if (!Number.isNaN(v) && v >= 1) setEditPartySize(v);
              }}
              className="h-9 w-16 rounded-xl border-0 bg-white px-2 text-center text-sm font-semibold tabular-nums text-zinc-900 ring-1 ring-zinc-200 focus:outline-none focus:ring-2 focus:ring-emerald-300"
            />
          </div>
          <div className="min-w-0 flex-1">
            <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
              Mesa
            </label>
            <select
              value={editTableId}
              onChange={(e) => setEditTableId(e.target.value)}
              className="h-9 w-full max-w-[240px] rounded-xl border-0 bg-white px-2.5 text-sm font-medium text-zinc-900 ring-1 ring-zinc-200 focus:outline-none focus:ring-2 focus:ring-emerald-300"
            >
              {!editTableId && (
                <option value="" disabled>
                  Elegir mesa…
                </option>
              )}
              {activeTables.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label} ({t.seats}p)
                  {multiSalon
                    ? ` — ${floorPlanMap.get(t.floor_plan_id) ?? ""}`
                    : ""}
                </option>
              ))}
            </select>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleSave}
              disabled={pending || !editTableId}
              className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-zinc-900 px-4 text-xs font-semibold text-white shadow-sm transition hover:bg-zinc-800 active:scale-[0.97] disabled:opacity-50"
            >
              <Check className="h-3.5 w-3.5" />
              Guardar
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              disabled={pending}
              className="inline-flex h-9 items-center rounded-xl bg-white px-3 text-xs font-semibold text-zinc-600 ring-1 ring-zinc-200 transition hover:bg-zinc-100 active:scale-[0.97] disabled:opacity-50"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}
    </li>
  );
}

/* ─── Empty State ────────────────────────────────────────────────────────── */

function EmptyState({ filter, search }: { filter: Filter; search: string }) {
  const message = search
    ? `Sin resultados para "${search}".`
    : filter === "all"
      ? "No hay reservas para esta fecha."
      : filter === "upcoming"
        ? "No hay reservas próximas."
        : filter === "seated"
          ? "Nadie sentado en este momento."
          : "Sin reservas pasadas hoy.";
  return (
    <div
      className="rounded-2xl bg-white p-12 text-center ring-1 ring-dashed ring-zinc-300"
      style={{ boxShadow: "0 1px 0 rgba(24, 24, 27, 0.02)" }}
    >
      <div
        className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-zinc-100 text-zinc-400 ring-1 ring-zinc-200"
        aria-hidden
      >
        {search ? (
          <Search className="h-5 w-5" />
        ) : (
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect x="3" y="5" width="18" height="16" rx="2" />
            <path d="M3 10h18M8 3v4M16 3v4" />
          </svg>
        )}
      </div>
      <p className="mt-4 text-sm font-medium text-zinc-700">{message}</p>
      <p className="mt-1 text-xs text-zinc-500">
        {search
          ? "Probá con otro nombre o teléfono."
          : "Probá saltar a otra fecha o cambiar el filtro."}
      </p>
    </div>
  );
}
