import { beforeEach, describe, expect, it, vi } from "vitest";

// El heartbeat (spec 35) upsertea `print_agent_status.last_seen_at` con la
// misma PRINT_AGENT_KEY. Mockeamos el service client (upsert).

let upsertCalls: { vals: Record<string, unknown>; opts: unknown }[];

vi.mock("@/lib/supabase/service", () => ({
  createSupabaseServiceClient: () => ({
    from: () => ({
      upsert: (vals: Record<string, unknown>, opts: unknown) => {
        upsertCalls.push({ vals, opts });
        return Promise.resolve({ error: null });
      },
    }),
  }),
}));

// Key por-negocio (la global se retiró, security review #4): biz1 usa "test-key".
vi.mock("@/lib/print-agent/credentials", () => ({
  listPrintAgentCredentials: async (businessId: string) =>
    businessId === "biz1"
      ? [
          {
            id: "agente-biz1",
            apiKey: "test-key",
            label: null,
            printerScope: null,
          },
        ]
      : [],
}));

const { POST } = await import("./route");

function postReq(body: unknown, auth = "Bearer test-key") {
  return new Request("http://localhost/api/print-agent/heartbeat", {
    method: "POST",
    headers: auth
      ? { authorization: auth, "content-type": "application/json" }
      : { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  process.env.PRINT_AGENT_KEY = "test-key";
  upsertCalls = [];
});

describe("POST /api/print-agent/heartbeat (spec 35)", () => {
  it("con Bearer válido → upsertea last_seen_at POR AGENTE (spec 124)", async () => {
    // El agente no manda nada nuevo: quién latió sale de su key. Antes el
    // upsert era por `business_id` a secas y dos PCs se pisaban la fila, así
    // que una caída se tapaba con el latido de la otra.
    const res = await POST(postReq({ business_id: "biz1" }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
    expect(upsertCalls).toHaveLength(1);
    expect(upsertCalls[0].vals).toMatchObject({
      business_id: "biz1",
      agent_id: "agente-biz1",
    });
    expect(upsertCalls[0].vals).toHaveProperty("last_seen_at");
    expect(upsertCalls[0].opts).toMatchObject({
      onConflict: "business_id,agent_id",
    });
  });

  it("sin Bearer válido → 401, no upsertea", async () => {
    const res = await POST(postReq({ business_id: "biz1" }, ""));
    expect(res.status).toBe(401);
    expect(upsertCalls).toHaveLength(0);
  });

  it("sin business_id → 401 (sin negocio no se puede autenticar la key; security review #4)", async () => {
    const res = await POST(postReq({}));
    expect(res.status).toBe(401);
    expect(upsertCalls).toHaveLength(0);
  });
});
