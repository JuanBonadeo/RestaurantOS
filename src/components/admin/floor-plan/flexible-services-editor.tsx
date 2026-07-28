"use client";

import { useState, useTransition } from "react";
import { Plus, Save, Trash2, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  deleteReservationService,
  saveReservationService,
} from "@/lib/reservations/settings-actions";
import type { ReservationService } from "@/lib/reservations/types";

const DAY_LABELS: Record<string, string> = {
  "0": "Domingo",
  "1": "Lunes",
  "2": "Martes",
  "3": "Miércoles",
  "4": "Jueves",
  "5": "Viernes",
  "6": "Sábado",
};

type Draft = {
  id?: string;
  name: string;
  day_of_week: string; // "" = todos
  opens_at: string;
  closes_at: string;
  soft_capacity: string; // "" = sin umbral
  floor_plan_id: string; // "" = servicio entero
};

const EMPTY_DRAFT: Draft = {
  name: "",
  day_of_week: "",
  opens_at: "20:00",
  closes_at: "00:30",
  soft_capacity: "",
  floor_plan_id: "",
};

function toDraft(s: ReservationService): Draft {
  return {
    id: s.id,
    name: s.name,
    day_of_week: s.day_of_week == null ? "" : String(s.day_of_week),
    opens_at: s.opens_at.slice(0, 5),
    closes_at: s.closes_at.slice(0, 5),
    soft_capacity: s.soft_capacity == null ? "" : String(s.soft_capacity),
    floor_plan_id: s.floor_plan_id ?? "",
  };
}

