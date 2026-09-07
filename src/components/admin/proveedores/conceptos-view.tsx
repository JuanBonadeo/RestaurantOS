"use client";

import { useState, useTransition } from "react";
import { Pencil, Plus } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  createExpenseConcept,
  updateExpenseConcept,
} from "@/lib/proveedores/cuenta-corriente-actions";
import {
  EXPENSE_RUBROS,
  RUBRO_LABELS,
  type ExpenseRubro,
} from "@/lib/proveedores/schema";
import { cn } from "@/lib/utils";

export type ConceptoRow = {
  id: string;
  name: string;
  rubro: string;
  is_active: boolean;
};

type Props = {
  slug: string;
  conceptos: ConceptoRow[];
};

/**
 * El ABM de conceptos de gasto — spec 162.
 *
 * `createExpenseConcept` y `updateExpenseConcept` estaban escritas, validadas y
 * con manejo del 23505 desde la 158, y **sin un solo importador**: los tres
 * negocios tenían exactamente los conceptos del seed y no había forma de tocar
 * la lista. Figuraba en el alcance de dominio y de permisos de aquella spec; la
 * sección de UI nunca la pidió.
 *
 * Y el catálogo no es fijo: el Golf usó 38 conceptos distintos y suma ~2 por año
 * —DESCARTABLES en 2024, ADELANTO en 2025—. Sin pantalla, cada uno era un ticket
 * de dev más una migración, para siempre, por local.
 */
export function ConceptosView({ slug, conceptos }: Props) {
  const [editando, setEditando] = useState<ConceptoRow | null>(null);
  const [creando, setCreando] = useState(false);

  const porRubro = EXPENSE_RUBROS.map((r) => ({
    rubro: r,
    items: conceptos.filter((c) => c.rubro === r),
  })).filter((g) => g.items.length > 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-zinc-900">
            Conceptos de gasto
          </h2>
          <p className="text-xs text-zinc-500">
            En qué se clasifica cada compra. El proveedor precarga el suyo.
          </p>
        </div>
        <Button size="sm" onClick={() => setCreando(true)}>
          <Plus className="mr-1.5 size-4" />
          Nuevo concepto
        </Button>
      </div>

      {porRubro.length === 0 ? (
        <p className="rounded-lg border border-dashed border-zinc-200 p-8 text-center text-sm text-zinc-500">
          Todavía no hay conceptos.
        </p>
      ) : (
        <div className="space-y-5">
          {porRubro.map((g) => (
            <div key={g.rubro}>
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
                {RUBRO_LABELS[g.rubro]}
              </p>
              <ul className="divide-y divide-zinc-100 overflow-hidden rounded-lg border border-zinc-200">
                {g.items.map((c) => (
                  <li
                    key={c.id}
                    className="flex items-center justify-between bg-white px-3 py-2"
                  >
                    <span
                      className={cn(
                        "text-sm",
                        c.is_active
                          ? "text-zinc-900"
                          : "text-zinc-400 line-through",
                      )}
                    >
                      {c.name}
                      {!c.is_active && (
                        <span className="ml-2 text-[11px] no-underline">
                          inactivo
                        </span>
                      )}
                    </span>
                    <button
                      type="button"
                      onClick={() => setEditando(c)}
                      className="rounded p-1 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-900"
                      aria-label={`Editar ${c.name}`}
                    >
                      <Pencil className="size-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      {(creando || editando) && (
        <ConceptoDialog
          slug={slug}
          concepto={editando}
          onClose={() => {
            setCreando(false);
            setEditando(null);
          }}
        />
      )}
    </div>
  );
}

function ConceptoDialog({
  slug,
  concepto,
  onClose,
}: {
  slug: string;
  concepto: ConceptoRow | null;
  onClose: () => void;
}) {
  const [name, setName] = useState(concepto?.name ?? "");
  const [rubro, setRubro] = useState<ExpenseRubro>(
    (concepto?.rubro as ExpenseRubro) ?? "mercaderias",
  );
  const [activo, setActivo] = useState(concepto?.is_active ?? true);
  const [pending, start] = useTransition();

  function guardar() {
    const input = { name: name.trim(), rubro, is_active: activo };
    if (!input.name) {
      toast.error("Escribí un nombre.");
      return;
    }

    start(async () => {
      const r = concepto
        ? await updateExpenseConcept(slug, concepto.id, input)
        : await createExpenseConcept(slug, input);

      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success(concepto ? "Concepto actualizado." : "Concepto creado.");
      onClose();
    });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>
            {concepto ? "Editar concepto" : "Nuevo concepto"}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="concepto-name">Nombre</Label>
            <Input
              id="concepto-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Lavadero"
              maxLength={60}
              autoFocus
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="concepto-rubro">Rubro</Label>
            <select
              id="concepto-rubro"
              value={rubro}
              onChange={(e) => setRubro(e.target.value as ExpenseRubro)}
              className="h-9 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm"
            >
              {EXPENSE_RUBROS.map((r) => (
                <option key={r} value={r}>
                  {RUBRO_LABELS[r]}
                </option>
              ))}
            </select>
          </div>

          {/* No se borra, se desactiva: un concepto borrado deja huérfanos los
              comprobantes que ya lo usaron, y el informe de la 158 empieza a
              decir «Sin concepto» sobre plata que sí estaba clasificada. */}
          <label className="flex items-center gap-2 text-sm text-zinc-700">
            <input
              type="checkbox"
              checked={activo}
              onChange={(e) => setActivo(e.target.checked)}
              className="size-4 rounded border-zinc-300"
            />
            Activo — aparece al cargar una compra
          </label>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            Cancelar
          </Button>
          <Button onClick={guardar} disabled={pending}>
            {pending ? "Guardando…" : "Guardar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
