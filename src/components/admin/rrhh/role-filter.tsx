"use client";

import { cn } from "@/lib/utils";

/**
 * Fila de filtro por rol: "Todos" + un chip por rol. Cada chip es UNA sola
 * píldora (puntito de color + label). Inactivo = neutro; activo = se rellena
 * con el color suave del rol. Colores alineados con RoleBadge.
 */
const ROLES = [
  {
    key: "admin",
    label: "Admin",
    dot: "bg-violet-500",
    active: "bg-violet-50 text-violet-700 ring-violet-200",
  },
  {
    key: "encargado",
    label: "Encargado",
    dot: "bg-blue-500",
    active: "bg-blue-50 text-blue-700 ring-blue-200",
  },
  {
    key: "mozo",
    label: "Mozo",
    dot: "bg-emerald-500",
    active: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  },
  {
    key: "terminal",
    label: "Terminal",
    dot: "bg-teal-500",
    active: "bg-teal-50 text-teal-700 ring-teal-200",
  },
  {
    key: "personal",
    label: "Personal",
    dot: "bg-amber-500",
    active: "bg-amber-50 text-amber-700 ring-amber-200",
  },
] as const;

export function RoleFilter({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (role: string | null) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      <button
        type="button"
        onClick={() => onChange(null)}
        aria-pressed={value === null}
        className={cn(
          "rounded-full px-3 py-1.5 text-xs font-semibold transition",
          value === null
            ? "bg-zinc-900 text-white"
            : "bg-white text-zinc-600 ring-1 ring-zinc-200/70 hover:bg-zinc-50",
        )}
      >
        Todos
      </button>
      {ROLES.map((r) => {
        const isActive = value === r.key;
        return (
          <button
            key={r.key}
            type="button"
            onClick={() => onChange(isActive ? null : r.key)}
            aria-pressed={isActive}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold ring-1 transition",
              isActive
                ? r.active
                : "bg-white text-zinc-600 ring-zinc-200/70 hover:bg-zinc-50",
            )}
          >
            <span className={cn("size-1.5 rounded-full", r.dot)} />
            {r.label}
          </button>
        );
      })}
    </div>
  );
}
