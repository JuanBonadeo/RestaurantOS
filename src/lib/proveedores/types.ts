export type Supplier = {
  id: string;
  businessId: string;
  name: string;
  cuit: string | null;
  contact: string | null;
  phone: string | null;
  email: string | null;
  notes: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  /** spec 158 · lo que precarga la compra. */
  defaultExpenseConceptId: string | null;
  paymentTermsDays: number;
};

export type SupplierWithStats = Supplier & {
  totalSpentCents: number;
  invoiceCount: number;
  lastInvoiceDate: string | null;
};

export type SupplierInvoice = {
  id: string;
  businessId: string;
  supplierId: string;
  invoiceNumber: string | null;
  invoiceDate: string;
  totalCents: number;
  photoUrl: string | null;
  photoSignedUrl: string | null;
  notes: string | null;
  createdBy: string | null;
  createdAt: string;
  /** spec 158 */
  documentType: string;
  expenseConceptId: string | null;
  dueDate: string | null;
  cancelledAt: string | null;
  cancelledReason: string | null;
};

/**
 * Un renglón de un comprobante ya cargado — spec 172.
 *
 * La 165 creó `supplier_invoice_items` y la dejó de sólo escritura: la RPC
 * insertaba, la reversión borraba, y no había una sola query que los leyera. Con
 * cinco renglones tipeados a mano se podía vivir sin eso, porque quien los tipeó
 * se acordaba. El lector de facturas los carga de a diez y borra esa propiedad:
 * el único rastro de qué movió el stock y pisó el costo sería una pantalla que no
 * existía.
 *
 * Y como los renglones **no se editan** (165, «qué no entra»: se anula y se
 * rehace), poder mirarlos es lo único que queda entre el encargado y una
 * auditoría a ciegas.
 */
export type SupplierInvoiceItem = {
  id: string;
  invoiceId: string;
  ingredientId: string;
  ingredientName: string;
  /** La unidad base del insumo: kg, lt, un, g, ml. */
  ingredientUnit: string;
  /** El envase con el que se cargó, congelado al momento de la compra. */
  presentationName: string | null;
  /** Envases, no unidades base (165·D5). */
  units: number;
  /** `units × net_quantity` — lo que efectivamente entró al stock. */
  quantityBase: number;
  /** Lo que costó UN envase. Es lo que pisó el costo del insumo. */
  unitCostCents: number;
};

export type SupplierIngredientLink = {
  supplierId: string;
  ingredientId: string;
  ingredientName: string;
  ingredientUnit: string;
  createdAt: string;
};

export type SupplierStats = {
  supplierId: string;
  supplierName: string;
  totalSpentCents: number;
  invoiceCount: number;
  lastInvoiceDate: string | null;
};

export type SupplierOutflowItem = {
  supplierId: string;
  supplierName: string;
  totalCostCents: number;
  consumptionCount: number;
};
