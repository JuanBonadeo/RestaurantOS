"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { formatInTimeZone } from "date-fns-tz";
import { Check, Inbox, Pencil, X } from "lucide-react";
import { toast } from "sonner";

import { ReservationEditPanel } from "@/components/reservations/reservation-edit-panel";
import {
  decideReservation,
  updateReservationDetails,
} from "@/lib/reservations/booking-actions";
import { OVERBOOK_HINT } from "@/lib/reservations/edit-window";
import { useReservationsRealtime } from "@/lib/reservations/use-reservations-realtime";
import {
  agruparPorDia,
  esUrgente,
  labelDeVencimiento,
  type SolicitudEnBandeja,
} from "@/lib/reservations/pending-inbox";
import type {
  DayServiceOption,
  FloorTable,
  ReservationMode,
} from "@/lib/reservations/types";
import { cn } from "@/lib/utils";

/**
 * La bandeja de solicitudes (spec 135).
 *
 * Todas las que esperan respuesta, de cualquier día — que es lo que la 131 no
 * podía mostrar: su bandeja era una tab dentro de un día, y la que nadie miraba
 * vencía sola.
 *
 * Cada tarjeta trae con qué decidir sin salir: cuándo, quién, cuántos, por
 * dónde entró, y las dos cosas que hoy no estaban en ninguna pantalla — **cómo
 * viene ese servicio** y **cuánto le queda antes de vencer**.
 */
