"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RotateCcw, UserMinus } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { RolePicker } from "@/components/admin/users/role-picker";
import {
  disableBusinessMember,
  enableBusinessMember,
} from "@/lib/admin/members-actions";
import type { BusinessMember } from "@/lib/admin/members-query";
import { cn } from "@/lib/utils";

export function UserRow({
  slug,
  member,
  canManage,
  isCurrentUser,
  lastClockIn,
}: {
  slug: string;
  member: BusinessMember;
  canManage: boolean;
  isCurrentUser: boolean;
  lastClockIn?: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);

  const isDisabled = Boolean(member.disabled_at);

  const handleDisable = () => {
    startTransition(async () => {
      const r = await disableBusinessMember(slug, member.user_id);
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success("Empleado deshabilitado.");
      setOpen(false);
      router.refresh();
    });
  };

  const handleEnable = () => {
    startTransition(async () => {
      const r = await enableBusinessMember(slug, member.user_id);
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success("Empleado reactivado.");
      router.refresh();
    });
  };

  const displayName = member.full_name?.trim() || member.email;
  const showEmailSubtitle = Boolean(member.full_name?.trim());

  return (
    <li
      className={cn(
        "flex items-center justify-between gap-3 rounded-2xl bg-white p-4 ring-1 ring-zinc-200/70 transition hover:ring-zinc-300",
        isDisabled && "bg-zinc-50 opacity-70 hover:ring-zinc-200/70",
      )}
    >
      <div className="flex min-w-0 items-center gap-3">
        <span
          className={cn(
            "flex size-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold ring-1 ring-black/10",
            isDisabled && "grayscale",
          )}
          style={{
            background: "var(--brand)",
            color: "var(--brand-foreground)",
          }}
        >
          {displayName[0]?.toUpperCase() ?? "?"}
        </span>
        <div className="min-w-0">
          <p
            className={cn(
              "truncate text-sm font-semibold text-zinc-900",
              isDisabled && "text-zinc-500",
            )}
          >
            {displayName}
            {isCurrentUser && (
              <span className="ml-2 text-xs font-normal text-zinc-500">
                (vos)
              </span>
            )}
            {isDisabled && (
              <span className="ml-2 inline-flex items-center rounded-full bg-zinc-200 px-1.5 py-0.5 text-[0.6rem] font-semibold uppercase tracking-wider text-zinc-700">
                Deshabilitado
              </span>
            )}
          </p>
          {showEmailSubtitle && (
            <p className="truncate text-xs text-zinc-500">{member.email}</p>
          )}
          {member.phone && (
            <p className="truncate text-xs text-zinc-500">{member.phone}</p>
          )}
          {member.pin && (
            <p className="text-xs text-zinc-500">
              PIN: <span className="font-mono">{member.pin}</span>
            </p>
          )}
          <p className="text-xs text-zinc-500">
            Desde{" "}
            {new Intl.DateTimeFormat("es-AR", {
              day: "2-digit",
              month: "short",
              year: "numeric",
            }).format(new Date(member.created_at))}
            {lastClockIn && (
              <>
                {" · "}Última fichada:{" "}
                {(() => {
                  const now = new Date();
                  const d = new Date(lastClockIn);
                  const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000);
                  if (diffDays === 0) return `Hoy ${d.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })}`;
                  if (diffDays === 1) return "Ayer";
                  if (diffDays < 7) return `Hace ${diffDays}d`;
                  return d.toLocaleDateString("es-AR", { day: "2-digit", month: "short" });
                })()}
              </>
            )}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <RolePicker
          slug={slug}
          userId={member.user_id}
          role={member.role}
          displayName={displayName}
          editable={canManage && !isCurrentUser && !isDisabled}
        />
        {canManage && !isCurrentUser && !isDisabled && (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger
              render={
                <Button
                  size="sm"
                  variant="outline"
                  aria-label="Deshabilitar empleado"
                >
                  <UserMinus className="size-3.5" />
                  Deshabilitar
                </Button>
              }
            />
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Deshabilitar a {displayName}</DialogTitle>
              </DialogHeader>
              <p className="text-muted-foreground text-sm">
                Pierde acceso al panel del negocio. La cuenta y su historial
                (pedidos, comandas) quedan intactos. Podés reactivarla cuando
                quieras.
              </p>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setOpen(false)}
                  disabled={pending}
                >
                  Cancelar
                </Button>
                <Button
                  variant="destructive"
                  onClick={handleDisable}
                  disabled={pending}
                >
                  Deshabilitar
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
        {canManage && isDisabled && (
          <Button
            size="sm"
            variant="outline"
            onClick={handleEnable}
            disabled={pending}
            aria-label="Reactivar empleado"
          >
            <RotateCcw className="size-3.5" />
            Reactivar
          </Button>
        )}
      </div>
    </li>
  );
}
