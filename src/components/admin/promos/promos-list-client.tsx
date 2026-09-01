"use client";

import Link from "next/link";
import { useTransition } from "react";
import {
  Check,
  ChevronRight,
  Copy,
  Pencil,
  Plus,
  Tag,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import { deletePromoCode, togglePromoActive } from "@/lib/admin/promos-actions";
import { formatPromoDiscount, type PromoCode } from "@/lib/promos/types";
import { cn } from "@/lib/utils";
import { AyudaChip } from "@/components/admin/ayuda-chip";

export function PromosListClient({
  slug,
  initialPromos,
}: {
  slug: string;
  initialPromos: PromoCode[];
}) {
  const [isPending, startTransition] = useTransition();

  const onCopyCode = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      toast.success(`"${code}" copiado al portapapeles.`);
    } catch {
      toast.error("No pudimos copiar el código.");
    }
  };

  const onToggle = (id: string, next: boolean) => {
    startTransition(async () => {
      const result = await togglePromoActive({
        business_slug: slug,
        id,
        is_active: next,
      });
      if (!result.ok) toast.error(result.error);
      else toast.success(next ? "Promoción activada." : "Promoción pausada.");
    });
  };

  const onDelete = (id: string, code: string) => {
    if (!window.confirm(`¿Eliminar el código "${code}"? Esta acción no se puede deshacer.`)) {
      return;
    }
    startTransition(async () => {
      const result = await deletePromoCode({ business_slug: slug, id });
      if (!result.ok) toast.error(result.error);
      else toast.success("Promoción eliminada.");
    });
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[0.65rem] font-semibold uppercase tracking-[0.18em] text-zinc-500">
            Promociones
          </p>
          <div className="mt-1 flex items-center gap-1">
            <h1 className="text-3xl font-semibold tracking-tight text-zinc-900">
              Códigos de descuento
            </h1>
            <AyudaChip slug={slug} tema="promociones" />
          </div>
          <p className="mt-1 text-sm text-zinc-600">
            Creá un código y compartilo por WhatsApp. Tus clientes lo aplican en el checkout.
          </p>
        </div>
        <Link
          href={`/${slug}/admin/promociones/nueva`}
          className="inline-flex items-center gap-2 self-start rounded-full px-4 py-2 text-sm font-semibold transition hover:brightness-95 active:translate-y-px"
          style={{
            background: "var(--brand, #18181B)",
            color: "var(--brand-foreground, white)",
          }}
        >
          <Plus className="size-4" strokeWidth={2.5} />
          Nueva promoción
        </Link>
      </div>

      {initialPromos.length === 0 ? (
        <EmptyState slug={slug} />
      ) : (
        <div className="overflow-hidden rounded-2xl bg-white ring-1 ring-zinc-200/70">
          <ul>
            {initialPromos.map((p, idx) => (
              <PromoRow
                key={p.id}
                promo={p}
                slug={slug}
                striped={idx % 2 === 1}
                isPending={isPending}
                onCopy={onCopyCode}
                onToggle={onToggle}
                onDelete={onDelete}
              />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ─── Single promo row ─────────────────────────────────────────────────────────

function PromoRow({
  promo,
  slug,
  striped,
  isPending,
  onCopy,
  onToggle,
  onDelete,
}: {
  promo: PromoCode;
  slug: string;
  striped: boolean;
  isPending: boolean;
  onCopy: (code: string) => void;
  onToggle: (id: string, next: boolean) => void;
  onDelete: (id: string, code: string) => void;
}) {
  const usage =
    promo.max_uses === null
      ? `${promo.uses_count} usos`
      : `${promo.uses_count} / ${promo.max_uses}`;
  const isExhausted =
    promo.max_uses !== null && promo.uses_count >= promo.max_uses;
  const isExpired =
    promo.valid_until !== null && new Date(promo.valid_until).getTime() < Date.now();
  const isStarted =
    !promo.valid_from || new Date(promo.valid_from).getTime() <= Date.now();

  const status: { label: string; tone: string; dot: string } =
    !promo.is_active
      ? { label: "Pausado", tone: "text-zinc-700 bg-zinc-100", dot: "bg-zinc-400" }
      : isExhausted
        ? { label: "Sin usos", tone: "text-rose-800 bg-rose-50", dot: "bg-rose-500" }
        : isExpired
          ? { label: "Vencido", tone: "text-rose-800 bg-rose-50", dot: "bg-rose-500" }
          : !isStarted
            ? { label: "Programado", tone: "text-amber-800 bg-amber-50", dot: "bg-amber-500" }
            : { label: "Activo", tone: "text-emerald-800 bg-emerald-50", dot: "bg-emerald-500" };

  const validRange =
    promo.valid_from || promo.valid_until
      ? [
          promo.valid_from
            ? `desde ${new Date(promo.valid_from).toLocaleDateString("es-AR", { day: "numeric", month: "short" })}`
            : null,
          promo.valid_until
            ? `hasta ${new Date(promo.valid_until).toLocaleDateString("es-AR", { day: "numeric", month: "short" })}`
            : null,
        ]
          .filter(Boolean)
          .join(" ")
      : "Sin vencimiento";

  return (
    <li
      style={
        striped
          ? { background: "color-mix(in oklch, var(--brand, #2563eb) 14%, white)" }
          : undefined
      }
      className="border-b border-zinc-100 last:border-b-0"
    >
      <div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center">
        {/* Left: code + status + meta */}
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <span
            className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-zinc-900 px-3 py-2 font-mono text-sm font-bold uppercase text-zinc-50"
            title="Código"
          >
            <Tag className="size-3.5" strokeWidth={2.5} />
            {promo.code}
          </span>
          <button
            type="button"
            onClick={() => onCopy(promo.code)}
            className="inline-flex shrink-0 items-center gap-1 rounded-full bg-zinc-100 px-2.5 py-1 text-[0.65rem] font-medium text-zinc-600 transition hover:bg-zinc-200 hover:text-zinc-900"
            title="Copiar código"
          >
            <Copy className="size-3" />
            Copiar
          </button>
          <div className="min-w-0 flex-1">
            <p className="text-base font-semibold text-zinc-900">
              {formatPromoDiscount(promo)}
              {promo.min_order_cents > 0 && (
                <span className="ml-2 text-xs font-normal text-zinc-500">
                  · mín ${(promo.min_order_cents / 100).toLocaleString("es-AR")}
                </span>
              )}
            </p>
            <p className="mt-0.5 truncate text-xs text-zinc-500">
              {promo.description ?? validRange} · {usage}
            </p>
          </div>
        </div>

        {/* Right: status + actions */}
        <div className="flex shrink-0 items-center gap-2">
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[0.65rem] font-semibold",
              status.tone,
            )}
          >
            <span className={cn("size-1.5 rounded-full", status.dot)} />
            {status.label}
          </span>

          <button
            type="button"
            onClick={() => onToggle(promo.id, !promo.is_active)}
            disabled={isPending}
            title={promo.is_active ? "Pausar" : "Activar"}
            className={cn(
              "inline-flex size-8 items-center justify-center rounded-full transition disabled:cursor-wait disabled:opacity-50",
              promo.is_active
                ? "bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                : "bg-zinc-100 text-zinc-500 hover:bg-zinc-200",
            )}
          >
            {promo.is_active ? <Check className="size-3.5" /> : <Tag className="size-3.5" />}
          </button>

          <Link
            href={`/${slug}/admin/promociones/${promo.id}`}
            className="inline-flex size-8 items-center justify-center rounded-full text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900"
            title="Editar"
          >
            <Pencil className="size-3.5" />
          </Link>

          <button
            type="button"
            onClick={() => onDelete(promo.id, promo.code)}
            disabled={isPending}
            title="Eliminar"
            className="inline-flex size-8 items-center justify-center rounded-full text-zinc-400 transition hover:bg-rose-50 hover:text-rose-600 disabled:cursor-wait disabled:opacity-50"
          >
            <Trash2 className="size-3.5" />
          </button>

          <ChevronRight className="ml-1 size-4 text-zinc-300" aria-hidden />
        </div>
      </div>
    </li>
  );
}

// ─── Empty state ──────────────────────────────────────────────────────────────

function EmptyState({ slug }: { slug: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-2xl bg-white p-12 text-center ring-1 ring-zinc-200/70">
      <Tag className="size-8 text-zinc-300" strokeWidth={1.5} />
      <p className="text-sm font-medium text-zinc-700">Todavía no creaste promociones</p>
      <p className="max-w-sm text-xs text-zinc-500">
        Las promos te sirven para incentivar nuevos clientes (ej: BIENVENIDO20) o reactivar inactivos (VUELVE10).
      </p>
      <Link
        href={`/${slug}/admin/promociones/nueva`}
        className="mt-2 inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition hover:brightness-95"
        style={{
          background: "var(--brand, #18181B)",
          color: "var(--brand-foreground, white)",
        }}
      >
        <Plus className="size-4" strokeWidth={2.5} />
        Crear la primera
      </Link>
    </div>
  );
}
