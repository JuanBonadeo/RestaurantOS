"use client";

import { useState, useTransition } from "react";
import { Plus, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { saveReservationSettings, setReservationMode } from "@/lib/reservations/settings-actions";
import type {
  ReservationMode,
  ReservationService,
  ReservationSettings,
  WeeklySchedule,
} from "@/lib/reservations/types";
import { FlexibleServicesEditor } from "@/components/admin/floor-plan/flexible-services-editor";

const DAYS: Array<{ key: "0" | "1" | "2" | "3" | "4" | "5" | "6"; label: string }> = [
  { key: "1", label: "Lunes" },
  { key: "2", label: "Martes" },
  { key: "3", label: "Miércoles" },
  { key: "4", label: "Jueves" },
  { key: "5", label: "Viernes" },
  { key: "6", label: "Sábado" },
  { key: "0", label: "Domingo" },
];

type FormState = {
  slot_duration_min: string;
  buffer_min: string;
  lead_time_min: string;
  advance_days_max: string;
  max_party_size: string;
  no_show_grace_min: string;
  schedule: WeeklySchedule;
};

function fromInitial(s: ReservationSettings): FormState {
  return {
    slot_duration_min: String(s.slot_duration_min),
    buffer_min: String(s.buffer_min),
    lead_time_min: String(s.lead_time_min),
    advance_days_max: String(s.advance_days_max),
    max_party_size: String(s.max_party_size),
    no_show_grace_min: String(s.no_show_grace_min),
    schedule: s.schedule ?? {},
  };
}

export function ReservationSettingsForm({
  slug,
  initial,
  services,
  salones,
}: {
  slug: string;
  initial: ReservationSettings;
  services: ReservationService[];
  salones: Array<{ id: string; name: string }>;
}) {
  const [state, setState] = useState<FormState>(() => fromInitial(initial));
  const [mode, setMode] = useState<ReservationMode>(initial.mode ?? "estricto");
  const [pending, startTransition] = useTransition();
  const [modePending, startModeTransition] = useTransition();

  function changeMode(next: ReservationMode) {
    if (next === mode) return;
    const prev = mode;
    setMode(next);
    startModeTransition(async () => {
      const result = await setReservationMode({ business_slug: slug, mode: next });
      if (result.ok) {
        toast.success(`Modo de reservas: ${next === "flexible" ? "flexible" : "estricto"}`);
      } else {
        toast.error(result.error);
        setMode(prev);
      }
    });
  }

  function patch<K extends keyof FormState>(key: K, value: FormState[K]) {
    setState((s) => ({ ...s, [key]: value }));
  }

  function setDay(key: "0" | "1" | "2" | "3" | "4" | "5" | "6", patcher: (d: { open: boolean; slots: string[] }) => { open: boolean; slots: string[] }) {
    setState((s) => {
      const current = s.schedule[key] ?? { open: false, slots: [] };
      return { ...s, schedule: { ...s.schedule, [key]: patcher(current) } };
    });
  }

  function addSlot(key: "0" | "1" | "2" | "3" | "4" | "5" | "6") {
    setDay(key, (d) => ({ ...d, slots: [...d.slots, "20:00"] }));
  }

  function updateSlot(key: "0" | "1" | "2" | "3" | "4" | "5" | "6", index: number, value: string) {
    setDay(key, (d) => {
      const next = [...d.slots];
      next[index] = value;
      return { ...d, slots: next };
    });
  }

  function removeSlot(key: "0" | "1" | "2" | "3" | "4" | "5" | "6", index: number) {
    setDay(key, (d) => ({ ...d, slots: d.slots.filter((_, i) => i !== index) }));
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const result = await saveReservationSettings({
        business_slug: slug,
        slot_duration_min: state.slot_duration_min,
        buffer_min: state.buffer_min,
        lead_time_min: state.lead_time_min,
        advance_days_max: state.advance_days_max,
        max_party_size: state.max_party_size,
        no_show_grace_min: state.no_show_grace_min,
        schedule: state.schedule,
      });
      if (result.ok) toast.success("Configuración guardada");
      else toast.error(result.error);
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      <section className="space-y-3 rounded-2xl border bg-card p-5">
        <header>
          <h2 className="text-lg font-semibold">Modo de reservas</h2>
          <p className="text-sm text-muted-foreground">
            <strong>Estricto</strong>: turnos fijos con mesa asignada (rotación).{" "}
            <strong>Flexible</strong>: libro de reservas — mesa opcional, una por mesa por
            servicio; la hora reserva la mesa hasta el cierre. Sin desalojos.
          </p>
        </header>
        <div className="flex gap-2">
          {(["estricto", "flexible"] as const).map((m) => (
            <Button
              key={m}
              type="button"
              variant={mode === m ? "default" : "outline"}
              onClick={() => changeMode(m)}
              disabled={modePending}
            >
              {m === "estricto" ? "Estricto" : "Flexible"}
            </Button>
          ))}
        </div>
      </section>

      <section className="grid grid-cols-1 gap-4 rounded-2xl border bg-card p-5 sm:grid-cols-2 lg:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor="slot_duration_min">Duración del turno (min)</Label>
          <Input
            id="slot_duration_min"
            type="number"
            min={15}
            max={600}
            value={state.slot_duration_min}
            onChange={(e) => patch("slot_duration_min", e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="buffer_min">Buffer entre reservas (min)</Label>
          <Input
            id="buffer_min"
            type="number"
            min={0}
            max={180}
            value={state.buffer_min}
            onChange={(e) => patch("buffer_min", e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="lead_time_min">Antelación mínima (min)</Label>
          <Input
            id="lead_time_min"
            type="number"
            min={0}
            value={state.lead_time_min}
            onChange={(e) => patch("lead_time_min", e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="advance_days_max">Días máx a futuro</Label>
          <Input
            id="advance_days_max"
            type="number"
            min={1}
            max={365}
            value={state.advance_days_max}
            onChange={(e) => patch("advance_days_max", e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="max_party_size">Máximo de comensales</Label>
          <Input
            id="max_party_size"
            type="number"
            min={1}
            max={100}
            value={state.max_party_size}
            onChange={(e) => patch("max_party_size", e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="no_show_grace_min">Gracia no-show (min)</Label>
          <Input
            id="no_show_grace_min"
            type="number"
            min={0}
            max={600}
            value={state.no_show_grace_min}
            onChange={(e) => patch("no_show_grace_min", e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            Tras este margen pasado el horario, la reserva confirmada se marca
            como no-show automáticamente y libera la mesa.
          </p>
        </div>
      </section>

      {mode === "estricto" ? (
      <section className="space-y-3 rounded-2xl border bg-card p-5">
        <header>
          <h2 className="text-lg font-semibold">Horarios y turnos</h2>
          <p className="text-sm text-muted-foreground">
            Activá los días que el negocio toma reservas y agregá los horarios fijos
            que el cliente puede elegir (en hora local).
          </p>
        </header>
        <div className="space-y-2">
          {DAYS.map(({ key, label }) => {
            const day = state.schedule[key] ?? { open: false, slots: [] };
            return (
              <div key={key} className="flex flex-wrap items-center gap-3 rounded-lg border bg-muted/20 p-3">
                <label className="flex w-28 items-center gap-2 text-sm font-medium">
                  <input
                    type="checkbox"
                    checked={day.open}
                    onChange={(e) =>
                      setDay(key, (d) => ({ ...d, open: e.target.checked }))
                    }
                  />
                  {label}
                </label>
                <div className="flex flex-1 flex-wrap items-center gap-2">
                  {day.open ? (
                    <>
                      {day.slots.map((slot, i) => (
                        <div key={i} className="flex items-center gap-1">
                          <Input
                            type="time"
                            value={slot}
                            onChange={(e) => updateSlot(key, i, e.target.value)}
                            className="w-24"
                          />
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-xs"
                            onClick={() => removeSlot(key, i)}
                            aria-label="Eliminar turno"
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        </div>
                      ))}
                      <Button
                        type="button"
                        variant="outline"
                        size="xs"
                        onClick={() => addSlot(key)}
                      >
                        <Plus className="size-3" /> Turno
                      </Button>
                    </>
                  ) : (
                    <span className="text-sm text-muted-foreground">Cerrado</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>
      ) : (
        <FlexibleServicesEditor slug={slug} initialServices={services} salones={salones} />
      )}

      <div className="flex justify-end">
        <Button type="submit" disabled={pending}>
          <Save className="size-4" /> Guardar configuración
        </Button>
      </div>
    </form>
  );
}
