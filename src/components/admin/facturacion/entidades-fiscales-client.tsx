"use client";

import { useCallback } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Building2, ChevronLeft, ChevronRight, Search } from "lucide-react";

import { Input } from "@/components/ui/input";
import { CONDICION_IVA_LABEL } from "@/lib/afip/condicion-iva";
import { formatCuit } from "@/lib/afip/cuit";
import type { FiscalEntity } from "@/lib/afip/fiscal-entities";

// ============================================================================
// Listado de entidades fiscales (spec 150).
//
// Búsqueda por razón social **y** por CUIT con el mismo campo: quien busca
// tipea lo que tiene a mano, y el CUIT lo tiene con guiones aunque en la base
// viva sin. La normalización pasa antes de la query.
// ============================================================================

export function EntidadesFiscalesClient({
  slug,
  entities,
  count,
  page,
  totalPages,
  q,
}: {
  slug: string;
  entities: FiscalEntity[];
  count: number;
  page: number;
  totalPages: number;
  q: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const updateParam = useCallback(
    (key: string, value: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (!value) params.delete(key);
      else params.set(key, value);
      if (key !== "page") params.delete("page");
      router.push(`${pathname}?${params.toString()}`);
    },
    [router, pathname, searchParams],
  );

  return (
    <div className="grid gap-4">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-zinc-400" />
        <Input
          placeholder="Buscar por razón social o CUIT…"
          defaultValue={q}
          className="pl-8"
          onChange={(e) => {
            const value = e.target.value;
            if (value.length === 0 || value.length >= 2) updateParam("q", value);
          }}
        />
      </div>

      {entities.length === 0 ? (
        <div className="rounded-2xl bg-white p-10 text-center ring-1 ring-zinc-200/70">
          <Building2 className="mx-auto size-8 text-zinc-300" />
          <p className="mt-3 text-sm font-semibold text-zinc-900">
            {q ? "Sin resultados" : "Todavía no hay receptores cargados"}
          </p>
          <p className="mt-1 text-sm text-zinc-500">
            {q
              ? "Probá con otra parte de la razón social o del CUIT."
              : "Se cargan solas: la primera Factura A a un CUIT nuevo lo deja guardado acá."}
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-zinc-100 overflow-hidden rounded-2xl bg-white ring-1 ring-zinc-200/70">
          {entities.map((entidad) => (
            <li key={entidad.id}>
              <Link
                href={`/${slug}/admin/facturacion/entidades/${entidad.id}`}
                className="flex items-center gap-3 px-4 py-3 transition hover:bg-zinc-50"
              >
                <Building2 className="size-4 shrink-0 text-zinc-400" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-zinc-900">
                    {entidad.razon_social}
                  </span>
                  <span className="block truncate text-xs text-zinc-500">
                    {formatCuit(entidad.cuit)} ·{" "}
                    {CONDICION_IVA_LABEL[entidad.condicion_iva]}
                  </span>
                </span>
                <ChevronRight className="size-4 shrink-0 text-zinc-300" />
              </Link>
            </li>
          ))}
        </ul>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-xs text-zinc-500">
          <span>
            {count} {count === 1 ? "receptor" : "receptores"}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => updateParam("page", String(page - 1))}
              className="inline-flex items-center gap-1 rounded-full px-2 py-1 font-semibold text-zinc-700 ring-1 ring-zinc-200 transition hover:bg-zinc-50 disabled:opacity-40"
            >
              <ChevronLeft className="size-3" /> Anterior
            </button>
            <span>
              {page} / {totalPages}
            </span>
            <button
              type="button"
              disabled={page >= totalPages}
              onClick={() => updateParam("page", String(page + 1))}
              className="inline-flex items-center gap-1 rounded-full px-2 py-1 font-semibold text-zinc-700 ring-1 ring-zinc-200 transition hover:bg-zinc-50 disabled:opacity-40"
            >
              Siguiente <ChevronRight className="size-3" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
