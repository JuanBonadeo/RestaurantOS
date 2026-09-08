import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ── Estado controlable por los mocks ────────────────────────────────────────
let credsRow: { webhook_token: string | null; app_name: string | null } | null = {
  webhook_token: "s3cr3t-token",
  app_name: "GolfHouse",
};
let businessRow: { slug: string | null; name: string | null } | null = {
  slug: "golf",
  name: "Golf",
};
let insertError: { code: string } | null = null;

// `after` corre post-respuesta; acá coleccionamos los callbacks para dispararlos
// manualmente y poder asertar el turno del bot.
const afterCbs: Array<() => unknown> = [];

vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return { ...actual, after: (cb: () => unknown) => afterCbs.push(cb) };
});

vi.mock("@/lib/supabase/service", () => ({
  createSupabaseServiceClient: () => ({
    from: (table: string) => {
      if (table === "whatsapp_inbound_events") {
        return { insert: async () => ({ error: insertError }) };
      }
      const row = table === "whatsapp_credentials" ? credsRow : businessRow;
      return {
        select: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: row, error: null }) }),
        }),
      };
    },
  }),
}));

// El envío vive DENTRO de runChatbot (via `deliver`), así que el doble tiene
// que ejercitarlo igual que el real: entrega y sólo entonces "persiste".
const runChatbot = vi.fn(async (input: Record<string, unknown>) => {
  const assistantMessage = "¡Hola! ¿Querés reservar?";
  const deliver = input.deliver as
    | ((t: string) => Promise<{ ok: boolean }>)
    | undefined;
  const delivery = deliver ? await deliver(assistantMessage) : { ok: true };
  return {
    conversationId: "c1",
    assistantMessage: delivery.ok ? assistantMessage : "",
    toolTrace: [],
    delivered: delivery.ok,
  };
});
const persistInboundMessage = vi.fn(async (_input: Record<string, unknown>) => ({
  conversationId: "c1",
}));
class ChatbotRateLimitedError extends Error {}
vi.mock("@/lib/chatbot/agent", () => ({
  runChatbot,
  persistInboundMessage,
  ChatbotRateLimitedError,
}));

class ChatbotNotConfiguredError extends Error {}
vi.mock("@/lib/chatbot/config-state", () => ({ ChatbotNotConfiguredError }));

type SendResult =
  | { ok: true; sent_at: string; messageId: string | null }
  | { ok: false; error: string };
const sendWhatsapp = vi.fn(
  async (): Promise<SendResult> => ({ ok: true, sent_at: "now", messageId: "m1" }),
);
vi.mock("@/lib/notifications/whatsapp-sender", () => ({ sendWhatsapp }));

const recordWhatsappFailure = vi.fn(
  async (_params: Record<string, unknown>) => undefined,
);
vi.mock("@/lib/notifications/whatsapp-outbox", () => ({ recordWhatsappFailure }));

vi.mock("@/lib/reservations/chatbot-actions", () => ({
  normalizePhone: (s: string) => s.replace(/\D/g, ""),
}));

const { POST } = await import("./route");

function textEnvelope() {
  return {
    app: "GolfHouse",
    type: "message",
    payload: {
      id: "MSG-1",
      source: "5491122334455",
      type: "text",
      payload: { text: "Hola, quiero reservar" },
      sender: { phone: "5491122334455", name: "Ana" },
    },
  };
}

function makeReq(body: unknown, token = "s3cr3t-token") {
  return new Request(
    `https://x/api/chatbot/whatsapp/b1?token=${encodeURIComponent(token)}`,
    { method: "POST", body: JSON.stringify(body) },
  );
}

const ctx = { params: Promise.resolve({ businessId: "b1" }) };

async function runAfters() {
  for (const cb of afterCbs) await cb();
}

beforeEach(() => {
  credsRow = { webhook_token: "s3cr3t-token", app_name: "GolfHouse" };
  businessRow = { slug: "golf", name: "Golf" };
  insertError = null;
  afterCbs.length = 0;
  runChatbot.mockClear();
  persistInboundMessage.mockClear();
  sendWhatsapp.mockClear();
  sendWhatsapp.mockResolvedValue({ ok: true, sent_at: "now", messageId: "m1" });
  recordWhatsappFailure.mockClear();
});
afterEach(() => vi.restoreAllMocks());

