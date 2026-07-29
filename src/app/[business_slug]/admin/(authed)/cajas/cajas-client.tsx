"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Pencil, Plus, Wallet } from "lucide-react";
import { toast } from "sonner";

import { Surface } from "@/components/admin/shell/page-shell";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  crearCaja,
  renombrarCaja,
  setCajaActive,
  setCajaDefault,
} from "@/lib/caja/actions";
import type { Caja } from "@/lib/caja/types";
import { cn } from "@/lib/utils";

type Props = {
  slug: string;
  cajas: Caja[];
};

/**
 * Pantalla de configuración de cajas físicas. Solo admin.
 *
 * Acciones disponibles:
 *  - Crear nueva caja (botón "+ Nueva caja" en el header).
 *  - Renombrar (icono lápiz).
 *  - Deshabilitar (icono ojo tachado) — soft delete.
 *  - Re-habilitar una pausada (botón "Habilitar").
 *
 * El día a día (sangrías, cortes, etc.) vive en
 * `/admin/operacion?tab=caja`. Acá solo se administra el catálogo.
 */
export function CajasClient({ slug, cajas }: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();

  const [crearOpen, setCrearOpen] = useState(false);
  const [editing, setEditing] = useState<Caja | null>(null);

  const activas = cajas.filter((c) => c.is_active);
  const inactivas = cajas.filter((c) => !c.is_active);

  const handleToggleActive = (caja: Caja, next: boolean) => {
    startTransition(async () => {
      const r = await setCajaActive(caja.id, next, slug);
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success(next ? "Caja habilitada" : "Caja deshabilitada");
      router.refresh();
    });
  };

  const handleSetDefault = (caja: Caja) => {
    startTransition(async () => {
      const r = await setCajaDefault(caja.id, slug);
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success(`Los cobros online van a ${caja.name}`);
      router.refresh();
    });
  };

  return (
    <>
      {/* Acción nueva caja arriba a la derecha. */}
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => setCrearOpen(true)}
          className="inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition hover:brightness-95 active:translate-y-px"
          style={{
            background: "var(--brand, #18181B)",
            color: "var(--brand-foreground, white)",
          }}
        >
          <Plus className="size-4" />
          Nueva caja
        </button>
      </div>

      {/* Empty global */}
      {cajas.length === 0 && (
        <Surface padding="default">
          <div className="mx-auto flex max-w-md flex-col items-center gap-3 py-8 text-center">
            <div
              className="flex size-12 items-center justify-center rounded-full"
              style={{ background: "var(--brand-soft, #F4F4F5)" }}
            >
              <Wallet
                className="size-6"
                style={{ color: "var(--brand, #18181B)" }}
              />
            </div>
            <div>
              <h3 className="text-lg font-semibold tracking-tight text-zinc-900">
                Todavía no hay cajas
              </h3>
              <p className="mt-1 text-sm text-zinc-600">
                Creá la primera caja del local. Una caja = un lugar donde se
                cobra (Salón, Barra, Caja 1…).
              </p>
            </div>
            <button
              type="button"
              onClick={() => setCrearOpen(true)}
              className="mt-1 inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition hover:brightness-95"
              style={{
                background: "var(--brand, #18181B)",
                color: "var(--brand-foreground, white)",
              }}
            >
              <Plus className="size-4" />
              Crear primera caja
            </button>
          </div>
        </Surface>
      )}

      {/* Activas */}
      {activas.length > 0 && (
        <Surface padding="default" className="space-y-3">
          <p className="text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-zinc-500">
            Activas · {activas.length}
          </p>
          <ul className="divide-y divide-zinc-100 rounded-xl ring-1 ring-zinc-200/70">
            {activas.map((c, idx) => (
              <CajaRow
                key={c.id}
                caja={c}
                stripe={idx % 2 === 1}
                onRenombrar={() => setEditing(c)}
                onDeshabilitar={() => handleToggleActive(c, false)}
                onHacerDefault={() => handleSetDefault(c)}
              />
            ))}
          </ul>
        </Surface>
      )}

      {/* Inactivas */}
      {inactivas.length > 0 && (
        <Surface tone="subtle" padding="compact" className="space-y-3">
          <p className="text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-zinc-500">
            Pausadas · {inactivas.length}
          </p>
          <p className="text-xs text-zinc-500">
            No aparecen para cobrar. El histórico de cortes sigue accesible.
          </p>
          <ul className="space-y-1.5">
            {inactivas.map((c) => (
              <li
                key={c.id}
                className="flex items-center justify-between rounded-lg bg-white px-3 py-2 ring-1 ring-zinc-200/70"
              >
                <div className="flex items-center gap-2.5">
                  <Wallet className="size-3.5 text-zinc-400" />
                  <span className="text-sm text-zinc-600">{c.name}</span>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setEditing(c)}
                    className="inline-flex size-7 items-center justify-center rounded-full text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-900"
                    aria-label="Renombrar"
                    title="Renombrar"
                  >
                    <Pencil className="size-3" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleToggleActive(c, true)}
                    className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold text-zinc-700 transition hover:bg-zinc-100"
                  >
                    <Eye className="size-3" />
                    Habilitar
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </Surface>
      )}

      {/* Modal: crear caja */}
      <CrearCajaModal
        open={crearOpen}
        onOpenChange={setCrearOpen}
        slug={slug}
        onCreated={() => {
          setCrearOpen(false);
          router.refresh();
        }}
      />

      {/* Modal: renombrar */}
      {editing && (
        <RenombrarCajaModal
          open={editing !== null}
          caja={editing}
          slug={slug}
          onOpenChange={(o) => !o && setEditing(null)}
          onRenamed={() => {
            setEditing(null);
            router.refresh();
          }}
        />
      )}
    </>
  );
}

