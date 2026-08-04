"use client";

import { useRef, useState } from "react";
import { Check, Search, X } from "lucide-react";
import { toast } from "sonner";

import { transferTable } from "@/lib/mozo/actions";
import { filterMozos, shouldShowMozoSearch } from "@/lib/mozo/mozo-search";
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
  const [search, setSearch] = useState("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  // El buscador aparece recién cuando la lista se hace larga (spec 079): con un
  // equipo chico entran todos y el input sólo empuja la lista hacia abajo.
  const showSearch = shouldShowMozoSearch(candidates.length);
  const visibles = showSearch ? filterMozos(candidates, search) : candidates;

  /**
   * Sólo se transfiere a quien está viendo (FR-003): si el elegido quedó fuera
   * de la búsqueda, el destino vale vacío y el CTA se apaga. Es derivado y no
   * un `useEffect` que borre `toMozoId`, así al limpiar la búsqueda el que
   * habías elegido vuelve a estar elegido.
   *
   * Sin esto el modal diría «Transferir mozo» con un destino que no está en
   * pantalla — y transferir le manda notificación al mozo destino, así que el
   * error se cometería sin verlo.
   */
  const effectiveToMozoId = visibles.some((m) => m.user_id === toMozoId)
    ? toMozoId
    : "";

  const onSubmit = async () => {
    if (!effectiveToMozoId) {
      toast.error("Elegí un mozo destino.");
      return;
    }
    setSubmitting(true);
    const result = await transferTable(
      tableId,
      effectiveToMozoId,
      businessSlug,
      reason.trim() || undefined,
    );
    setSubmitting(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success("Mesa transferida.");
    onSuccess(effectiveToMozoId);
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
          <h3 className="font-heading text-lg leading-tight font-bold">
            Transferir mozo · Mesa {tableLabel}
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="-mt-1 -mr-1 rounded-full p-2 text-zinc-500 transition active:scale-95 active:bg-zinc-100"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="mt-4 space-y-4">
          <div>
            <label className="text-[11px] font-bold tracking-wider text-zinc-500 uppercase">
              Pasar a
            </label>
            {showSearch && (
              /* Sin `autoFocus`: en el teléfono del mozo el teclado se come
                 justo la lista que viene a mirar. */
              <div className="relative mt-2">
                <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-zinc-400" />
                <input
                  ref={searchRef}
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Buscar mozo…"
                  aria-label="Buscar mozo"
                  autoComplete="off"
                  className="block h-11 w-full rounded-2xl border border-zinc-200 bg-white pr-9 pl-9 text-base focus:border-sky-400 focus:ring-2 focus:ring-sky-100 focus:outline-none"
                />
                {search.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      setSearch("");
                      searchRef.current?.focus();
                    }}
                    className="absolute top-1/2 right-2 -translate-y-1/2 rounded-full p-1 text-zinc-400 active:bg-zinc-100"
                    aria-label="Limpiar"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
            )}

            {candidates.length === 0 ? (
              <p className="mt-2 rounded-xl bg-zinc-50 px-3 py-3 text-sm text-zinc-500">
                No hay otros mozos disponibles.
              </p>
            ) : visibles.length === 0 ? (
              <p className="mt-2 rounded-xl bg-zinc-50 px-3 py-3 text-sm text-zinc-500">
                Ningún mozo coincide con la búsqueda.
              </p>
            ) : (
              <div className="mt-2 max-h-64 overflow-y-auto rounded-2xl ring-1 ring-zinc-200">
                {visibles.map((m) => (
                  <button
                    key={m.user_id}
                    type="button"
                    onClick={() => setToMozoId(m.user_id)}
                    className={`flex w-full items-center gap-3 border-b border-zinc-100 px-4 py-3 text-left transition last:border-b-0 active:bg-zinc-50 ${
                      m.user_id === effectiveToMozoId ? "bg-sky-50" : ""
                    }`}
                  >
                    <span
                      className={`flex h-10 w-10 items-center justify-center rounded-full text-xs font-bold text-white ${
                        m.user_id === effectiveToMozoId
                          ? "bg-sky-600"
                          : "bg-zinc-700"
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
                      <p className="text-xs text-zinc-500 capitalize">
                        {m.role}
                      </p>
                    </div>
                    {m.user_id === effectiveToMozoId && (
                      <Check className="h-5 w-5 text-sky-600" />
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div>
            <label className="text-[11px] font-bold tracking-wider text-zinc-500 uppercase">
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
          disabled={submitting || !effectiveToMozoId}
          onClick={onSubmit}
          className="mt-5 flex h-14 w-full items-center justify-center rounded-2xl bg-sky-600 text-base font-bold text-white shadow-sm transition active:scale-[0.98] disabled:opacity-50"
        >
          {submitting ? "Transferiendo…" : "Transferir mozo"}
        </button>
      </div>
    </div>
  );
}