describe("POST /api/chatbot/whatsapp/[businessId]", () => {
  it("texto con token válido → 200, corre el bot y responde por WhatsApp", async () => {
    const res = await POST(makeReq(textEnvelope()), ctx);
    expect(res.status).toBe(200);
    await runAfters();
    expect(runChatbot).toHaveBeenCalledOnce();
    const arg = runChatbot.mock.calls[0]![0] as Record<string, unknown>;
    expect(arg.channel).toBe("whatsapp");
    expect(arg.contactIdentifier).toBe("5491122334455");
    expect(arg.userMessage).toBe("Hola, quiero reservar");
    expect(sendWhatsapp).toHaveBeenCalledOnce();
  });

  it("agente en handoff (assistantMessage vacío) → 200 y NO manda WhatsApp", async () => {
    // runChatbot devuelve "" cuando el staff apagó el agente para la conversación
    // (spec 32): el webhook no debe mandar un WhatsApp vacío por encima del humano.
    runChatbot.mockResolvedValueOnce({
      conversationId: "c1",
      assistantMessage: "",
      toolTrace: [],
      delivered: true,
    });
    const res = await POST(makeReq(textEnvelope()), ctx);
    expect(res.status).toBe(200);
    await runAfters();
    expect(runChatbot).toHaveBeenCalledOnce();
    expect(sendWhatsapp).not.toHaveBeenCalled();
  });

  it("token inválido → 401 y no corre el bot", async () => {
    const res = await POST(makeReq(textEnvelope(), "wrong"), ctx);
    expect(res.status).toBe(401);
    await runAfters();
    expect(runChatbot).not.toHaveBeenCalled();
  });

  it("mensaje duplicado (unique_violation) → 200 sin reprocesar", async () => {
    insertError = { code: "23505" };
    const res = await POST(makeReq(textEnvelope()), ctx);
    expect(res.status).toBe(200);
    await runAfters();
    expect(runChatbot).not.toHaveBeenCalled();
  });

  it("media → 200 y no corre el bot (fase 1 no procesa media)", async () => {
    const media = {
      app: "GolfHouse",
      type: "message",
      payload: {
        id: "IMG-1",
        source: "5491122334455",
        type: "image",
        payload: { url: "https://filemanager.gupshup.io/x.jpg" },
        sender: { phone: "5491122334455" },
      },
    };
    const res = await POST(makeReq(media), ctx);
    expect(res.status).toBe(200);
    await runAfters();
    expect(runChatbot).not.toHaveBeenCalled();

    // El bot no la procesa, pero la encargada tiene que verla: antes el webhook
    // cortaba antes de cualquier escritura y la foto/el audio no existían para
    // el sistema, con el cliente viendo el tilde de entregado.
    expect(persistInboundMessage).toHaveBeenCalledOnce();
    const arg = persistInboundMessage.mock.calls[0]![0] as Record<string, unknown>;
    expect(arg.contactIdentifier).toBe("5491122334455");
    expect(String(arg.userMessage)).toContain("imagen");
  });

  it("Gupshup rechaza el envío → queda fila failed y el bot no figura como que contestó", async () => {
    sendWhatsapp.mockResolvedValueOnce({ ok: false, error: "sin saldo" });
    const res = await POST(makeReq(textEnvelope()), ctx);
    expect(res.status).toBe(200);
    await runAfters();
    expect(sendWhatsapp).toHaveBeenCalledOnce();
    // Sin esto, el envío fallido no dejaba ni un console.error: el único
    // síntoma era que el cliente no volvía a escribir.
    expect(recordWhatsappFailure).toHaveBeenCalledOnce();
    const arg = recordWhatsappFailure.mock.calls[0]![0];
    expect(arg.error).toBe("sin saldo");
    expect(arg.toPhone).toBe("5491122334455");
  });

  it("error de base que NO es duplicado → 5xx para que Gupshup reintente", async () => {
    // Colapsar todo error del insert de dedupe en "ya procesado" convertía un
    // pool agotado o un timeout en un 200: Gupshup daba el mensaje por
    // entregado y se perdía para siempre, justo cuando la base está sufriendo.
    insertError = { code: "57014" }; // query_canceled (timeout)
    const res = await POST(makeReq(textEnvelope()), ctx);
    expect(res.status).toBeGreaterThanOrEqual(500);
    await runAfters();
    expect(runChatbot).not.toHaveBeenCalled();
  });

  it("message-event (DLR) → 200 y no corre el bot", async () => {
    const res = await POST(
      makeReq({ app: "GolfHouse", type: "message-event", payload: {} }),
      ctx,
    );
    expect(res.status).toBe(200);
    await runAfters();
    expect(runChatbot).not.toHaveBeenCalled();
  });
});
