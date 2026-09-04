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
