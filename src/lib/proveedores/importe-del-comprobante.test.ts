import { describe, expect, it } from "vitest";

import { SupplierInvoiceInput } from "@/lib/proveedores/schema";

/**
 * El importe del comprobante — spec 172·D2.
 *
 * «Lo que no se leyó llega vacío, nunca en cero.» El agujero que esto cierra
 * estaba abierto desde la 158: el `defaultValue` del formulario es `0` y el input
 * pinta `""` cuando el valor es falsy, así que la pantalla decía «vacío» y el
 * modelo decía «cero». Guardar sin tocar el campo daba un comprobante de $0 que
 * figuraba cargado en la cuenta corriente, sin un solo error.
 *
 * Con el lector de facturas importa el doble: un importe que el modelo no pudo
 * leer tiene que frenar acá y no convertirse en un cero que pasa de largo.
 */
const base = {
  supplier_id: "3f6c1b2e-7d4a-4a1b-9c2e-8f0a1b2c3d4e",
  invoice_date: "2026-09-08",
  document_type: "interno" as const,
};

describe("SupplierInvoiceInput · el importe", () => {
  it("rechaza el comprobante en cero, que es el default del formulario", () => {
    const r = SupplierInvoiceInput.safeParse({ ...base, total_cents: 0 });

    expect(r.success).toBe(false);
    if (r.success) return;
    const issue = r.error.issues.find((i) => i.path[0] === "total_cents");
    expect(issue?.message).toBe("Poné el importe del comprobante.");
  });

  it("rechaza el cero también en una nota de crédito", () => {
    // La NC va en negativo. Un cero no la salva por el lado del signo.
    const r = SupplierInvoiceInput.safeParse({
      ...base,
      document_type: "nota_credito",
      total_cents: 0,
    });

    expect(r.success).toBe(false);
  });

  it("acepta un importe positivo en un comprobante común", () => {
    const r = SupplierInvoiceInput.safeParse({ ...base, total_cents: 247_428_000 });

    expect(r.success).toBe(true);
  });

  it("acepta un importe negativo en una nota de crédito", () => {
    const r = SupplierInvoiceInput.safeParse({
      ...base,
      document_type: "nota_credito",
      total_cents: -110_000_00,
    });

    expect(r.success).toBe(true);
  });

  it("sigue rechazando el signo cruzado", () => {
    const negativoSinSerNC = SupplierInvoiceInput.safeParse({
      ...base,
      total_cents: -1000,
    });
    const positivoSiendoNC = SupplierInvoiceInput.safeParse({
      ...base,
      document_type: "nota_credito",
      total_cents: 1000,
    });

    expect(negativoSinSerNC.success).toBe(false);
    expect(positivoSiendoNC.success).toBe(false);
  });
});
