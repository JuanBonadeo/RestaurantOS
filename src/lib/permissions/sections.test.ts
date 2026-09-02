import { describe, expect, it } from "vitest";

import { canAnularFactura, canCrearPedidoFlash } from "./can";
import {
  canSee,
  hasAnySection,
  sectionAccess,
  type AdminSection,
} from "./sections";

describe("sectionAccess / canSee", () => {
  it("el admin ve todo en full", () => {
    const sections: AdminSection[] = [
      "dashboard",
      "cajas",
      "reportes",
      "chatbot",
      "configuracion",
      "rrhh",
    ];
    for (const s of sections) {
      expect(sectionAccess(s, "admin")).toBe("full");
      expect(canSee(s, "admin")).toBe(true);
    }
  });

  it("el platform admin ve todo aunque no tenga rol", () => {
    expect(sectionAccess("configuracion", null, { isPlatformAdmin: true })).toBe(
      "full",
    );
    expect(canSee("reportes", null, { isPlatformAdmin: true })).toBe(true);
  });

  it("sin rol (no-miembro) no ve nada", () => {
    expect(sectionAccess("dashboard", null)).toBe("none");
    expect(canSee("dashboard", null)).toBe(false);
  });

  describe("encargado", () => {
    it("NO ve Reportes ni Configuración (datos/config sensibles)", () => {
      expect(canSee("reportes", "encargado")).toBe(false);
      expect(canSee("configuracion", "encargado")).toBe(false);
    });

    it("NO ve el Dashboard (analítica del negocio, admin-only desde 2026-07-25)", () => {
      expect(canSee("dashboard", "encargado")).toBe(false);
    });

    it("sí ve Operación y Reservas (su turno)", () => {
      expect(sectionAccess("operacion", "encargado")).toBe("full");
      expect(canSee("reservas", "encargado")).toBe(true);
    });

    it("NO ve la sección admin de Cajas (sus cortes viven en Operación)", () => {
      expect(canSee("cajas", "encargado")).toBe(false);
    });

    // #139 — antes era `none` porque se asumía que el encargado emitía "en el
    // flujo de cobro". Emitir sí, pero DESPUÉS no tenía dónde: reintentar una
    // fallida, anular con nota de crédito o buscar la factura de una mesa que
    // ya se fue sólo se puede acá. La config AFIP sigue siendo admin-only,
    // pero vive en `configuracion`, no en esta sección.
    it("SÍ ve Facturación: cobra, y reintentar/anular un comprobante es suyo", () => {
      expect(sectionAccess("facturacion", "encargado")).toBe("full");
      expect(canAnularFactura("encargado")).toBe(true);
      expect(canCrearPedidoFlash("encargado")).toBe(true);
      // La llave del negocio no se abre: la config AFIP no está en esta sección.
      expect(canSee("configuracion", "encargado")).toBe(false);
    });

    it("ve el Chatbot pero solo en versión recortada (on/off)", () => {
      expect(sectionAccess("chatbot", "encargado")).toBe("limited");
      expect(canSee("chatbot", "encargado")).toBe(true);
    });

    it("ve Proveedores, Promociones y Campañas (alineado con can.ts)", () => {
      expect(canSee("proveedores", "encargado")).toBe(true);
      expect(canSee("promociones", "encargado")).toBe(true);
      expect(canSee("campanas", "encargado")).toBe(true);
    });

    it("gestiona Salones completo (layout del local, desde 2026-07-28)", () => {
      expect(sectionAccess("salones", "encargado")).toBe("full");
    });

    it("NO ve RRHH (admin-only desde 2026-06-15)", () => {
      expect(canSee("rrhh", "encargado")).toBe(false);
    });
  });

  describe("mozo / personal", () => {
    // Spec 140: esta celda decía "limited" y nunca se cumplió — el layout de
    // `(authed)` redirigía al mozo antes de evaluarla. Ahora que el gate
    // delega en la matriz, decir "limited" lo dejaría entrar al panel de
    // verdad. Quien opera Operación desde el salón es `terminal`.
    it("el mozo no ve el panel: su superficie es /mozo", () => {
      expect(sectionAccess("operacion", "mozo")).toBe("none");
      expect(canSee("dashboard", "mozo")).toBe(false);
      expect(canSee("reportes", "mozo")).toBe(false);
    });

    it("el personal no ve el panel admin", () => {
      expect(canSee("dashboard", "personal")).toBe(false);
      expect(canSee("operacion", "personal")).toBe(false);
      expect(canSee("chatbot", "personal")).toBe(false);
    });
  });
});

describe("sectionAccess / rol terminal (spec 140)", () => {
  it("sólo ve Operación, y recortada", () => {
    expect(sectionAccess("operacion", "terminal")).toBe("limited");
  });

  it("no ve ninguna otra sección del panel", () => {
    const otras: AdminSection[] = [
      "dashboard",
      "pedidos",
      "cajas",
      "catalogo",
      "salones",
      "reservas",
      "clientes",
      "promociones",
      "campanas",
      "chatbot",
      "conversaciones",
      "reportes",
      "proveedores",
      "facturacion",
      "rrhh",
      "configuracion",
      "ayuda",
    ];
    for (const s of otras) {
      expect(sectionAccess(s, "terminal"), s).toBe("none");
      expect(canSee(s, "terminal"), s).toBe(false);
    }
  });

  it("el mozo NO entra a operación: su superficie es /mozo", () => {
    // La celda decía "limited" desde la spec 14, pero era letra muerta — el
    // layout lo redirigía antes. Ahora que el gate delega en `canSee`, la
    // matriz tiene que decir la verdad o el mozo se colaría al panel.
    expect(sectionAccess("operacion", "mozo")).toBe("none");
    expect(canSee("operacion", "mozo")).toBe(false);
  });
});

describe("hasAnySection", () => {
  it("admin, encargado y terminal entran al panel", () => {
    expect(hasAnySection("admin")).toBe(true);
    expect(hasAnySection("encargado")).toBe(true);
    expect(hasAnySection("terminal")).toBe(true);
  });

  it("mozo y personal no: su superficie no es el panel", () => {
    expect(hasAnySection("mozo")).toBe(false);
    expect(hasAnySection("personal")).toBe(false);
  });

  it("el platform admin entra aunque no tenga rol", () => {
    expect(hasAnySection(null, { isPlatformAdmin: true })).toBe(true);
    expect(hasAnySection(null)).toBe(false);
  });
});
