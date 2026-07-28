"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Save, Trash2, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  deleteReservationServiceGroup,
  saveReservationServiceGroup,
} from "@/lib/reservations/settings-actions";
import type { ReservationService } from "@/lib/reservations/types";

/** Orden de semana arrancando en lunes (0=Domingo en la DB). */
const WEEK: Array<{ value: number; short: string; long: string }> = [
  { value: 1, short: "Lun", long: "Lunes" },
  { value: 2, short: "Mar", long: "Martes" },
  { value: 3, short: "Mié", long: "Miércoles" },
  { value: 4, short: "Jue", long: "Jueves" },
  { value: 5, short: "Vie", long: "Viernes" },
  { value: 6, short: "Sáb", long: "Sábado" },
  { value: 0, short: "Dom", long: "Domingo" },
];

const hhmm = (t: string) => t.slice(0, 5);

/** Un servicio agrupado: todas las filas que comparten (nombre, zona). */
type Group = {
  key: string;
  name: string;
  floorPlanId: string | null;
  days: number[];
  everyDay: boolean;
  opens_at: string;
  closes_at: string;
  soft_capacity: number | null;
  /** true si las filas del grupo NO comparten horario/cupo (config vieja o duplicados). */
  mixed: boolean;
};

function groupServices(services: ReservationService[]): Group[] {
  const map = new Map<string, Group>();
  for (const s of services) {
    const key = `${s.name}||${s.floor_plan_id ?? ""}`;
    const existing = map.get(key);
    if (!existing) {
      map.set(key, {
        key,
        name: s.name,
        floorPlanId: s.floor_plan_id,
        days: s.day_of_week == null ? [] : [s.day_of_week],
        everyDay: s.day_of_week == null,
        opens_at: hhmm(s.opens_at),
        closes_at: hhmm(s.closes_at),
        soft_capacity: s.soft_capacity,
        mixed: false,
      });
      continue;
    }
    if (s.day_of_week == null) existing.everyDay = true;
    else if (!existing.days.includes(s.day_of_week)) existing.days.push(s.day_of_week);
    if (
      hhmm(s.opens_at) !== existing.opens_at ||
      hhmm(s.closes_at) !== existing.closes_at ||
      (s.soft_capacity ?? null) !== existing.soft_capacity
    ) {
      existing.mixed = true;
    }
  }
  const out = [...map.values()];
  for (const g of out) g.days.sort((a, b) => (a === 0 ? 7 : a) - (b === 0 ? 7 : b));
  return out.sort((a, b) => a.opens_at.localeCompare(b.opens_at));
}

type Draft = {
  name: string;
  previousName?: string;
  everyDay: boolean;
  days: number[];
  opens_at: string;
  closes_at: string;
  soft_capacity: string;
  floor_plan_id: string;
};

const EMPTY_DRAFT: Draft = {
  name: "",
  everyDay: false,
  days: [],
  opens_at: "20:00",
  closes_at: "23:30",
  soft_capacity: "",
  floor_plan_id: "",
};

