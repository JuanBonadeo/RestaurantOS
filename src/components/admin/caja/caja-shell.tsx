import Link from "next/link";

import { cn } from "@/lib/utils";

export type SubVista = "cajas" | "cierres" | "movimientos";

const SUBVISTAS: { id: SubVista; label: string; path: string }[] = [
  { id: "cajas", label: "Las cajas", path: "" },
  { id: "cierres", label: "Cierres", path: "/cierres" },
  { id: "movimientos", label: "Movimientos", path: "/movimientos" },
];

/**
 * El encabezado de la sección Caja (spec 153 · D1/D2).
 *
 * Las tres sub-vistas estaban sueltas —dos colgando de Operación y una como
 * ítem del menú— y ninguna presentaba a las otras. Acá se ven las tres siempre,
 * que es lo que las vuelve partes de lo mismo.
 *
 * Es `<Link>` y no estado de cliente a propósito: cada sub-vista es una ruta
 * con sus propios datos del server, y así el link se puede pegar en un mensaje.
 */
export function CajaShell({
  slug,
  activa,
  action,
  children,
}: {
  slug: string;
  activa: SubVista;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-5">
      <header className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-5">
          <div className="min-w-0">
            <p className="text-[0.65rem] font-semibold uppercase tracking-[0.18em] text-zinc-500">
              Caja
            </p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight text-zinc-900 sm:text-3xl">
              {SUBVISTAS.find((s) => s.id === activa)?.label ?? "Caja"}
            </h1>
          </div>
          {action ? <div className="flex-shrink-0">{action}</div> : null}
        </div>

        <nav
          aria-label="Secciones de caja"
          className="flex gap-1 self-start overflow-x-auto rounded-2xl bg-white p-1.5 ring-1 ring-zinc-200/70"
        >
          {SUBVISTAS.map((s) => (
            <Link
              key={s.id}
              href={`/${slug}/admin/caja${s.path}`}
              aria-current={s.id === activa ? "page" : undefined}
              className={cn(
                "shrink-0 rounded-xl px-4 py-1.5 text-sm font-semibold transition active:scale-[0.97]",
                s.id === activa
                  ? "bg-zinc-900 text-white shadow-sm"
                  : "text-zinc-700 hover:bg-zinc-100",
              )}
            >
              {s.label}
            </Link>
          ))}
        </nav>
      </header>

      {children}
    </div>
  );
}
