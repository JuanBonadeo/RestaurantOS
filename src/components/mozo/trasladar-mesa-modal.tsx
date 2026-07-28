"use client";

import { useState } from "react";
import { Armchair, Check, MoveRight, Wine, X } from "lucide-react";
import { toast } from "sonner";

import { trasladarMesa } from "@/lib/mozo/actions";

export type DestTable = {
  id: string;
  label: string;
  seats: number;
  is_bar?: boolean;
};

type Props = {
  fromTableId: string;
  fromLabel: string;
  /** Mesas destino candidatas (ya filtradas: libres, distintas de la origen). */
  tables: DestTable[];
  businessSlug: string;
  onClose: () => void;
  onSuccess: (toTableId: string) => void;
};

export function TrasladarMesaModal({
  fromTableId,
  fromLabel,
  tables,
  businessSlug,
  onClose,
  onSuccess,
}: Props) {
  const [toTableId, setToTableId] = useState<string>(tables[0]?.id ?? "");
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async () => {
    if (!toTableId) {
      toast.error("Elegí una mesa destino.");
      return;
    }
    setSubmitting(true);
    const result = await trasladarMesa(fromTableId, toTableId, businessSlug);
    setSubmitting(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success("Mesa trasladada.");
    onSuccess(toTableId);
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-black/50 sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-t-3xl bg-white p-5 pb-[max(env(safe-area-inset-bottom),1.25rem)] shadow-2xl sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-zinc-300 sm:hidden" />
        <div className="flex items-start justify-between gap-3">
          <h3 className="font-heading text-lg font-bold leading-tight">
            Trasladar mesa {fromLabel}
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="-mr-1 -mt-1 rounded-full p-2 text-zinc-500 transition active:scale-95 active:bg-zinc-100"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="mt-4">
          <label className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">
            Mover a
          </label>
          {tables.length === 0 ? (
            <p className="mt-2 rounded-xl bg-zinc-50 px-3 py-3 text-sm text-zinc-500">
              No hay mesas libres para mover. Cobrá o liberá una primero.
            </p>
          ) : (
            <div className="mt-2 max-h-72 overflow-y-auto rounded-2xl ring-1 ring-zinc-200">
              {tables.map((t) => {
                const selected = t.id === toTableId;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setToTableId(t.id)}
                    className={`flex w-full items-center gap-3 border-b border-zinc-100 px-4 py-3 text-left transition last:border-b-0 active:bg-zinc-50 ${
                      selected ? "bg-sky-50" : ""
                    }`}
                  >
                    <span
                      className={`flex h-10 w-10 items-center justify-center rounded-full text-white ${
                        selected ? "bg-sky-600" : "bg-zinc-700"
                      }`}
                    >
                      {t.is_bar ? (
                        <Wine className="h-4 w-4" />
                      ) : (
                        <Armchair className="h-4 w-4" />
                      )}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-zinc-900">
                        Mesa {t.label}
                        {t.is_bar ? " · barra" : ""}
                      </p>
                      <p className="text-xs text-zinc-500">
                        {t.seats} {t.seats === 1 ? "silla" : "sillas"} · libre
                      </p>
                    </div>
                    {selected && <Check className="h-5 w-5 text-sky-600" />}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <button
          type="button"
          disabled={submitting || !toTableId}
          onClick={onSubmit}
          className="mt-5 flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-sky-600 text-base font-bold text-white shadow-sm transition active:scale-[0.98] disabled:opacity-50"
        >
          <MoveRight className="h-5 w-5" />
          {submitting ? "Trasladando…" : "Trasladar mesa"}
        </button>
      </div>
    </div>
  );
}
