"use client";

import { useCallback, useMemo, useState, useTransition } from "react";

import { TimeField24 } from "@/components/ui/time-field-24";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { saveBusinessHours } from "@/lib/business-hours/actions";
import type { BusinessHourSlot } from "@/lib/business-hours/schema";

const DAY_LABELS = [
  "Domingo",
  "Lunes",
  "Martes",
  "Miércoles",
  "Jueves",
  "Viernes",
  "Sábado",
] as const;

const DISPLAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

type Slot = { day_of_week: number; opens_at: string; closes_at: string };

function slotsEqual(a: Slot[], b: Slot[]): boolean {
  if (a.length !== b.length) return false;
  const sort = (s: Slot[]) =>
    [...s].sort(
      (x, y) =>
        x.day_of_week - y.day_of_week || x.opens_at.localeCompare(y.opens_at),
    );
  const sa = sort(a);
  const sb = sort(b);
  return sa.every(
    (s, i) =>
      s.day_of_week === sb[i].day_of_week &&
      s.opens_at === sb[i].opens_at &&
      s.closes_at === sb[i].closes_at,
  );
}

export function BusinessHoursForm({
  slug,
  initial,
}: {
  slug: string;
  initial: BusinessHourSlot[];
}) {
  const [slots, setSlots] = useState<Slot[]>(() =>
    initial.map((s) => ({
      day_of_week: s.day_of_week,
      opens_at: s.opens_at.slice(0, 5),
      closes_at: s.closes_at.slice(0, 5),
    })),
  );
  const [isPending, startTransition] = useTransition();

  const initialNormalized = useMemo(
    () =>
      initial.map((s) => ({
        day_of_week: s.day_of_week,
        opens_at: s.opens_at.slice(0, 5),
        closes_at: s.closes_at.slice(0, 5),
      })),
    [initial],
  );

  const hasChanges = !slotsEqual(slots, initialNormalized);

  const slotsForDay = useCallback(
    (dow: number) =>
      slots
        .map((s, i) => ({ ...s, _idx: i }))
        .filter((s) => s.day_of_week === dow)
        .sort((a, b) => a.opens_at.localeCompare(b.opens_at)),
    [slots],
  );

  const addSlot = (dow: number) => {
    setSlots((prev) => [
      ...prev,
      { day_of_week: dow, opens_at: "08:00", closes_at: "16:00" },
    ]);
  };

  const removeSlot = (idx: number) => {
    setSlots((prev) => prev.filter((_, i) => i !== idx));
  };

  const updateSlot = (idx: number, field: "opens_at" | "closes_at", value: string) => {
    setSlots((prev) => prev.map((s, i) => (i === idx ? { ...s, [field]: value } : s)));
  };

  const handleSave = () => {
    startTransition(async () => {
      const result = await saveBusinessHours(slug, slots);
      if (result.ok) {
        toast.success("Horarios guardados.");
      } else {
        toast.error(result.error);
      }
    });
  };

  return (
    <div className="grid gap-4">
      {DISPLAY_ORDER.map((dow) => {
        const daySlots = slotsForDay(dow);
        return (
          <div
            key={dow}
            className="grid gap-2 rounded-xl border border-zinc-200 p-4"
          >
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-zinc-900">
                {DAY_LABELS[dow]}
              </span>
              {daySlots.length === 0 && (
                <span className="text-xs text-zinc-400">Cerrado</span>
              )}
              <button
                type="button"
                onClick={() => addSlot(dow)}
                className="flex items-center gap-1 text-xs font-medium text-zinc-500 hover:text-zinc-900 transition-colors"
              >
                <Plus className="size-3.5" />
                Agregar
              </button>
            </div>

            {daySlots.map((slot) => (
              <div key={slot._idx} className="flex items-center gap-2">
                <TimeField24
                  value={slot.opens_at}
                  onChange={(v) => updateSlot(slot._idx, "opens_at", v)}
                  aria-label="Abre"
                  className="w-20 rounded-lg border border-zinc-200 px-2 py-1.5 text-center text-sm text-zinc-900 focus:outline-none focus:ring-2 focus:ring-zinc-900/10"
                />
                <span className="text-xs text-zinc-400">a</span>
                <TimeField24
                  value={slot.closes_at}
                  onChange={(v) => updateSlot(slot._idx, "closes_at", v)}
                  aria-label="Cierra"
                  className="w-20 rounded-lg border border-zinc-200 px-2 py-1.5 text-center text-sm text-zinc-900 focus:outline-none focus:ring-2 focus:ring-zinc-900/10"
                />
                <button
                  type="button"
                  onClick={() => removeSlot(slot._idx)}
                  className="ml-auto rounded-lg p-1.5 text-zinc-400 hover:bg-red-50 hover:text-red-600 transition-colors"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            ))}
          </div>
        );
      })}

      <button
        type="button"
        disabled={!hasChanges || isPending}
        onClick={handleSave}
        className="mt-2 w-full rounded-xl bg-zinc-900 px-4 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
      >
        {isPending ? "Guardando..." : "Guardar horarios"}
      </button>
    </div>
  );
}
