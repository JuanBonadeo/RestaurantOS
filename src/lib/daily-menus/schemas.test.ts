import { describe, it, expect } from "vitest";

import { DailyMenuComponentInput, DailyMenuInput } from "./schemas";

const baseChoice = {
  label: "Cerveza",
  kind: "choice" as const,
  product_id: "11111111-1111-4111-8111-111111111111",
  choice_group_id: "22222222-2222-4222-8222-222222222222",
};

describe("DailyMenuComponentInput · extra_price_cents", () => {
  it("acepta omitir el adicional (la columna DB aplica el default 0)", () => {
    const result = DailyMenuComponentInput.safeParse(baseChoice);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.extra_price_cents).toBeUndefined();
  });

  it("acepta un adicional positivo", () => {
    const parsed = DailyMenuComponentInput.parse({
      ...baseChoice,
      extra_price_cents: 80000,
    });
    expect(parsed.extra_price_cents).toBe(80000);
  });

  it("rechaza un adicional negativo", () => {
    const result = DailyMenuComponentInput.safeParse({
      ...baseChoice,
      extra_price_cents: -1,
    });
    expect(result.success).toBe(false);
  });

  it("rechaza un adicional no entero", () => {
    const result = DailyMenuComponentInput.safeParse({
      ...baseChoice,
      extra_price_cents: 12.5,
    });
    expect(result.success).toBe(false);
  });
});

describe("DailyMenuInput · condición del grupo (spec 087)", () => {
  const PRINCIPAL = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const GUARNICION = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

  const option = (
    groupId: string,
    label: string,
    groupLabel: string,
    blocks: string[] = [],
  ) => ({
    label,
    kind: "choice" as const,
    product_id: "11111111-1111-4111-8111-111111111111",
    choice_group_id: groupId,
    choice_group_label: groupLabel,
    blocks_choice_group_ids: blocks,
  });

  const menu = (components: unknown[]) => ({
    name: "Menú ejecutivo",
    slug: "menu-ejecutivo",
    price_cents: 1500000,
    available_days: [1, 2, 3],
    is_active: true,
    is_available: true,
    sort_order: 0,
    display_context: "both" as const,
    is_suggestion: false,
    components,
  });

  it("acepta condicionar un grupo posterior", () => {
    const result = DailyMenuInput.safeParse(
      menu([
        option(PRINCIPAL, "Milanesa", "Principal"),
        option(PRINCIPAL, "Ravioles", "Principal", [GUARNICION]),
        option(GUARNICION, "Papas", "Guarnición"),
      ]),
    );
    expect(result.success).toBe(true);
  });

  it("rechaza depender de un grupo POSTERIOR — todavía no se eligió", () => {
    // Spec 087: la condición vive en el grupo. Guarnición va primero y quiere
    // depender de Principal, que se decide después: no hay forma de aplicarla.
    const result = DailyMenuInput.safeParse({
      ...menu([
        option(GUARNICION, "Papas", "Guarnición"),
        option(PRINCIPAL, "Ravioles", "Principal"),
      ]),
      choice_groups: [
        {
          id: GUARNICION,
          name: "Guarnición",
          applies_when_group_id: PRINCIPAL,
          applies_when_product_ids: [],
        },
        { id: PRINCIPAL, name: "Principal" },
      ],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toContain("se decide después que");
    }
  });

  it("acepta depender de un grupo ANTERIOR", () => {
    const result = DailyMenuInput.safeParse({
      ...menu([
        option(PRINCIPAL, "Ravioles", "Principal"),
        option(GUARNICION, "Papas", "Guarnición"),
      ]),
      choice_groups: [
        { id: PRINCIPAL, name: "Principal" },
        {
          id: GUARNICION,
          name: "Guarnición",
          applies_when_group_id: PRINCIPAL,
          applies_when_product_ids: ["11111111-1111-4111-8111-111111111111"],
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("rechaza que un grupo dependa de sí mismo", () => {
    const result = DailyMenuInput.safeParse({
      ...menu([option(PRINCIPAL, "Milanesa", "Principal")]),
      choice_groups: [
        { id: PRINCIPAL, name: "Principal", applies_when_group_id: PRINCIPAL },
      ],
    });
    expect(result.success).toBe(false);
  });

  it("un menú sin grupos condicionados sigue siendo válido", () => {
    const result = DailyMenuInput.safeParse({
      ...menu([option(PRINCIPAL, "Milanesa", "Principal")]),
      choice_groups: [{ id: PRINCIPAL, name: "Principal" }],
    });
    expect(result.success).toBe(true);
  });

  it("tolera una referencia a un grupo que ya no existe — la limpia la action", () => {
    const result = DailyMenuInput.safeParse(
      menu([option(PRINCIPAL, "Ravioles", "Principal", [GUARNICION])]),
    );
    expect(result.success).toBe(true);
  });

  it("sin condiciones sigue siendo válido (aditiva)", () => {
    const result = DailyMenuInput.safeParse(
      menu([{ label: "Postre del día", kind: "text" as const }]),
    );
    expect(result.success).toBe(true);
  });
});
