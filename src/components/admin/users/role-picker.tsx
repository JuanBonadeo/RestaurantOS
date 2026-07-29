"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
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
import { RoleBadge } from "@/components/shared/role-badge";
import { updateMemberRole } from "@/lib/admin/members-actions";
import {
  BUSINESS_ROLES,
  ROLE_META,
  type BusinessRoleInput,
} from "@/lib/admin/roles";
import { cn } from "@/lib/utils";

/**
 * Badge de rol clickeable: abre un diálogo para reasignar el rol del miembro.
 * Cuando el usuario no puede gestionar (o es él mismo), cae al badge estático.
 */
export function RolePicker({
  slug,
  userId,
  role,
  displayName,
  editable,
}: {
  slug: string;
  userId: string;
  role: BusinessRoleInput;
  displayName: string;
  editable: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<BusinessRoleInput>(role);
  const [pending, startTransition] = useTransition();

  if (!editable) return <RoleBadge role={role} size="sm" />;

  const handleOpenChange = (next: boolean) => {
    if (next) setSelected(role);
    setOpen(next);
  };

  const handleSave = () => {
    if (selected === role) {
      setOpen(false);
      return;
    }
    startTransition(async () => {
      const r = await updateMemberRole({
        business_slug: slug,
        user_id: userId,
        role: selected,
      });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success(`${displayName} ahora es ${ROLE_META[selected].label}.`);
      if (r.data.needsCredentials) {
        toast.warning(
          `${displayName} todavía no tiene email ni contraseña propios: no va a poder entrar al sistema hasta que se los cargues.`,
          { duration: 10000 },
        );
      }
      setOpen(false);
      router.refresh();
    });
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger
        render={
          <button
            type="button"
            aria-label={`Cambiar rol de ${displayName}`}
            className="rounded-full transition hover:opacity-80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900"
          >
            <RoleBadge role={role} size="sm" />
          </button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rol de {displayName}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-2">
          {BUSINESS_ROLES.map((r) => {
            const isSelected = selected === r;
            return (
              <button
                key={r}
                type="button"
                onClick={() => setSelected(r)}
                aria-pressed={isSelected}
                className={cn(
                  "flex items-start gap-3 rounded-xl p-3 text-left ring-1 transition",
                  isSelected
                    ? "bg-zinc-50 ring-zinc-900"
                    : "bg-white ring-zinc-200/70 hover:bg-zinc-50",
                )}
              >
                <span className="mt-0.5">
                  <RoleBadge role={r} size="sm" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm text-zinc-600">
                    {ROLE_META[r].description}
                  </span>
                </span>
                {isSelected && (
                  <Check className="mt-0.5 size-4 shrink-0 text-zinc-900" />
                )}
              </button>
            );
          })}
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => setOpen(false)}
            disabled={pending}
          >
            Cancelar
          </Button>
          <Button
            onClick={handleSave}
            disabled={pending || selected === role}
          >
            Guardar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
