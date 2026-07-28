"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarPlus, Loader2, Minus, Plus } from "lucide-react";
import { toast } from "sonner";

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  fetchAvailability,
  fetchFlexibleAvailability,
  fetchReservationContext,
} from "@/lib/reservations/availability-actions";
import {
  createFlexibleReservation,
  createReservationFromAdmin,
} from "@/lib/reservations/booking-actions";
import { arrivalSlots } from "@/lib/reservations/flexible-availability";
import { buscarClientes, type ClienteMatch } from "@/lib/admin/customers-actions";
import type { FloorTable, ReservationMode, ReservationService } from "@/lib/reservations/types";

type Slot = { slot: string; starts_at: string; ends_at: string };
type FreeTable = { id: string; label: string; seats: number };

type Props = {
  slug: string;
  tables: FloorTable[];
  floorPlanId: string | null;
  onClose: () => void;
};

const INPUT_CLS =
  "mt-1 h-12 w-full rounded-xl border border-zinc-200 bg-white px-3 text-base focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100";
const LABEL_CLS = "text-[11px] font-bold uppercase tracking-wider text-zinc-500";

function todayISO(): string {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function maxDateISO(days: number): string {
  const d = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

export function NewReservationModal({ slug, tables, floorPlanId, onClose }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  // Datos compartidos.
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [partySize, setPartySize] = useState(2);
  const [date, setDate] = useState(todayISO());
  const [notes, setNotes] = useState("");
  const [tableId, setTableId] = useState<string | undefined>(undefined);

  // Buscar cliente existente (reusa buscarClientes de spec 054).
  const [clientQuery, setClientQuery] = useState("");
  const [clientResults, setClientResults] = useState<ClienteMatch[]>([]);

  // Modo + servicios (spec 059). mode=null → cargando.
  const [mode, setMode] = useState<ReservationMode | null>(null);
  const [services, setServices] = useState<ReservationService[]>([]);

  // Estricto: slots.
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);

  // Flexible: servicio + hora opcional + mesas libres + cubiertos.
  const [service, setService] = useState<string>("");
  const [arrivalTime, setArrivalTime] = useState<string>("");
  const [flexTables, setFlexTables] = useState<FreeTable[]>([]);
  const [flexInfo, setFlexInfo] = useState<{
    reservedCovers: number;
    softCapacity: number | null;
    overCapacity: boolean;
  } | null>(null);
  const [loadingFlex, setLoadingFlex] = useState(false);

  // Contexto de modo al abrir.
  useEffect(() => {
    fetchReservationContext({ business_slug: slug }).then((r) => {
      if (r.ok) {
        setMode(r.data.mode);
        setServices(r.data.services);
      } else {
        setMode("estricto");
      }
    });
  }, [slug]);

  // Búsqueda de cliente existente (debounce 300ms). Reusa buscarClientes.
  useEffect(() => {
    const q = clientQuery.trim();
    if (q.length < 2) {
      setClientResults([]);
      return;
    }
    const t = setTimeout(async () => {
      const r = await buscarClientes(slug, q);
      setClientResults(r.ok ? r.data : []);
    }, 300);
    return () => clearTimeout(t);
  }, [clientQuery, slug]);

  function pickCliente(c: ClienteMatch) {
    setName(c.name ?? "");
    setPhone(c.phone);
    setClientQuery("");
    setClientResults([]);
  }

  // Servicios aplicables a la fecha elegida (día exacto o "todos los días").
  const serviceNames = useMemo(() => {
    const dow = new Date(
      Date.UTC(
        Number(date.slice(0, 4)),
        Number(date.slice(5, 7)) - 1,
        Number(date.slice(8, 10)),
      ),
    ).getUTCDay();
    const applicable = services.filter((s) => s.day_of_week == null || s.day_of_week === dow);
    return Array.from(new Set(applicable.map((s) => s.name)));
  }, [services, date]);

  const selectedServiceRow = useMemo(() => {
    if (!service) return null;
    const dow = new Date(
      Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10))),
    ).getUTCDay();
    const matches = services.filter((s) => s.name === service);
    return (
      matches.find((s) => s.day_of_week === dow) ??
      matches.find((s) => s.day_of_week == null) ??
      matches[0] ??
      null
    );
  }, [services, service, date]);

  const arrivalOptions = useMemo(
    () =>
      selectedServiceRow
        ? arrivalSlots(selectedServiceRow.opens_at, selectedServiceRow.closes_at)
        : [],
    [selectedServiceRow],
  );

  useEffect(() => {
    if (mode === "flexible" && serviceNames.length > 0 && !serviceNames.includes(service)) {
      setService(serviceNames[0]);
    }
  }, [mode, serviceNames, service]);

  // Estricto: slots por fecha + party.
  useEffect(() => {
    if (mode !== "estricto" || !date || partySize < 1) return;
    setLoadingSlots(true);
    setSelectedSlot(null);
    fetchAvailability({
      business_slug: slug,
      date,
      party_size: partySize,
      ...(floorPlanId ? { floor_plan_id: floorPlanId } : {}),
    }).then((r) => {
      setLoadingSlots(false);
      setSlots(r.ok ? r.data : []);
    });
  }, [mode, slug, date, partySize, floorPlanId]);

  // Flexible: mesas libres + cubiertos del servicio.
  useEffect(() => {
    if (mode !== "flexible" || !service) {
      setFlexTables([]);
      setFlexInfo(null);
      return;
    }
    setLoadingFlex(true);
    setTableId(undefined);
    fetchFlexibleAvailability({
      business_slug: slug,
      date,
      service,
      party_size: partySize,
      ...(floorPlanId ? { floor_plan_id: floorPlanId } : {}),
    }).then((r) => {
      setLoadingFlex(false);
      if (r.ok) {
        setFlexTables(r.data.freeTables);
        setFlexInfo({
          reservedCovers: r.data.reservedCovers,
          softCapacity: r.data.softCapacity,
          overCapacity: r.data.overCapacity,
        });
      } else {
        setFlexTables([]);
        setFlexInfo(null);
      }
    });
  }, [mode, slug, date, service, partySize, floorPlanId]);

  const baseValid = name.trim().length > 0 && phone.trim().length >= 4 && !pending;
  const canSubmit =
    mode === "flexible"
      ? baseValid && service.length > 0 && arrivalTime.length > 0
      : baseValid && selectedSlot !== null;

  const handleSubmit = () => {
    if (!canSubmit) return;
    startTransition(async () => {
      const result =
        mode === "flexible"
          ? await createFlexibleReservation({
              business_slug: slug,
              date,
              service,
              party_size: partySize,
              customer_name: name.trim(),
              customer_phone: phone.trim(),
              notes: notes.trim() || undefined,
              source: "admin",
              ...(arrivalTime ? { arrival_time: arrivalTime } : {}),
              ...(tableId ? { table_id: tableId } : {}),
              ...(floorPlanId ? { floor_plan_id: floorPlanId } : {}),
            })
          : await createReservationFromAdmin({
              business_slug: slug,
              date,
              slot: selectedSlot!,
              party_size: partySize,
              customer_name: name.trim(),
              customer_phone: phone.trim(),
              notes: notes.trim() || undefined,
              ...(floorPlanId ? { floor_plan_id: floorPlanId } : {}),
              ...(tableId ? { table_id: tableId } : {}),
            });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Reserva creada.");
      router.refresh();
      onClose();
    });
  };

  const freeTablesEstricto = tables.filter(
    (t) => t.status === "active" && (t.operational_status ?? "libre") === "libre",
  );

  return (
    <Sheet
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <SheetContent side="bottom" className="max-h-[90vh] rounded-t-3xl sm:mx-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle className="font-heading flex items-center gap-2 text-lg font-bold">
            <CalendarPlus className="h-5 w-5 text-blue-600" />
            Nueva reserva
          </SheetTitle>
          <SheetDescription>
            {mode === "flexible"
              ? "Libro de reservas — mesa y hora opcionales."
              : "Crea una reserva manual desde el admin."}
          </SheetDescription>
        </SheetHeader>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSubmit();
          }}
          className="flex min-h-0 flex-1 flex-col"
        >
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 pb-4">
            {/* Buscar cliente existente */}
            <div className="relative">
              <label className={LABEL_CLS}>Buscar cliente</label>
              <input
                value={clientQuery}
                onChange={(e) => setClientQuery(e.target.value)}
                className={INPUT_CLS}
                placeholder="Nombre o teléfono…"
              />
              {clientResults.length > 0 ? (
                <ul className="absolute z-20 mt-1 max-h-48 w-full overflow-auto rounded-xl border border-zinc-200 bg-white shadow-lg">
                  {clientResults.map((c) => (
                    <li key={c.id}>
                      <button
                        type="button"
                        onClick={() => pickCliente(c)}
                        className="flex w-full flex-col items-start px-3 py-2 text-left hover:bg-zinc-50"
                      >
                        <span className="text-sm font-medium text-zinc-900">
                          {c.name ?? "Sin nombre"}
                        </span>
                        <span className="text-xs text-zinc-500">{c.phone}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>

            <div>
              <label className={LABEL_CLS}>Nombre *</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className={INPUT_CLS}
                placeholder="Ej: Pedro García"
              />
            </div>

            <div>
              <label className={LABEL_CLS}>Teléfono *</label>
              <input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className={INPUT_CLS}
                placeholder="+54 9 …"
                inputMode="tel"
              />
            </div>

            <div>
              <label className={LABEL_CLS}>Personas</label>
              <div className="mt-2 flex items-center justify-between rounded-2xl bg-zinc-50 p-2 ring-1 ring-zinc-200">
                <button
                  type="button"
                  className="flex h-10 w-10 items-center justify-center rounded-xl bg-white text-zinc-700 ring-1 ring-zinc-200 transition active:scale-95 disabled:opacity-30"
                  disabled={partySize <= 1}
                  onClick={() => setPartySize((v) => Math.max(1, v - 1))}
                >
                  <Minus className="h-4 w-4" />
                </button>
                <span className="font-heading text-2xl font-extrabold tabular-nums text-zinc-900">
                  {partySize}
                </span>
                <button
                  type="button"
                  className="flex h-10 w-10 items-center justify-center rounded-xl bg-white text-zinc-700 ring-1 ring-zinc-200 transition active:scale-95 disabled:opacity-30"
                  disabled={partySize >= 20}
                  onClick={() => setPartySize((v) => Math.min(20, v + 1))}
                >
                  <Plus className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div>
              <label className={LABEL_CLS}>Fecha</label>
              <input
                type="date"
                value={date}
                min={todayISO()}
                max={maxDateISO(60)}
                onChange={(e) => setDate(e.target.value)}
                className={INPUT_CLS}
              />
            </div>

            {mode === null ? (
              <div className="flex items-center justify-center py-6 text-zinc-400">
                <Loader2 className="h-5 w-5 animate-spin" />
              </div>
            ) : mode === "flexible" ? (
              <>
                {/* Servicio */}
                <div>
                  <label className={LABEL_CLS}>Servicio</label>
                  {serviceNames.length === 0 ? (
                    <p className="mt-2 text-center text-sm text-zinc-400">
                      No hay servicios configurados para esta fecha.
                    </p>
                  ) : (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {serviceNames.map((s) => (
                        <button
                          key={s}
                          type="button"
                          onClick={() => {
                            setService(s);
                            setArrivalTime("");
                          }}
                          className={`rounded-xl px-3 py-2 text-sm font-semibold transition active:scale-95 ${
                            service === s
                              ? "bg-blue-600 text-white shadow-sm"
                              : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200"
                          }`}
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Hora de llegada (obligatoria) — chips cada 15 min */}
                <div>
                  <label className={LABEL_CLS}>Horario</label>
                  {arrivalOptions.length === 0 ? (
                    <p className="mt-2 text-sm text-zinc-400">Elegí un servicio primero.</p>
                  ) : (
                    <div className="mt-2 grid grid-cols-4 gap-1.5 sm:grid-cols-5">
                      {arrivalOptions.map((t) => (
                        <button
                          key={t}
                          type="button"
                          onClick={() => setArrivalTime(t)}
                          className={`rounded-xl px-2 py-2.5 text-sm font-semibold transition active:scale-95 ${
                            arrivalTime === t
                              ? "bg-blue-600 text-white shadow-sm"
                              : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200"
                          }`}
                        >
                          {t}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Cupo blando */}
                {flexInfo && flexInfo.softCapacity != null ? (
                  <p
                    className={`text-sm ${
                      flexInfo.overCapacity ? "font-semibold text-amber-600" : "text-zinc-500"
                    }`}
                  >
                    {flexInfo.reservedCovers}/{flexInfo.softCapacity} cubiertos reservados
                    {flexInfo.overCapacity ? " — te pasás del cupo (igual podés reservar)" : ""}
                  </p>
                ) : null}

                {/* Mesa opcional */}
                <div>
                  <label className={LABEL_CLS}>Mesa (opcional)</label>
                  <select
                    value={tableId ?? ""}
                    onChange={(e) => setTableId(e.target.value || undefined)}
                    className={INPUT_CLS}
                    disabled={loadingFlex}
                  >
                    <option value="">Sin mesa (se sienta al llegar)</option>
                    {flexTables.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.label} ({t.seats} sillas)
                      </option>
                    ))}
                  </select>
                </div>
              </>
            ) : (
              <>
                {/* Estricto: grilla de horarios */}
                <div>
                  <label className={LABEL_CLS}>Horario</label>
                  {loadingSlots ? (
                    <div className="mt-2 flex items-center justify-center py-6 text-zinc-400">
                      <Loader2 className="h-5 w-5 animate-spin" />
                    </div>
                  ) : slots.length === 0 ? (
                    <p className="mt-2 text-center text-sm text-zinc-400">
                      Sin horarios disponibles para esta fecha.
                    </p>
                  ) : (
                    <div className="mt-2 grid grid-cols-4 gap-1.5 sm:grid-cols-5">
                      {slots.map((s) => (
                        <button
                          key={s.slot}
                          type="button"
                          onClick={() => setSelectedSlot(s.slot)}
                          className={`rounded-xl px-2 py-2.5 text-sm font-semibold transition active:scale-95 ${
                            selectedSlot === s.slot
                              ? "bg-blue-600 text-white shadow-sm"
                              : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200"
                          }`}
                        >
                          {s.slot}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {freeTablesEstricto.length > 0 && (
                  <div>
                    <label className={LABEL_CLS}>Mesa (opcional)</label>
                    <select
                      value={tableId ?? ""}
                      onChange={(e) => setTableId(e.target.value || undefined)}
                      className={INPUT_CLS}
                    >
                      <option value="">Auto-asignar</option>
                      {freeTablesEstricto.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.label} ({t.seats} sillas)
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </>
            )}

            <div>
              <label className={LABEL_CLS}>Notas (opcional)</label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-base focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
                placeholder="Ej: cumpleaños, alérgico a maní…"
              />
            </div>
          </div>

          <SheetFooter className="border-t border-zinc-200">
            <button
              type="submit"
              disabled={!canSubmit}
              className="flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-blue-600 text-base font-bold text-white shadow-sm transition active:scale-[0.98] disabled:opacity-60"
            >
              {pending ? (
                <>
                  <Loader2 className="h-5 w-5 animate-spin" />
                  Creando…
                </>
              ) : (
                <>
                  <CalendarPlus className="h-5 w-5" />
                  Crear reserva
                </>
              )}
            </button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
