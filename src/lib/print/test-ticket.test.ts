import { describe, expect, it } from "vitest";

import { buildTestTicketContent, buildTestTicketLines } from "./test-ticket";

const base = {
  label: "Parrilla",
  printer_ip: "192.168.10.50",
  printer_port: 9100,
  emitted_at: "2026-09-09T21:30:00.000Z",
  business_name: "Restaurante Demo",
};

describe("papel de prueba de comandera (spec 176)", () => {
  it("dice PRUEBA, la comandera y su destino", () => {
    const texto = buildTestTicketLines(base)
      .map((l) => l.text)
      .join("\n");
    expect(texto).toContain("PRUEBA");
    expect(texto).toContain("Parrilla");
    expect(texto).toContain("192.168.10.50:9100");
    expect(texto).toContain("Restaurante Demo");
  });

  it("imprime la hora del local, no la UTC del server", () => {
    // 21:30 UTC = 18:30 en Buenos Aires, y en reloj de 24h.
    const texto = buildTestTicketLines(base)
      .map((l) => l.text)
      .join("\n");
    expect(texto).toContain("18:30");
  });

  it("pasa el nombre de quien la pidió a ASCII", () => {
    const texto = buildTestTicketLines({
      ...base,
      requested_by_name: "Sofía Núñez",
    })
      .map((l) => l.text)
      .join("\n");
    expect(texto).toContain("Pidio: Sofia Nunez");
  });

  it("omite el renglón de quien la pidió si no hay nombre", () => {
    const texto = buildTestTicketLines({ ...base, requested_by_name: "  " })
      .map((l) => l.text)
      .join("\n");
    expect(texto).not.toContain("Pidio");
  });

  it("corta el ESC/POS con el mismo cierre que una comanda", () => {
    const { escpos_b64, plain } = buildTestTicketContent(base);
    const bytes = Buffer.from(escpos_b64, "base64").toString("latin1");
    expect(bytes.startsWith("\x1b@")).toBe(true); // init
    expect(bytes).toContain("\x1dV\x00"); // corte parcial
    expect(bytes.endsWith("\x1b@")).toBe(true); // deja la impresora como estaba
    expect(plain).toContain("PRUEBA");
  });
});
