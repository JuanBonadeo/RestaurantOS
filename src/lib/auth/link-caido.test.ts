import { describe, expect, it } from "vitest";

import { MOTIVO_LINK_VENCIDO, destinoDeLinkCaido } from "./link-caido";

describe("destinoDeLinkCaido (spec 171 · D3)", () => {
  it("un link a la bienvenida cae en el login DEL NEGOCIO, con el motivo", () => {
    expect(destinoDeLinkCaido("/golf-jcr/admin/bienvenida")).toBe(
      `/golf-jcr/admin/login?reason=${MOTIVO_LINK_VENCIDO}`,
    );
  });

  it("el del que ya tiene contraseña (va al panel) cae en el mismo lugar", () => {
    // Sin esto rebota en el gate de `context.ts`, que redirige al login sin
    // motivo: pantalla pelada y una persona que cree que el sistema no anda.
    expect(destinoDeLinkCaido("/golf-jcr/admin")).toBe(
      `/golf-jcr/admin/login?reason=${MOTIVO_LINK_VENCIDO}`,
    );
  });

  it("no duplica el motivo si ya estaba en el login", () => {
    expect(destinoDeLinkCaido("/golf-jcr/admin/login")).toBe(
      `/golf-jcr/admin/login?reason=${MOTIVO_LINK_VENCIDO}`,
    );
  });

  it("sin negocio en el `next`, lo deja donde iba y no inventa un slug", () => {
    expect(destinoDeLinkCaido("/")).toBe("/");
    expect(destinoDeLinkCaido("/golf-jcr")).toBe("/golf-jcr");
  });
});