export function FlexibleServicesEditor({
  slug,
  initialServices,
  salones,
}: {
  slug: string;
  initialServices: ReservationService[];
  salones: Array<{ id: string; name: string }>;
}) {
  const [services, setServices] = useState<ReservationService[]>(initialServices);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [pending, startTransition] = useTransition();

  const zoneName = (id: string | null) =>
    id == null ? "Todo el servicio" : (salones.find((s) => s.id === id)?.name ?? "—");

  function patch<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  function editService(s: ReservationService) {
    setDraft(toDraft(s));
  }

  function onSave() {
    startTransition(async () => {
      const result = await saveReservationService({
        business_slug: slug,
        id: draft.id,
        name: draft.name,
        day_of_week: draft.day_of_week === "" ? null : Number(draft.day_of_week),
        opens_at: draft.opens_at,
        closes_at: draft.closes_at,
        soft_capacity: draft.soft_capacity === "" ? null : Number(draft.soft_capacity),
        floor_plan_id: draft.floor_plan_id === "" ? null : draft.floor_plan_id,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      // Refresco optimista de la lista (el server ya revalidó las páginas de uso).
      const saved: ReservationService = {
        id: result.data.id,
        business_id: "",
        name: draft.name,
        day_of_week: draft.day_of_week === "" ? null : Number(draft.day_of_week),
        opens_at: draft.opens_at,
        closes_at: draft.closes_at,
        soft_capacity: draft.soft_capacity === "" ? null : Number(draft.soft_capacity),
        floor_plan_id: draft.floor_plan_id === "" ? null : draft.floor_plan_id,
      };
      setServices((prev) => {
        const rest = prev.filter((s) => s.id !== saved.id);
        return [...rest, saved].sort((a, b) => a.opens_at.localeCompare(b.opens_at));
      });
      setDraft(EMPTY_DRAFT);
      toast.success(draft.id ? "Servicio actualizado" : "Servicio creado");
    });
  }

  function onDelete(id: string) {
    startTransition(async () => {
      const result = await deleteReservationService({ business_slug: slug, id });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setServices((prev) => prev.filter((s) => s.id !== id));
      if (draft.id === id) setDraft(EMPTY_DRAFT);
      toast.success("Servicio eliminado");
    });
  }

  return (
    <section className="space-y-4 rounded-2xl border bg-card p-5">
      <header>
        <h2 className="text-lg font-semibold">Servicios</h2>
        <p className="text-sm text-muted-foreground">
          Definí los servicios del día (Mediodía, Cena…) con su horario de atención y un{" "}
          <strong>cupo blando</strong> de cubiertos opcional (avisa, no bloquea). Reemplazan
          a los turnos fijos del modo estricto.
        </p>
      </header>

      {services.length > 0 ? (
        <ul className="divide-y rounded-lg border">
          {services.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 p-3 text-sm">
              <span className="font-medium">{s.name}</span>
              <span className="text-muted-foreground">
                {s.day_of_week == null ? "Todos los días" : DAY_LABELS[String(s.day_of_week)]}
              </span>
              <span className="tabular-nums">
                {s.opens_at.slice(0, 5)}–{s.closes_at.slice(0, 5)}
              </span>
              <span className="text-muted-foreground">
                {s.soft_capacity == null ? "sin cupo" : `cupo ${s.soft_capacity}`}
              </span>
              {salones.length > 0 ? (
                <span className="text-muted-foreground">· {zoneName(s.floor_plan_id)}</span>
              ) : null}
              <span className="ml-auto flex items-center gap-1">
                <Button type="button" variant="ghost" size="xs" onClick={() => editService(s)}>
                  Editar
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => onDelete(s.id)}
                  disabled={pending}
                  aria-label="Eliminar servicio"
                >
                  <Trash2 className="size-4" />
                </Button>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">Todavía no hay servicios cargados.</p>
      )}

      <div className="grid grid-cols-1 gap-3 rounded-lg border bg-muted/20 p-4 sm:grid-cols-2 lg:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor="svc-name">Nombre</Label>
          <Input
            id="svc-name"
            value={draft.name}
            placeholder="Cena"
            maxLength={40}
            onChange={(e) => patch("name", e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="svc-day">Día</Label>
          <select
            id="svc-day"
            className="h-9 w-full rounded-md border bg-background px-2 text-sm"
            value={draft.day_of_week}
            onChange={(e) => patch("day_of_week", e.target.value)}
          >
            <option value="">Todos los días</option>
            {["1", "2", "3", "4", "5", "6", "0"].map((d) => (
              <option key={d} value={d}>
                {DAY_LABELS[d]}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label>Horario</Label>
          <div className="flex items-center gap-1">
            <Input
              type="time"
              value={draft.opens_at}
              onChange={(e) => patch("opens_at", e.target.value)}
              className="w-24"
            />
            <span className="text-muted-foreground">–</span>
            <Input
              type="time"
              value={draft.closes_at}
              onChange={(e) => patch("closes_at", e.target.value)}
              className="w-24"
            />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="svc-cap">Cupo blando (cubiertos)</Label>
          <Input
            id="svc-cap"
            type="number"
            min={1}
            placeholder="sin límite"
            value={draft.soft_capacity}
            onChange={(e) => patch("soft_capacity", e.target.value)}
          />
        </div>
        {salones.length > 0 ? (
          <div className="space-y-1.5">
            <Label htmlFor="svc-zone">Zona</Label>
            <select
              id="svc-zone"
              className="h-9 w-full rounded-md border bg-background px-2 text-sm"
              value={draft.floor_plan_id}
              onChange={(e) => patch("floor_plan_id", e.target.value)}
            >
              <option value="">Todo el servicio</option>
              {salones.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        <div className="flex items-end gap-2">
          <Button type="button" onClick={onSave} disabled={pending || !draft.name.trim()}>
            <Save className="size-4" /> {draft.id ? "Guardar" : "Agregar"}
          </Button>
          {draft.id ? (
            <Button type="button" variant="ghost" size="icon" onClick={() => setDraft(EMPTY_DRAFT)} aria-label="Cancelar edición">
              <X className="size-4" />
            </Button>
          ) : (
            <span className="flex items-center text-xs text-muted-foreground">
              <Plus className="mr-1 size-3" /> nuevo servicio
            </span>
          )}
        </div>
      </div>
    </section>
  );
}
