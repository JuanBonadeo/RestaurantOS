"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import type { z } from "zod";

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
import { ImageUploader } from "@/components/admin/catalog/image-uploader";
import { LADO_LARGO_DEFAULT } from "@/lib/images/achicar";
import { createSupplierInvoice } from "@/lib/proveedores/actions";
import type { SupplierInvoiceItemInput } from "@/lib/proveedores/schema";
import { RenglonesEditor, type InsumoOption } from "./renglones-editor";
import { calcularVencimiento, etiquetaTipo } from "@/lib/proveedores/cuenta-corriente";
import { DOCUMENT_TYPES, SupplierInvoiceInput } from "@/lib/proveedores/schema";
import { hoyAR, primerDiaDelMesAR } from "@/lib/proveedores/fechas-ar";

type FormValues = z.input<typeof SupplierInvoiceInput>;

export type ConceptOption = { id: string; name: string; rubro: string };

type Props = {
  slug: string;
  supplierId: string;
  businessId: string;
  /** Conceptos de gasto activos del negocio. */
  concepts: ConceptOption[];
  /** El concepto y los días de crédito del proveedor: precargan la compra. */
  defaultConceptId?: string | null;
  paymentTermsDays?: number;
  /** spec 165 · los insumos del negocio, para detallar la compra por renglón. */
  insumos?: InsumoOption[];
  onSuccess?: () => void;
  trigger: React.ReactElement;
};

export function InvoiceDialog({
  slug,
  supplierId,
  businessId,
  concepts,
  defaultConceptId,
  paymentTermsDays = 0,
  insumos = [],
  onSuccess,
  trigger,
}: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [photoPath, setPhotoPath] = useState<string | null>(null);
  const [items, setItems] = useState<SupplierInvoiceItemInput[]>([]);

  const today = hoyAR();

  const form = useForm<FormValues>({
    resolver: zodResolver(SupplierInvoiceInput),
    defaultValues: {
      supplier_id: supplierId,
      invoice_number: "",
      invoice_date: today,
      total_cents: 0,
      photo_url: null,
      notes: "",
      // El 36% de las compras del Golf no tienen factura: el caso frecuente es
      // el default, no el que hay que ir a elegir.
      document_type: "interno",
      expense_concept_id: defaultConceptId ?? null,
      due_date: calcularVencimiento(today, paymentTermsDays),
    },
  });

  const tipo = form.watch("document_type");
  const fecha = form.watch("invoice_date");
  const conNumero = tipo !== "interno";

  // El vencimiento sigue a la fecha mientras nadie lo toque a mano: cambiar la
  // fecha de la factura y quedarse con el vencimiento viejo es un impago que
  // aparece a destiempo en la lista.
  const [vencTocado, setVencTocado] = useState(false);
  useEffect(() => {
    if (vencTocado || !fecha) return;
    form.setValue("due_date", calcularVencimiento(fecha, paymentTermsDays));
  }, [fecha, paymentTermsDays, vencTocado, form]);

  const onSubmit = async (values: FormValues) => {
    setSubmitting(true);
    try {
      const result = await createSupplierInvoice(slug, {
        ...values,
        photo_url: photoPath,
        items,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Compra cargada.");
      setOpen(false);
      setPhotoPath(null);
      setItems([]);
      setVencTocado(false);
      form.reset();
      router.refresh();
      onSuccess?.();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={trigger} />
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Cargar compra</DialogTitle>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            {/* El importe primero: es el dato que siempre está. */}
            <FormField
              control={form.control}
              name="total_cents"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Importe ($) *</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      step={1}
                      autoFocus
                      placeholder="45000"
                      value={field.value ? Number(field.value) / 100 : ""}
                      onChange={(e) => {
                        const pesos = parseFloat(e.target.value) || 0;
                        field.onChange(Math.round(pesos * 100));
                      }}
                    />
                  </FormControl>
                  <FormMessage />
                  {tipo === "nota_credito" && (
                    <p className="text-xs text-amber-700">
                      La nota de crédito va en negativo: resta del saldo.
                    </p>
                  )}
                </FormItem>
              )}
            />

            <div className="grid grid-cols-2 gap-3">
              <FormField
                control={form.control}
                name="expense_concept_id"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Concepto</FormLabel>
                    <FormControl>
                      <select
                        className="h-9 w-full rounded-md border border-zinc-200 bg-white px-2 text-sm"
                        value={field.value ?? ""}
                        onChange={(e) => field.onChange(e.target.value || null)}
                      >
                        <option value="">Sin concepto</option>
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
                name="invoice_date"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Fecha *</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <FormField
                control={form.control}
                name="document_type"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Comprobante</FormLabel>
                    <FormControl>
                      <select
                        className="h-9 w-full rounded-md border border-zinc-200 bg-white px-2 text-sm"
                        value={field.value ?? "interno"}
                        onChange={(e) => field.onChange(e.target.value)}
                      >
                        {DOCUMENT_TYPES.map((t) => (
                          <option key={t} value={t}>
                            {etiquetaTipo(t)}
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
                name="due_date"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Vence</FormLabel>
                    <FormControl>
                      <Input
                        type="date"
                        {...field}
                        value={field.value ?? ""}
                        onChange={(e) => {
                          setVencTocado(true);
                          field.onChange(e.target.value || null);
                        }}
                      />
                    </FormControl>
                    <FormMessage />
                    {!vencTocado && paymentTermsDays > 0 && (
                      <p className="text-xs text-zinc-500">
                        A {paymentTermsDays} días, como el proveedor.
                      </p>
                    )}
                  </FormItem>
                )}
              />
            </div>

            {/* El número sólo cuando hay comprobante que numerar. */}
            {conNumero && (
              <FormField
                control={form.control}
                name="invoice_number"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Número</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="0001-00012345"
                        {...field}
                        value={field.value ?? ""}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            {insumos.length > 0 && (
              <RenglonesEditor
                insumos={insumos}
                value={items}
                onChange={setItems}
                totalComprobanteCents={form.watch("total_cents") ?? 0}
              />
            )}

            <div className="space-y-2">
              <label className="text-sm font-medium">Foto del comprobante</label>
              <ImageUploader
                businessId={businessId}
                value={photoPath}
                onChange={(url) => setPhotoPath(url)}
                bucket="supplier-invoices"
                returnPath
                // spec 172 · la foto de una factura se va a leer con un modelo
                // de visión: tiene que entrar en los 5 MB del bucket, ser JPEG
                // y no HEIC, y quedar por debajo de ~3,6 MB para que el base64
                // no pase el techo de la API. 2200 px es más de lo que el
                // modelo usa (reescala a 1568) y alcanza para leerla a ojo.
                maxEdgePx={LADO_LARGO_DEFAULT}
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
                      placeholder="Observaciones…"
                      rows={2}
                      {...field}
                      value={field.value ?? ""}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button type="submit" disabled={submitting}>
                {submitting ? "Guardando…" : "Cargar compra"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
