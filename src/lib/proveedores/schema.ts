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

export type ExpenseRubro = (typeof EXPENSE_RUBROS)[number];

/**
 * Cómo se llama cada rubro en pantalla. Vivía adentro de `getGastoPorConcepto`
 * como una constante local; el ABM de la spec 162 necesita las mismas
 * etiquetas, y dos copias del mismo diccionario se desincronizan solas.
 */
export const RUBRO_LABELS: Record<ExpenseRubro, string> = {
  mercaderias: "Mercaderías",
  servicios: "Servicios",
  mantenimiento: "Mantenimiento",
  personal: "Gastos en personal",
  impuestos: "Impuestos y tasas",
  vajilla: "Vajilla y mantelería",
  societarios: "Movimientos societarios",
  otros: "Otros gastos",
};

/**
 * Lo que se puede corregir de un comprobante ya cargado — spec 163.
 *
 * **La guarda está partida en dos**, y esa es la decisión: los campos de PLATA
 * (total, fecha, tipo) sólo se tocan mientras no haya pagos vivos imputados;
 * los de CLASIFICACIÓN (concepto, vencimiento, número, notas) siempre.
 *
 * El caso que duele es justamente el segundo: el concepto de gasto es columna
 * nuestra, alimenta el informe de la 158, y es lo típico que se descubre mal
 * clasificado a fin de mes con la compra ya paga. Sin esto, corregir un rótulo
 * obliga a anular el pago —y `anularPagoProveedor` marca la sangría que el
 * arqueo ya contó—, así que nadie lo hace y el informe queda sucio para
 * siempre.
 */
export const SupplierInvoiceEditInput = z.object({
  id: z.string().uuid(),
  // Clasificación: siempre editable.
  expense_concept_id: z.string().uuid().nullable().optional(),
  invoice_number: z.string().max(50).nullable().optional(),
  notes: z.string().max(500).nullable().optional(),
  due_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Vencimiento inválido.")
    .nullable()
    .optional(),
  // Plata: sólo sin pagos vivos. Lo verifica el server, no este schema.
  total_cents: z.number().int().optional(),
  invoice_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida.")
    .optional(),
  document_type: z.enum(DOCUMENT_TYPES).optional(),
});
export type SupplierInvoiceEditInput = z.infer<typeof SupplierInvoiceEditInput>;

/**
 * Un renglón del comprobante — spec 165.
 *
 * `units` son ENVASES (2 bolsas), no unidades base: el server multiplica por el
 * `net_quantity` de la presentación, que es lo que `ingredient_presentations`
 * ya sabe convertir. `unit_cost_cents` es lo que costó UN envase, y es el precio
 * que se propaga al insumo.
 */
export const SupplierInvoiceItemInput = z.object({
  ingredient_id: z.string().uuid("Insumo inválido."),
  presentation_id: z.string().uuid().nullable().optional(),
  units: z.number().positive("La cantidad debe ser mayor a 0."),
  unit_cost_cents: z.number().int().min(0),
});
export type SupplierInvoiceItemInput = z.infer<typeof SupplierInvoiceItemInput>;

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
    /**
     * spec 165 · el detalle por insumo. **Opcional a propósito**: el 92% de los
     * comprobantes del Golf se cargan sólo con concepto de gasto, y la ayuda de
     * MaxiRest bendice ese camino. Sin renglones el comprobante sigue siendo
     * válido — lo que no hace es mover stock ni actualizar costos.
     *
     * Y NO se valida que Σ renglones = total: en 2026 sólo 585 de 1.502
     * comprobantes del Golf cuadran exacto.
     */
    items: z.array(SupplierInvoiceItemInput).max(100).default([]),
  })
  // El signo lo manda el tipo (D4): la nota de crédito resta, todo lo demás
  // suma. Es el mismo check que el de la base — acá para dar el mensaje bueno.
  .refine(
    (v) => (v.document_type === "nota_credito" ? v.total_cents <= 0 : v.total_cents >= 0),
    {
      message: "La nota de crédito va en negativo; el resto de los comprobantes, en positivo.",
      path: ["total_cents"],
    },
  )
  /**
   * Cero no es un importe — spec 172.
   *
   * El `defaultValue` del formulario es `0` y el input pinta `""` cuando el valor
   * es falsy: la pantalla dice «vacío» y el modelo dice «cero». Guardar sin tocar
   * el campo daba un comprobante de $0 que figuraba cargado en la cuenta
   * corriente, sin un solo error.
   *
   * Importa el doble con el lector de facturas: un importe que el modelo no pudo
   * leer tiene que llegar VACÍO y frenar acá, nunca convertirse en un cero que
   * pasa de largo. Un dato faltante se completa; uno falso no se nota.
   *
   * El CHECK de la base sigue admitiendo 0 (cambiarlo es una migración sobre
   * datos vivos); esta es la puerta por la que entra la app.
   */
  .refine((v) => v.total_cents !== 0, {
    message: "Poné el importe del comprobante.",
    path: ["total_cents"],
  });
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

export const SupplierPaymentInput = z.object({
  supplier_id: z.string().uuid("Proveedor inválido."),
  amount_cents: z.number().int().positive("El monto debe ser mayor a 0."),
  method: z.enum(SUPPLIER_PAYMENT_METHODS),
  paid_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida.").optional(),
  notes: z.string().max(500).nullable().optional(),
  /** Comprobantes a cancelar. Vacío = pago a cuenta. */
  invoice_ids: z.array(z.string().uuid()).max(200).default([]),
});
// spec 160 · `caja_id` ya NO viaja en el input: el efectivo sale siempre de la
// caja administrativa y el server la resuelve. Dejarlo acá sería volver a
// ofrecerle al cliente la decisión que la spec vino a sacarle — el CHECK
// `supplier_payments_caja_coherente` de la base sigue exigiendo que la fila la
// tenga, y la tiene: la que puso el server.
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
