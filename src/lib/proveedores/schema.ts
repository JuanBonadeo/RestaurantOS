import { z } from "zod";

export const SupplierInput = z.object({
  name: z.string().min(1, "Requerido.").max(100),
  cuit: z.string().max(13).nullable().optional(),
  contact: z.string().max(100).nullable().optional(),
  phone: z.string().max(30).nullable().optional(),
  email: z
    .string()
    .email("Email inválido.")
    .max(100)
    .nullable()
    .optional()
    .or(z.literal("")),
  notes: z.string().max(500).nullable().optional(),
  is_active: z.boolean(),
  // spec 158 · lo que precarga la compra: el concepto por defecto y los días de
  // crédito (`cod_cga` y `dias_venc` de MaxiRest).
  default_expense_concept_id: z.string().uuid().nullable().optional(),
  payment_terms_days: z.number().int().min(0).max(365).optional(),
});
export type SupplierInput = z.infer<typeof SupplierInput>;

// spec 158 · `interno` es el `Z` de MaxiRest: la compra diaria sin factura, que
// es el 36% de los comprobantes del Golf. Por eso es el default.
export const DOCUMENT_TYPES = [
  "interno",
  "factura_a",
  "factura_b",
  "factura_c",
  "ticket",
  "remito",
  "nota_credito",
  "nota_debito",
] as const;

export const EXPENSE_RUBROS = [
  "mercaderias",
  "servicios",
  "mantenimiento",
  "personal",
  "impuestos",
  "vajilla",
  "societarios",
  "otros",
] as const;

export const SupplierInvoiceInput = z
  .object({
    supplier_id: z.string().uuid("Proveedor inválido."),
    invoice_number: z.string().max(50).nullable().optional(),
    invoice_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida."),
    total_cents: z.number().int(),
    photo_url: z.string().nullable().optional(),
    notes: z.string().max(500).nullable().optional(),
    document_type: z.enum(DOCUMENT_TYPES).default("interno"),
    expense_concept_id: z.string().uuid().nullable().optional(),
    /** Si no viene, lo calcula el server con los días de crédito del proveedor. */
    due_date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Vencimiento inválido.")
      .nullable()
      .optional(),
  })
  // El signo lo manda el tipo (D4): la nota de crédito resta, todo lo demás
  // suma. Es el mismo check que el de la base — acá para dar el mensaje bueno.
  .refine(
    (v) => (v.document_type === "nota_credito" ? v.total_cents <= 0 : v.total_cents >= 0),
    {
      message: "La nota de crédito va en negativo; el resto de los comprobantes, en positivo.",
      path: ["total_cents"],
    },
  );
export type SupplierInvoiceInput = z.infer<typeof SupplierInvoiceInput>;

export const ExpenseConceptInput = z.object({
  name: z.string().min(1, "Requerido.").max(60),
  rubro: z.enum(EXPENSE_RUBROS),
  is_active: z.boolean().default(true),
});
export type ExpenseConceptInput = z.infer<typeof ExpenseConceptInput>;

export const SUPPLIER_PAYMENT_METHODS = [
  "cash",
  "transfer",
  "card_manual",
  "other",
] as const;

export const SupplierPaymentInput = z
  .object({
    supplier_id: z.string().uuid("Proveedor inválido."),
    amount_cents: z.number().int().positive("El monto debe ser mayor a 0."),
    method: z.enum(SUPPLIER_PAYMENT_METHODS),
    /** Obligatoria si el medio es efectivo: de ahí sale la plata. */
    caja_id: z.string().uuid().nullable().optional(),
    paid_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida.").optional(),
    notes: z.string().max(500).nullable().optional(),
    /** Comprobantes a cancelar. Vacío = pago a cuenta. */
    invoice_ids: z.array(z.string().uuid()).max(200).default([]),
  })
  // El mismo invariante que el CHECK de la base: un pago en efectivo sin caja no
  // se puede arquear, y uno que no es en efectivo no tiene por qué tener caja.
  .refine((v) => (v.method === "cash") === Boolean(v.caja_id), {
    message: "El pago en efectivo necesita una caja; los otros medios, no.",
    path: ["caja_id"],
  });
export type SupplierPaymentInput = z.infer<typeof SupplierPaymentInput>;

export const AnularInput = z.object({
  id: z.string().uuid(),
  reason: z.string().min(3, "Escribí un motivo.").max(200),
});
export type AnularInput = z.infer<typeof AnularInput>;

export const ImportSupplierRow = z.object({
  name: z.string().min(1, "Nombre requerido.").max(100),
  cuit: z.string().max(13).optional(),
  contact: z.string().max(100).optional(),
  phone: z.string().max(30).optional(),
  email: z.string().email("Email inválido.").max(100).optional().or(z.literal("")),
});
export type ImportSupplierRow = z.infer<typeof ImportSupplierRow>;

export const ImportSupplierBatch = z
  .array(ImportSupplierRow)
  .min(1, "Al menos una fila.")
  .max(500, "Máximo 500 filas por lote.");
export type ImportSupplierBatch = z.infer<typeof ImportSupplierBatch>;
