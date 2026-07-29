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
  saveReservationServiceGroups,
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

/** Sugerencias para arrancar cuando el negocio todavía no cargó nada. */
const SUGGESTED = ["Almuerzo", "Cena"];

const hhmm = (t: string) => t.slice(0, 5);

const DEFAULT_HOURS: Record<string, { opens_at: string; closes_at: string }> = {
  Almuerzo: { opens_at: "12:00", closes_at: "16:00" },
  Cena: { opens_at: "20:00", closes_at: "23:30" },
};

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

/** Estado de un servicio marcado en el formulario. */
type SvcDraft = {
  opens_at: string;
  closes_at: string;
  soft_capacity: string;
  /** Nombre con el que ya existía (para reescribir ese grupo). */
  previousName?: string;
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
  const [selected, setSelected] = useState<Record<string, SvcDraft>>({});
  const [newName, setNewName] = useState("");
  const [days, setDays] = useState<number[]>([]);
  const [everyDay, setEveryDay] = useState(false);
  /** Zonas marcadas. Vacío = todo el negocio. */
  const [zones, setZones] = useState<string[]>([]);
  const [pending, startTransition] = useTransition();

  // El server revalida tras guardar; re-sincronizamos con las props nuevas.
  useEffect(() => setServices(initialServices), [initialServices]);

  const groups = useMemo(() => groupServices(services), [services]);

  /** Chips de servicio: los que ya existen + sugeridos + los que sumó a mano. */
  const serviceChips = useMemo(() => {
    const names = new Set<string>();
    for (const g of groups) names.add(g.name);
    for (const n of Object.keys(selected)) names.add(n);
    if (names.size === 0) for (const n of SUGGESTED) names.add(n);
    return [...names];
  }, [groups, selected]);

  const zoneName = (id: string | null) =>
    id == null ? "Todo el negocio" : (salones.find((s) => s.id === id)?.name ?? "—");

  function toggleService(name: string) {
    setSelected((prev) => {
      if (prev[name]) {
        const next = { ...prev };
        delete next[name];
        return next;
      }
      // Al marcarlo, precargamos lo que ya tenga configurado (o un default).
      // Buscamos en la primera zona marcada; si no hay, en "todo el negocio".
      const zoneKey = zones[0] ?? "";
      const existing =
        groups.find((g) => g.name === name && (g.floorPlanId ?? "") === zoneKey) ??
        groups.find((g) => g.name === name);
      const fallback = DEFAULT_HOURS[name] ?? { opens_at: "20:00", closes_at: "23:30" };
      return {
        ...prev,
        [name]: existing
          ? {
              opens_at: existing.opens_at,
              closes_at: existing.closes_at,
              soft_capacity:
                existing.soft_capacity == null ? "" : String(existing.soft_capacity),
              previousName: existing.name,
            }
          : { ...fallback, soft_capacity: "" },
      };
    });
  }

  function patchService(name: string, patch: Partial<SvcDraft>) {
    setSelected((prev) => ({ ...prev, [name]: { ...prev[name], ...patch } }));
  }

  function addNewName() {
    const n = newName.trim();
    if (!n) return;
    if (!selected[n]) toggleService(n);
    setNewName("");
  }

  function toggleDay(day: number) {
    setEveryDay(false);
    setDays((prev) => (prev.includes(day) ? prev.filter((x) => x !== day) : [...prev, day]));
  }

  function toggleZone(id: string) {
    setZones((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function resetForm() {
    setSelected({});
    setDays([]);
    setEveryDay(false);
    setZones([]);
    setNewName("");
  }

  /** Cargar un servicio existente en el formulario para editarlo. */
  function editGroup(g: Group) {
    setZones(g.floorPlanId ? [g.floorPlanId] : []);
    setSelected({
      [g.name]: {
        opens_at: g.opens_at,
        closes_at: g.closes_at,
        soft_capacity: g.soft_capacity == null ? "" : String(g.soft_capacity),
        previousName: g.name,
      },
    });
    setDays(g.days);
    setEveryDay(g.everyDay);
  }

  function onSave() {
    const entries = Object.entries(selected);
    startTransition(async () => {
      const result = await saveReservationServiceGroups({
        business_slug: slug,
        services: entries.map(([name, d]) => ({
          name,
          ...(d.previousName ? { previous_name: d.previousName } : {}),
          opens_at: d.opens_at,
          closes_at: d.closes_at,
          soft_capacity: d.soft_capacity === "" ? null : Number(d.soft_capacity),
        })),
        days,
        every_day: everyDay,
        floor_plan_ids: zones,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(
        `${result.data.services} ${result.data.services === 1 ? "servicio" : "servicios"} · ${result.data.rows} ${result.data.rows === 1 ? "día" : "días"}`,
      );
      resetForm();
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
      if (selected[g.name]) resetForm();
      toast.success("Servicio eliminado");
      router.refresh();
    });
  }

  const selectedNames = Object.keys(selected);
  const canSave =
    selectedNames.length > 0 && (everyDay || days.length > 0) && !pending;

  return (
    <section className="space-y-4 rounded-2xl border bg-card p-5">
      <header>
        <h2 className="text-lg font-semibold">Servicios</h2>
        <p className="text-sm text-muted-foreground">
          Marcá los <strong>servicios</strong> y los <strong>días</strong>, y se cargan todos
          juntos. Cada servicio lleva su horario y un <strong>cupo blando</strong> de cubiertos
          opcional (avisa, no bloquea).
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
            {selectedNames.length > 0
              ? `Cargando: ${selectedNames.join(" + ")}`
              : "Nuevo servicio"}
          </h3>
          {selectedNames.length > 0 ? (
            <Button type="button" variant="ghost" size="xs" onClick={resetForm}>
              <X className="size-3" /> Limpiar
            </Button>
          ) : null}
        </div>

        {/* Servicios: se marcan igual que los días */}
        <div className="space-y-2">
          <Label>Servicios</Label>
          <div className="flex flex-wrap items-center gap-1.5">
            {serviceChips.map((name) => {
              const active = !!selected[name];
              return (
                <button
                  key={name}
                  type="button"
                  onClick={() => toggleService(name)}
                  aria-pressed={active}
                  className={`h-9 rounded-md border px-3 text-sm font-medium transition ${
                    active
                      ? "border-transparent bg-primary text-primary-foreground"
                      : "bg-background hover:bg-muted"
                  }`}
                >
                  {name}
                </button>
              );
            })}
            <span className="mx-1 text-muted-foreground">|</span>
            <Input
              value={newName}
              placeholder="Otro (ej: Merienda)"
              maxLength={40}
              className="h-9 w-44"
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addNewName();
                }
              }}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={addNewName}
              disabled={!newName.trim()}
            >
              <Plus className="size-3" /> Sumar
            </Button>
          </div>
        </div>

        {/* Horario + cupo de cada servicio marcado (Almuerzo y Cena no comparten horario) */}
        {selectedNames.length > 0 ? (
          <div className="space-y-2">
            {selectedNames.map((name) => {
              const d = selected[name];
              return (
                <div
                  key={name}
                  className="flex flex-wrap items-center gap-2 rounded-md border bg-background p-2"
                >
                  <span className="min-w-24 text-sm font-medium">{name}</span>
                  <Input
                    type="time"
                    value={d.opens_at}
                    onChange={(e) => patchService(name, { opens_at: e.target.value })}
                    className="w-24"
                    aria-label={`${name}: abre`}
                  />
                  <span className="text-muted-foreground">–</span>
                  <Input
                    type="time"
                    value={d.closes_at}
                    onChange={(e) => patchService(name, { closes_at: e.target.value })}
                    className="w-24"
                    aria-label={`${name}: cierra`}
                  />
                  <Input
                    type="number"
                    min={1}
                    placeholder="cupo (opcional)"
                    value={d.soft_capacity}
                    onChange={(e) => patchService(name, { soft_capacity: e.target.value })}
                    className="w-40"
                    aria-label={`${name}: cupo blando`}
                  />
                </div>
              );
            })}
          </div>
        ) : null}

        {/* Días: multi-selección — los mismos días para todos los servicios marcados. */}
        <div className="space-y-2">
          <Label>Días</Label>
          <div className="flex flex-wrap items-center gap-1.5">
            {WEEK.map((d) => {
              const active = !everyDay && days.includes(d.value);
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
              variant={everyDay ? "default" : "outline"}
              size="sm"
              onClick={() => {
                setEveryDay((v) => !v);
                setDays([]);
              }}
            >
              Todos los días
            </Button>
            {!everyDay && days.length > 0 ? (
              <Button type="button" variant="ghost" size="sm" onClick={() => setDays([])}>
                Limpiar
              </Button>
            ) : null}
          </div>
        </div>

        {/* Zonas: se marcan igual que los días y los servicios. Sin ninguna
            marcada, el servicio aplica a todo el negocio. */}
        {salones.length > 0 ? (
          <div className="space-y-2">
            <Label>Zonas</Label>
            <div className="flex flex-wrap items-center gap-1.5">
              <Button
                type="button"
                variant={zones.length === 0 ? "default" : "outline"}
                size="sm"
                onClick={() => setZones([])}
              >
                Todo el negocio
              </Button>
              <span className="mx-1 text-muted-foreground">|</span>
              {salones.map((s) => {
                const active = zones.includes(s.id);
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => toggleZone(s.id)}
                    aria-pressed={active}
                    className={`h-9 rounded-md border px-3 text-sm font-medium transition ${
                      active
                        ? "border-transparent bg-primary text-primary-foreground"
                        : "bg-background hover:bg-muted"
                    }`}
                  >
                    {s.name}
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-muted-foreground">
              El cupo se cuenta por zona. Sin zonas marcadas, el servicio vale para todo el
              negocio.
            </p>
          </div>
        ) : null}

        <div className="flex items-center gap-2">
          <Button type="button" onClick={onSave} disabled={!canSave}>
            <Save className="size-4" /> Guardar
          </Button>
          <span className="text-xs text-muted-foreground">
            {selectedNames.length === 0
              ? "Marcá al menos un servicio y un día."
              : `Se aplica a ${selectedNames.length} ${selectedNames.length === 1 ? "servicio" : "servicios"} × ${everyDay ? "todos los días" : `${days.length} ${days.length === 1 ? "día" : "días"}`} × ${zones.length === 0 ? "todo el negocio" : `${zones.length} ${zones.length === 1 ? "zona" : "zonas"}`}.`}
          </span>
        </div>
      </div>
    </section>
  );
}