export function SolicitudesInbox({
  slug,
  businessId,
  solicitudes,
  timezone,
  mode = "estricto",
  services = [],
  activeTables = [],
  floorPlans = [],
  onChanged,
  className,
}: {
  slug: string;
  /** Para la suscripción en vivo: una solicitud nueva aparece sin recargar. */
  businessId: string;
  solicitudes: SolicitudEnBandeja[];
  timezone: string;
  mode?: ReservationMode;
  /** Servicios del negocio (modo flexible), para el panel de edición. */
  services?: DayServiceOption[];
  activeTables?: FloorTable[];
  floorPlans?: Array<{ id: string; name: string }>;
  /** Cómo re-sincronizar después de resolver una. */
  onChanged?: () => void;
  className?: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  // Sin `onChanged` (la página server-side) se recarga sola, igual que la lista
  // del día: resolver una solicitud tiene que verse sin apretar nada más.
  const resincronizar = () => (onChanged ? onChanged() : router.refresh());

  // Spec 135 · D6 — la bandeja no espera un F5: una solicitud que entra por la
  // web aparece sola, y la que otro encargado resolvió desaparece.
  useReservationsRealtime({ businessId, onChange: resincronizar });
  const [rechazando, setRechazando] = useState<{ id: string; nombre: string } | null>(null);
  const [motivo, setMotivo] = useState("");
  const [editando, setEditando] = useState<string | null>(null);

  // `now` se congela al montar: si se recalculara en cada render, los «vence
  // en» saltarían solos y la lista se reordenaría bajo el dedo.
  const now = useMemo(() => new Date(), []);
  const dias = useMemo(
    () => agruparPorDia(solicitudes, timezone, now),
    [solicitudes, timezone, now],
  );

  function decidir(id: string, decision: "confirm" | "reject", reason?: string) {
    start(async () => {
      const result = await decideReservation({
        business_slug: slug,
        id,
        decision,
        ...(reason?.trim() ? { reason: reason.trim() } : {}),
      });
      if (result.ok) {
        toast.success(
          decision === "confirm" ? "Reserva confirmada." : "Reserva rechazada.",
        );
        setRechazando(null);
        setMotivo("");
        resincronizar();
      } else {
        toast.error(result.error);
      }
    });
  }

  if (solicitudes.length === 0) {
    return (
      <div
        className={cn(
          "rounded-2xl bg-white p-6 text-center ring-1 ring-zinc-200/70",
          className,
        )}
      >
        <div className="mx-auto grid h-10 w-10 place-items-center rounded-full bg-zinc-100 text-zinc-400">
          <Inbox className="h-5 w-5" />
        </div>
        <p className="mt-2.5 text-sm font-medium text-zinc-700">
          No hay solicitudes esperando
        </p>
        <p className="mt-1 text-xs text-zinc-500">
          Las reservas de la web y del chatbot aparecen acá para que las
          confirmes.
        </p>
      </div>
    );
  }

  return (
    <div className={cn("space-y-4", className)}>
      {dias.map((dia) => (
        <div key={dia.date}>
          <p className="mb-2 px-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-400">
            {dia.label}
          </p>
          <ul className="space-y-2">
            {dia.solicitudes.map((s) => {
              const urgente = esUrgente(s.venceEn, now);
              const hora = formatInTimeZone(
                new Date(s.reserva.starts_at),
                timezone,
                "HH:mm",
              );
              const salon =
                s.reserva.tables?.floor_plans?.name ?? null;
              const mesa = s.reserva.tables?.label ?? null;
              const contexto = [
                s.reserva.service,
                salon,
                mesa ? `mesa ${mesa}` : "sin mesa",
                s.reserva.source === "chatbot" ? "por el chatbot" : "por la web",
              ]
                .filter(Boolean)
                .join(" · ");

              return (
                <li
                  key={s.reserva.id}
                  className={cn(
                    "rounded-2xl bg-white p-3.5 ring-1 transition",
                    urgente ? "ring-amber-300" : "ring-zinc-200/70",
                    pending && "opacity-60",
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                        <span className="font-mono text-lg font-semibold tabular-nums text-zinc-900">
                          {hora}
                        </span>
                        <span className="truncate text-sm font-medium text-zinc-900">
                          {s.reserva.customer_name}
                        </span>
                        <span className="text-xs text-zinc-500">
                          · {s.reserva.party_size}p
                        </span>
                      </div>
                      <p className="mt-1 truncate text-[11px] text-zinc-500">
                        {contexto}
                      </p>
                      {s.reserva.notes && (
                        <p className="mt-1 line-clamp-2 text-[11px] italic text-zinc-500">
                          «{s.reserva.notes}»
                        </p>
                      )}
                      <p
                        className={cn(
                          "mt-1.5 text-[11px] font-medium",
                          urgente ? "text-amber-700" : "text-zinc-400",
                        )}
                      >
                        {labelDeVencimiento(s.venceEn, now)}
                      </p>
                    </div>

                    {s.ocupacion && (
                      <div className="w-24 shrink-0 text-right">
                        <p className="text-[11px] leading-tight text-zinc-500">
                          {s.ocupacion.label}
                        </p>
                        {s.ocupacion.ratio != null && (
                          <div className="ml-auto mt-1.5 h-1 w-16 overflow-hidden rounded-full bg-zinc-100">
                            <div
                              className={cn(
                                "h-full rounded-full",
                                s.ocupacion.ratio >= 0.9
                                  ? "bg-amber-500"
                                  : "bg-emerald-500",
                              )}
                              style={{
                                width: `${Math.round(s.ocupacion.ratio * 100)}%`,
                              }}
                            />
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {editando !== s.reserva.id && (
                    <div className="mt-2.5 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => decidir(s.reserva.id, "confirm")}
                        disabled={pending}
                        className="inline-flex h-8 items-center gap-1.5 rounded-xl bg-emerald-600 px-3 text-xs font-semibold text-white shadow-sm transition hover:bg-emerald-700 active:scale-[0.97] disabled:opacity-60"
                      >
                        <Check className="h-3.5 w-3.5" />
                        Confirmar
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditando(s.reserva.id)}
                        disabled={pending}
                        className="inline-flex h-8 items-center gap-1.5 rounded-xl bg-zinc-100 px-2.5 text-xs font-semibold text-zinc-700 ring-1 ring-zinc-200 transition hover:bg-zinc-200 active:scale-[0.97] disabled:opacity-60"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                        Editar
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setRechazando({
                            id: s.reserva.id,
                            nombre: s.reserva.customer_name,
                          })
                        }
                        disabled={pending}
                        className="inline-flex h-8 items-center gap-1.5 rounded-xl bg-rose-50 px-2.5 text-xs font-semibold text-rose-700 ring-1 ring-rose-200 transition hover:bg-rose-100 active:scale-[0.97] disabled:opacity-60"
                      >
                        <X className="h-3.5 w-3.5" />
                        Rechazar
                      </button>
                    </div>
                  )}

                  {editando === s.reserva.id && (
                    <ReservationEditPanel
                      row={s.reserva}
                      timezone={timezone}
                      mode={mode}
                      services={services}
                      activeTables={activeTables}
                      floorPlans={floorPlans}
                      multiSalon={floorPlans.length > 1}
                      pending={pending}
                      onSave={(patch, callbacks) =>
                        start(async () => {
                          const result = await updateReservationDetails({
                            business_slug: slug,
                            reservation_id: s.reserva.id,
                            ...patch,
                          });
                          if (result.ok) {
                            toast.success("Solicitud actualizada.");
                            callbacks.onDone();
                            resincronizar();
                            return;
                          }
                          if (result.error.endsWith(OVERBOOK_HINT)) {
                            callbacks.onOverbook(result.error);
                            return;
                          }
                          toast.error(result.error);
                        })
                      }
                      onClose={() => setEditando(null)}
                      className="mt-2.5"
                    />
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ))}

      {/* Rechazar pide un motivo opcional que viaja al cliente (spec 131). */}
      {rechazando && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40"
          onClick={() => setRechazando(null)}
        >
          <div
            className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-base font-bold text-zinc-900">
              ¿Rechazar la reserva?
            </h3>
            <p className="mt-1.5 text-sm text-zinc-600">
              Le avisamos a{" "}
              <span className="font-semibold">{rechazando.nombre}</span> que no
              pudimos tomarla y el lugar queda libre.
            </p>
            <label className="mt-4 block text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
              Motivo (opcional)
            </label>
            <input
              type="text"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              maxLength={200}
              placeholder="Ej: esa noche tenemos un evento privado"
              className="mt-1.5 h-10 w-full rounded-xl border-0 bg-zinc-100 px-3 text-sm text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-rose-300"
            />
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => setRechazando(null)}
                disabled={pending}
                className="flex-1 rounded-xl bg-zinc-100 px-4 py-2.5 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-200 disabled:opacity-60"
              >
                Volver
              </button>
              <button
                type="button"
                onClick={() => decidir(rechazando.id, "reject", motivo)}
                disabled={pending}
                className="flex-1 rounded-xl bg-rose-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-rose-700 disabled:opacity-60"
              >
                Rechazar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
