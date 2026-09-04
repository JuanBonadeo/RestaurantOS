"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
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
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  createSupplier,
  updateSupplier,
  deactivateSupplier,
} from "@/lib/proveedores/actions";
import { SupplierInput } from "@/lib/proveedores/schema";
import type { Supplier } from "@/lib/proveedores/types";

type Props = {
  slug: string;
  supplier?: Supplier;
  /** Conceptos de gasto del negocio, para elegir el que precarga sus compras. */
  concepts?: { id: string; name: string; rubro: string }[];
  trigger: React.ReactElement;
};

export function SupplierDialog({ slug, supplier, concepts = [], trigger }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const form = useForm<SupplierInput>({
    resolver: zodResolver(SupplierInput),
    defaultValues: supplier
      ? {
          name: supplier.name,
          cuit: supplier.cuit ?? "",
          contact: supplier.contact ?? "",
          phone: supplier.phone ?? "",
          email: supplier.email ?? "",
          notes: supplier.notes ?? "",
          is_active: supplier.isActive,
          default_expense_concept_id: supplier.defaultExpenseConceptId ?? null,
          payment_terms_days: supplier.paymentTermsDays ?? 0,
        }
      : {
          name: "",
          cuit: "",
          contact: "",
          phone: "",
          email: "",
          notes: "",
          is_active: true,
          default_expense_concept_id: null,
          payment_terms_days: 0,
        },
  });

  const onSubmit = async (values: SupplierInput) => {
    setSubmitting(true);
    try {
      const result = supplier
        ? await updateSupplier(slug, supplier.id, values)
        : await createSupplier(slug, values);

      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(supplier ? "Proveedor actualizado." : "Proveedor creado.");
      setOpen(false);
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeactivate = async () => {
    if (!supplier) return;
    setSubmitting(true);
    try {
      const result = await deactivateSupplier(slug, supplier.id);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Proveedor desactivado.");
      setOpen(false);
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={trigger} />
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {supplier ? "Editar proveedor" : "Nuevo proveedor"}
          </DialogTitle>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Nombre *</FormLabel>
                  <FormControl>
                    <Input placeholder="Ej: Distribuidora del Sur" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-2 gap-3">
              <FormField
                control={form.control}
                name="cuit"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>CUIT</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="30-12345678-8"
                        {...field}
                        value={field.value ?? ""}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="phone"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Teléfono</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="11-5555-0000"
                        {...field}
                        value={field.value ?? ""}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <FormField
                control={form.control}
                name="contact"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Contacto</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="Nombre de contacto"
                        {...field}
                        value={field.value ?? ""}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email</FormLabel>
                    <FormControl>
                      <Input
                        type="email"
                        placeholder="proveedor@mail.com"
                        {...field}
                        value={field.value ?? ""}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {/* spec 158 · lo que precarga cada compra de este proveedor. */}
            <div className="grid grid-cols-2 gap-3">
              <FormField
                control={form.control}
                name="default_expense_concept_id"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Concepto habitual</FormLabel>
                    <FormControl>
                      <select
                        className="h-9 w-full rounded-md border border-zinc-200 bg-white px-2 text-sm"
                        value={field.value ?? ""}
                        onChange={(e) => field.onChange(e.target.value || null)}
                      >
                        <option value="">Ninguno</option>
                        {concepts.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="payment_terms_days"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Días de crédito</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min={0}
                        max={365}
                        value={field.value ?? 0}
                        onChange={(e) => field.onChange(parseInt(e.target.value, 10) || 0)}
                      />
                    </FormControl>
                    <FormMessage />
                    <p className="text-xs text-zinc-500">
                      0 = contado. Calcula el vencimiento de cada compra.
                    </p>
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Notas</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Observaciones, dirección, condiciones…"
                      rows={3}
                      {...field}
                      value={field.value ?? ""}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {supplier && (
              <FormField
                control={form.control}
                name="is_active"
                render={({ field }) => (
                  <FormItem className="flex items-center justify-between rounded-lg border px-4 py-3">
                    <FormLabel className="text-sm font-medium">Activo</FormLabel>
                    <FormControl>
                      <button
                        type="button"
                        onClick={() => field.onChange(!field.value)}
                        className={cn(
                          "rounded-full px-3 py-1 text-xs font-semibold",
                          field.value
                            ? "bg-green-100 text-green-700"
                            : "bg-zinc-100 text-zinc-500",
                        )}
                      >
                        {field.value ? "Activo" : "Inactivo"}
                      </button>
                    </FormControl>
                  </FormItem>
                )}
              />
            )}

            <DialogFooter className="gap-2">
              {supplier && supplier.isActive && (
                <>
                  {!confirmDelete ? (
                    <Button
                      type="button"
                      variant="destructive"
                      size="sm"
                      onClick={() => setConfirmDelete(true)}
                      disabled={submitting}
                    >
                      Desactivar
                    </Button>
                  ) : (
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setConfirmDelete(false)}
                        disabled={submitting}
                      >
                        Cancelar
                      </Button>
                      <Button
                        type="button"
                        variant="destructive"
                        size="sm"
                        onClick={handleDeactivate}
                        disabled={submitting}
                      >
                        Confirmar
                      </Button>
                    </div>
                  )}
                </>
              )}
              <Button type="submit" disabled={submitting}>
                {submitting ? "Guardando…" : "Guardar"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
