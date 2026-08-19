import { beforeEach, describe, expect, it, vi } from "vitest";

// autenticarAgente (spec 046 + 124) autentica SOLO con una key POR AGENTE de
// print_agent_credentials. La key global se retiró (security review #4).
// Desde la 124 un negocio puede tener varias, y la key dice CUÁL de los agentes
// está llamando: no devuelve un booleano, devuelve el agente.
// Mockeamos el lookup por-negocio.

import type { PrintAgentCredential } from "@/lib/print-agent/credentials";

let porNegocio: Record<string, PrintAgentCredential[]>;

vi.mock("@/lib/print-agent/credentials", () => ({
  listPrintAgentCredentials: async (businessId: string) =>
    porNegocio[businessId] ?? [],
}));

const { autenticarAgente } = await import("./agent-auth");

function req(auth?: string) {
  return new Request("http://localhost/api/print-agent", {
    headers: auth ? { authorization: auth } : {},
  });
}

const AGENTE_A: PrintAgentCredential = {
  id: "agente-salon",
  apiKey: "pak_live_AAA",
  label: "Caja principal",
  printerScope: ["192.168.100.0/24"],
};
const AGENTE_B: PrintAgentCredential = {
  id: "agente-bar",
  apiKey: "pak_live_BBB",
  label: "Caja bar",
  printerScope: null,
};

beforeEach(() => {
  process.env.PRINT_AGENT_KEY = "global-key";
  porNegocio = { bizA: [AGENTE_A], bizB: [AGENTE_B] };
});

describe("autenticarAgente (spec 046 + 124)", () => {
  it("la key global RETIRADA ya no autentica (security review #4)", async () => {
    // Aunque PRINT_AGENT_KEY esté seteada en el env, se ignora: solo por-agente.
    expect(await autenticarAgente(req("Bearer global-key"), "bizA")).toBeNull();
  });

  it("la key correcta devuelve QUÉ agente es, con su alcance", async () => {
    expect(await autenticarAgente(req("Bearer pak_live_AAA"), "bizA")).toEqual(
      AGENTE_A,
    );
  });

  it("rechaza la key de un negocio usada contra OTRO negocio", async () => {
    expect(await autenticarAgente(req("Bearer pak_live_AAA"), "bizB")).toBeNull();
  });

  it("sin header Bearer → null", async () => {
    expect(await autenticarAgente(req(), "bizA")).toBeNull();
    expect(await autenticarAgente(req("global-key"), "bizA")).toBeNull();
  });

  it("token inválido sin businessId → null", async () => {
    expect(await autenticarAgente(req("Bearer nope"))).toBeNull();
  });

  it("key válida sin businessId → null (no puede validar contra la tabla)", async () => {
    expect(await autenticarAgente(req("Bearer pak_live_AAA"))).toBeNull();
  });

  it("negocio sin ninguna key cargada → null", async () => {
    porNegocio = { bizA: [] };
    expect(await autenticarAgente(req("Bearer pak_live_AAA"), "bizA")).toBeNull();
  });

  it("comparación de distinta longitud → null, sin throw (timing-safe)", async () => {
    expect(await autenticarAgente(req("Bearer short"), "bizA")).toBeNull();
  });

  it("sin key global seteada, sólo valida por negocio", async () => {
    delete process.env.PRINT_AGENT_KEY;
    expect(await autenticarAgente(req("Bearer pak_live_AAA"), "bizA")).toEqual(
      AGENTE_A,
    );
    expect(await autenticarAgente(req("Bearer global-key"), "bizA")).toBeNull();
  });

  // ── Spec 124: varios agentes en el mismo negocio ─────────────────────────

  it("con dos agentes, cada key resuelve al suyo", async () => {
    porNegocio = { golf: [AGENTE_A, AGENTE_B] };
    expect(await autenticarAgente(req("Bearer pak_live_AAA"), "golf")).toEqual(
      AGENTE_A,
    );
    expect(await autenticarAgente(req("Bearer pak_live_BBB"), "golf")).toEqual(
      AGENTE_B,
    );
  });

  it("una key que no es de ninguno de los dos → null", async () => {
    porNegocio = { golf: [AGENTE_A, AGENTE_B] };
    expect(await autenticarAgente(req("Bearer pak_live_CCC"), "golf")).toBeNull();
  });

  it("una key de largo distinto no rompe el barrido de las demás", async () => {
    // El timingSafeEqual tira si los buffers miden distinto: si el largo no se
    // chequea ANTES, la primera credencial de otro largo voltea la request
    // entera y el agente bueno se queda afuera.
    porNegocio = {
      golf: [{ ...AGENTE_A, apiKey: "corta" }, AGENTE_B],
    };
    expect(await autenticarAgente(req("Bearer pak_live_BBB"), "golf")).toEqual(
      AGENTE_B,
    );
  });
});