export function FlexibleServicesEditor({
  slug,
  initialServices,
  salones,
}: {
  slug: string;
  initialServices: ReservationService[];
  salones: Array<{ id: string; name: string }>;
}) {
  const router = useRouter();
  const [services, setServices] = useState<ReservationService[]>(initialServices);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [pending, startTransition] = useTransition();

  // El server revalida tras guardar; re-sincronizamos con las props nuevas.
  useEffect(() => setServices(initialServices), [initialServices]);

  const groups = useMemo(() => groupServices(services), [services]);
  const editing = !!draft.previousName;

  const zoneName = (id: string | null) =>
    id == null ? "Todo el negocio" : (salones.find((s) => s.id === id)?.name ?? "—");

  function patch<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  function toggleDay(day: number) {
    setDraft((d) => ({
      ...d,
      everyDay: false,
      days: d.days.includes(day) ? d.days.filter((x) => x !== day) : [...d.days, day],
    }));
  }

  function editGroup(g: Group) {
    setDraft({
      name: g.name,
      previousName: g.name,
      everyDay: g.everyDay,
      days: g.days,
      opens_at: g.opens_at,
      closes_at: g.closes_at,
      soft_capacity: g.soft_capacity == null ? "" : String(g.soft_capacity),
      floor_plan_id: g.floorPlanId ?? "",
    });
  }

  function onSave() {
    startTransition(async () => {
      const result = await saveReservationServiceGroup({
        business_slug: slug,
        name: draft.name,
        ...(draft.previousName ? { previous_name: draft.previousName } : {}),
        days: draft.days,
        every_day: draft.everyDay,
        opens_at: draft.opens_at,
        closes_at: draft.closes_at,
        soft_capacity: draft.soft_capacity === "" ? null : Number(draft.soft_capacity),
        floor_plan_id: draft.floor_plan_id === "" ? null : draft.floor_plan_id,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(
        editing
          ? "Servicio actualizado"
          : `Servicio creado (${result.data.rows} ${result.data.rows === 1 ? "día" : "días"})`,
      );
      setDraft(EMPTY_DRAFT);
      router.refresh();
    });
  }

  function onDelete(g: Group) {
    startTransition(async () => {
      const result = await deleteReservationServiceGroup({
        business_slug: slug,
        name: g.name,
        floor_plan_id: g.floorPlanId,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      if (draft.previousName === g.name) setDraft(EMPTY_DRAFT);
      toast.success("Servicio eliminado");
      router.refresh();
    });
  }

  const canSave =
    draft.name.trim().length > 0 && (draft.everyDay || draft.days.length > 0) && !pending;

  return (
    <section className="space-y-4 rounded-2xl border bg-card p-5">
      <header>
        <h2 className="text-lg font-semibold">Servicios</h2>
        <p className="text-sm text-muted-foreground">
          Definí los servicios del día (Mediodía, Cena…) con su horario de atención y un{" "}
          <strong>cupo blando</strong> de cubiertos opcional (avisa, no bloquea). Un mismo
          servicio se carga <strong>para varios días de una vez</strong>.
        </p>
      </header>

      {groups.length > 0 ? (
        <ul className="divide-y rounded-lg border">
          {groups.map((g) => (
            <li key={g.key} className="flex flex-wrap items-center gap-x-3 gap-y-2 p-3 text-sm">
              <span className="font-medium">{g.name}</span>
              <span className="tabular-nums text-muted-foreground">
                {g.opens_at}–{g.closes_at}
              </span>
              {g.everyDay ? (
                <span className="rounded-md bg-muted px-1.5 py-0.5 text-xs">Todos los días</span>
              ) : (
                <span className="flex flex-wrap gap-1">
                  {WEEK.filter((d) => g.days.includes(d.value)).map((d) => (
                    <span key={d.value} className="rounded-md bg-muted px-1.5 py-0.5 text-xs">
                      {d.short}
                    </span>
                  ))}
                </span>
              )}
              <span className="text-muted-foreground">
                {g.soft_capacity == null ? "sin cupo" : `cupo ${g.soft_capacity}`}
              </span>
              {salones.length > 0 ? (
                <span className="text-muted-foreground">· {zoneName(g.floorPlanId)}</span>
              ) : null}
              {g.mixed ? (
                <span className="rounded-md bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">
                  horarios distintos por día — al guardar se unifican
                </span>
              ) : null}
              <span className="ml-auto flex items-center gap-1">
                <Button type="button" variant="ghost" size="xs" onClick={() => editGroup(g)}>
                  Editar
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => onDelete(g)}
                  disabled={pending}
                  aria-label={`Eliminar ${g.name}`}
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

      <div className="space-y-4 rounded-lg border bg-muted/20 p-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">
            {editing ? `Editando “${draft.previousName}”` : "Nuevo servicio"}
          </h3>
          {editing ? (
            <Button
              type="button"
              variant="ghost"
              size="xs"
              onClick={() => setDraft(EMPTY_DRAFT)}
            >
              <X className="size-3" /> Cancelar
            </Button>
          ) : null}
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
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
            <Label>Horario</Label>
            <div className="flex items-center gap-1">
              <Input
                type="time"
                value={draft.opens_at}
                onChange={(e) => patch("opens_at", e.target.value)}
                className="w-24"
                aria-label="Abre"
              />
              <span className="text-muted-foreground">–</span>
              <Input
                type="time"
                value={draft.closes_at}
                onChange={(e) => patch("closes_at", e.target.value)}
                className="w-24"
                aria-label="Cierra"
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
                <option value="">Todo el negocio</option>
                {salones.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
        </div>

        {/* Días: multi-selección — el mismo turno para varios días de una vez. */}
        <div className="space-y-2">
          <Label>Días</Label>
          <div className="flex flex-wrap items-center gap-1.5">
            {WEEK.map((d) => {
              const active = !draft.everyDay && draft.days.includes(d.value);
              return (
                <button
                  key={d.value}
                  type="button"
                  onClick={() => toggleDay(d.value)}
                  aria-pressed={active}
                  title={d.long}
                  className={`h-9 min-w-[3rem] rounded-md border px-2 text-sm font-medium transition ${
                    active
                      ? "border-transparent bg-primary text-primary-foreground"
                      : "bg-background hover:bg-muted"
                  }`}
                >
                  {d.short}
                </button>
              );
            })}
            <span className="mx-1 text-muted-foreground">|</span>
            <Button
              type="button"
              variant={draft.everyDay ? "default" : "outline"}
              size="sm"
              onClick={() =>
                setDraft((d) => ({ ...d, everyDay: !d.everyDay, days: [] }))
              }
            >
              Todos los días
            </Button>
            {!draft.everyDay && draft.days.length > 0 ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => patch("days", [])}
              >
                Limpiar
              </Button>
            ) : null}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button type="button" onClick={onSave} disabled={!canSave}>
            <Save className="size-4" /> {editing ? "Guardar cambios" : "Agregar servicio"}
          </Button>
          {!editing ? (
            <span className="flex items-center text-xs text-muted-foreground">
              <Plus className="mr-1 size-3" /> se crea para todos los días elegidos
            </span>
          ) : null}
        </div>
      </div>
    </section>
  );
}