// ── Fila de caja activa ─────────────────────────────────────────

function CajaRow({
  caja,
  stripe,
  onRenombrar,
  onDeshabilitar,
  onHacerDefault,
}: {
  caja: Caja;
  stripe: boolean;
  onRenombrar: () => void;
  onDeshabilitar: () => void;
  onHacerDefault: () => void;
}) {
  return (
    <li
      className={cn(
        "flex items-center justify-between gap-3 px-4 py-3",
        stripe ? "bg-zinc-50/50" : "bg-white",
      )}
    >
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-700">
          <Wallet className="size-4" />
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-zinc-900">
            {caja.name}
          </p>
          <p className="inline-flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-emerald-700">
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block size-1.5 rounded-full bg-emerald-500" />
              Activa
            </span>
            {caja.is_default && (
              <span className="inline-flex items-center rounded-full bg-zinc-900 px-2 py-0.5 text-[0.65rem] font-semibold text-white">
                Por defecto
              </span>
            )}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={onRenombrar}
          className="inline-flex size-8 items-center justify-center rounded-full text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900"
          aria-label="Renombrar"
          title="Renombrar"
        >
          <Pencil className="size-3.5" />
        </button>
        {!caja.is_default && (
          <button
            type="button"
            onClick={onHacerDefault}
            className="inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold text-zinc-600 transition hover:bg-zinc-100 hover:text-zinc-900"
            title="Los cobros sin cajero (pago online) se asientan acá"
          >
            Hacer por defecto
          </button>
        )}
        <button
          type="button"
          onClick={onDeshabilitar}
          className="inline-flex size-8 items-center justify-center rounded-full text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900"
          aria-label="Deshabilitar"
          title="Deshabilitar"
        >
          <EyeOff className="size-3.5" />
        </button>
      </div>
    </li>
  );
}

// ── Modales ─────────────────────────────────────────────────────

function CrearCajaModal({
  open,
  onOpenChange,
  slug,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  slug: string;
  onCreated: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState("");

  const submit = () => {
    const trimmed = name.trim();
    if (trimmed === "") return;
    startTransition(async () => {
      const r = await crearCaja(trimmed, slug);
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success(`Caja "${r.data.name}" creada`);
      setName("");
      onCreated();
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) setName("");
        onOpenChange(o);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nueva caja</DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          <Label>Nombre</Label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Salón / Barra / Caja 1…"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
            }}
          />
          <p className="text-xs text-zinc-500">
            Usá el nombre que figura físicamente. Único por local.
          </p>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button disabled={name.trim() === "" || pending} onClick={submit}>
            {pending ? "Creando…" : "Crear"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RenombrarCajaModal({
  open,
  caja,
  slug,
  onOpenChange,
  onRenamed,
}: {
  open: boolean;
  caja: Caja;
  slug: string;
  onOpenChange: (o: boolean) => void;
  onRenamed: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState(caja.name);

  const submit = () => {
    const trimmed = name.trim();
    if (trimmed === "" || trimmed === caja.name) {
      onOpenChange(false);
      return;
    }
    startTransition(async () => {
      const r = await renombrarCaja(caja.id, trimmed, slug);
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success("Caja renombrada");
      onRenamed();
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Renombrar caja</DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          <Label>Nombre</Label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
            }}
          />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button disabled={pending} onClick={submit}>
            {pending ? "Guardando…" : "Guardar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
