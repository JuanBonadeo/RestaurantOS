"use client";

import { useState } from "react";
import { Check, X } from "lucide-react";
import { toast } from "sonner";

import { transferTable } from "@/lib/mozo/actions";
import type { MozoMember } from "@/lib/mozo/queries";

type Props = {
  tableId: string;
  tableLabel: string;
  currentMozoId: string | null;
  mozos: MozoMember[];
  businessSlug: string;
  onClose: () => void;
  /** Recibe el `user_id` del mozo destino, para overlay optimista del llamador. */
  onSuccess: (toMozoId: string) => void;
};

export function TransferTableModal({
  tableId,
  tableLabel,
  currentMozoId,
  mozos,
  businessSlug,
  onClose,
  onSuccess,
}: Props) {
  const candidates = mozos.filter((m) => m.user_id !== currentMozoId);
  const [toMozoId, setToMozoId] = useState<string>(
    candidates[0]?.user_id ?? "",
  );
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async () => {
    if (!toMozoId) {
      toast.error("Elegí un mozo destino.");
      return;
    }
    setSubmitting(true);
    const result = await transferTable(
      tableId,
      toMozoId,
      businessSlug,
      reason.trim() || undefined,
    );
    setSubmitting(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success("Mesa transferida.");
    onSuccess(toMozoId);
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
            Transferir mozo · Mesa {tableLabel}
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

        <div className="mt-4 space-y-4">
          <div>
            <label className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">
              Pasar a
            </label>
            {candidates.length === 0 ? (
              <p className="mt-2 rounded-xl bg-zinc-50 px-3 py-3 text-sm text-zinc-500">
                No hay otros mozos disponibles.
              </p>
            ) : (
              <div className="mt-2 max-h-64 overflow-y-auto rounded-2xl ring-1 ring-zinc-200">
                {candidates.map((m) => (
                  <button
                    key={m.user_id}
                    type="button"
                    onClick={() => setToMozoId(m.user_id)}
                    className={`flex w-full items-center gap-3 border-b border-zinc-100 px-4 py-3 text-left transition last:border-b-0 active:bg-zinc-50 ${
                      m.user_id === toMozoId ? "bg-sky-50" : ""
                    }`}
                  >
                    <span
                      className={`flex h-10 w-10 items-center justify-center rounded-full text-xs font-bold text-white ${
                        m.user_id === toMozoId ? "bg-sky-600" : "bg-zinc-700"
                      }`}
                    >
                      {(m.full_name ?? "??")
                        .split(" ")
                        .slice(0, 2)
                        .map((p) => p[0]?.toUpperCase() ?? "")
                        .join("")}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-zinc-900">
                        {m.full_name ?? m.user_id}
                      </p>
                      <p className="text-xs capitalize text-zinc-500">
                        {m.role}
                      </p>
                    </div>
                    {m.user_id === toMozoId && (
                      <Check className="h-5 w-5 text-sky-600" />
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div>
            <label className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">
              Motivo (opcional)
            </label>
            <textarea
              className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-base"
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Ej: salgo a fumar, cambio de turno…"
            />
          </div>
        </div>

        <button
          type="button"
          disabled={submitting || !toMozoId}
          onClick={onSubmit}
          className="mt-5 flex h-14 w-full items-center justify-center rounded-2xl bg-sky-600 text-base font-bold text-white shadow-sm transition active:scale-[0.98] disabled:opacity-50"
        >
          {submitting ? "Transferiendo…" : "Transferir mozo"}
        </button>
      </div>
    </div>
  );
}
