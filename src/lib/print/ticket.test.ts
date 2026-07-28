import { describe, expect, it } from "vitest";

import {
  buildComandaContent,
  buildTicketLines,
  renderEscPos,
  type TicketComanda,
} from "./ticket";
import fixtures from "./__fixtures__/tickets.json";

// Fixtures congelados del output ACTUAL del agente (print-agent/agent.mjs) por
// tipo de ticket. El test asevera que el módulo del server produce EXACTAMENTE
// los mismos bytes → red de seguridad contra una regresión de formato sobre la
// impresión de golf al mover el render al server (spec 051, D3 · FR-006/SC-003).
//
// La comanda base coincide 1:1 con la del harness que genera
// `__fixtures__/tickets.json` (`scripts/freeze-ticket-fixtures.ts`). Si cambia
// el formato a propósito: actualizar el módulo del server Y el fallback de
// `print-agent/agent.mjs` en el mismo commit, regenerar los fixtures con el
// harness y verificar en golf — nunca editar el JSON a mano.
//
// 2026-07-28: los ítems pasaron a doble ancho + doble alto, con corte por
// palabra y un renglón en blanco entre ítems (comandas más largas y legibles).
// Fixtures regenerados en ese commit; el agente se actualizó en paralelo.

const base: TicketComanda = {
  comanda_id: "ab12cd34-0000-0000-0000-000000000000",
  station_name: "Cocina",
  table_label: "5",
  batch: 2,
  emitted_at: "2026-07-20T18:30:00-03:00",
  cancelled: false,
  cancelled_reason: null,
  reprint: false,
  items: [
    { quantity: 1, product_name: "Milanesa napolitana", modifiers: [], notes: null },
    { quantity: 2, product_name: "Ñoquis", modifiers: ["con crema"], notes: "bien calientes" },
    { quantity: 1, product_name: "Café con leche", modifiers: [], notes: null },
  ],
};

const cases: Record<keyof typeof fixtures, TicketComanda> = {
  normal: base,
  anulada: { ...base, cancelled: true, cancelled_reason: "cliente se fue" },
  reimpresion: { ...base, reprint: true },
  sinItems: { ...base, items: [] },
};

describe("buildComandaContent · paridad byte-a-byte con el agente", () => {
  for (const name of Object.keys(cases) as (keyof typeof fixtures)[]) {
    it(`ticket ${name}: escpos_b64 idéntico al fixture congelado`, () => {
      const { escpos_b64 } = buildComandaContent(cases[name]);
      expect(escpos_b64).toBe(fixtures[name].escpos_b64);
    });

    it(`ticket ${name}: plain idéntico al fixture congelado`, () => {
      const { plain } = buildComandaContent(cases[name]);
      expect(plain).toBe(fixtures[name].plain);
    });
  }
});

describe("buildTicketLines · ítems grandes y espaciados", () => {
  it("cada ítem va en doble ancho + doble alto (size xl)", () => {
    const lines = buildTicketLines(base);
    const item = lines.find((l) => l.text.startsWith("1x Milanesa"));
    expect(item).toMatchObject({ size: "xl", bold: true });
  });

  it("corta el nombre por palabra a 11 col en vez de desbordar", () => {
    const lines = buildTicketLines(base).filter((l) => l.size === "xl");
    expect(lines.map((l) => l.text)).toEqual([
      "1x Milanesa",
      "napolitana",
      "2x Noquis",
      "1x Cafe con",
      "leche",
    ]);
    for (const l of lines) expect(l.text.length).toBeLessThanOrEqual(11);
  });

  it("mete un renglón en blanco entre ítem e ítem (padding)", () => {
    const texts = buildTicketLines(base).map((l) => l.text);
    expect(texts[texts.indexOf("2x Noquis") - 1]).toBe("");
    expect(texts[texts.indexOf("2x Noquis") - 2]).not.toBe("");
  });

  it("deja 3 renglones entre la línea separadora y el primer ítem, y 3 al final", () => {
    const texts = buildTicketLines(base).map((l) => l.text);
    const rule = texts.lastIndexOf("------------------------");
    expect(texts.slice(rule + 1, rule + 4)).toEqual(["", "", ""]);
    expect(texts[rule + 4]).toBe("1x Milanesa");
    expect(texts.slice(-3)).toEqual(["", "", ""]);
    expect(texts.at(-4)).toBe("leche");
  });

  it("una palabra más larga que el ancho se corta duro, no se pierde", () => {
    const lines = buildTicketLines({
      ...base,
      items: [{ quantity: 1, product_name: "Supercalifragilistico", modifiers: [], notes: null }],
    }).filter((l) => l.size === "xl");
    expect(lines.map((l) => l.text).join("")).toContain("Supercalifragilistico");
    for (const l of lines) expect(l.text.length).toBeLessThanOrEqual(11);
  });
});

describe("buildTicketLines · solo ASCII imprimible", () => {
  it("saca tildes y eñes: la térmica no las imprime", () => {
    const texts = buildTicketLines({
      ...base,
      items: [
        {
          quantity: 1,
          product_name: "Ñoquis a la püttanesca",
          modifiers: ["sin cebolla"],
          notes: "¡rápido!",
        },
      ],
    }).map((l) => l.text);
    expect(texts.join(" ")).toContain("1x Noquis a la puttanesca");
    expect(texts).toContain("obs: rapido!");
  });

  it("traduce los símbolos comunes y descarta el resto", () => {
    const texts = buildTicketLines({
      ...base,
      items: [{ quantity: 1, product_name: "Cafe", modifiers: [], notes: "50° — ok • 🔥 “ya”" }],
    }).map((l) => l.text);
    expect(texts.find((t) => t.startsWith("obs:"))).toBe('obs: 50o - ok * "ya"');
  });

  it("ninguna línea de ningún ticket sale fuera de 0x20–0x7e", () => {
    for (const c of Object.values(cases))
      for (const l of buildTicketLines(c)) expect(l.text).toMatch(/^[\x20-\x7e]*$/);
  });
});

describe("buildComandaContent · base64", () => {
  it("escpos_b64 decodifica (latin1) exactamente a los bytes de renderEscPos", () => {
    const expected = renderEscPos(buildTicketLines(base));
    const { escpos_b64 } = buildComandaContent(base);
    const decoded = Buffer.from(escpos_b64, "base64").toString("latin1");
    expect(decoded).toBe(expected);
  });
});
