// @vitest-environment node
//
// La regla que fija este archivo: **lo que escribe el cliente entra a la
// bandeja pase lo que pase**. El bot puede estar apagado, el turno puede
// rebotar por rate-limit, el modelo puede caerse o Gupshup puede rechazar el
// envío — nada de eso puede hacer desaparecer el mensaje del cliente, porque
// el webhook ya devolvió 200 y ya quemó la fila de dedupe: si no se persiste
// acá, no hay reintento posible y el mensaje no existe para nadie.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local" });

// El turno del modelo se mockea: estos tests son sobre la persistencia, no
// sobre lo que contesta el LLM (y no hay API key en el stack local).
let llmReply = "¡Hola! ¿Para cuántas personas?";
let llmThrows: Error | null = null;
vi.mock("@langchain/anthropic", () => ({
  ChatAnthropic: class {
    bindTools() {
      return this;
    }
    async invoke() {
      if (llmThrows) throw llmThrows;
      return { content: llmReply, tool_calls: [] };
    }
  },
}));

// El rate-limit real necesita Upstash; acá lo controlamos a mano.
let rateLimitOk = true;
vi.mock("@/lib/rate-limit", () => ({
  limitChatbotTurn: async () => ({ success: rateLimitOk }),
}));

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function probe(): Promise<boolean> {
  if (!url || !key) return false;
  const c = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error } = await c.from("chatbot_conversations").select("id").limit(1);
  return !error;
}
const ready = await probe();

const { runChatbot } = await import("./agent");
const { ChatbotNotConfiguredError } = await import("./config-state");
const { ChatbotRateLimitedError } = await import("./agent");

describe.skipIf(!ready)("el entrante de WhatsApp nunca se pierde", () => {
  const db = createClient(url!, key!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const slug = `test-p12-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  let businessId = "";
  let identifier = "";

  beforeAll(async () => {
    process.env.ANTHROPIC_API_KEY = "sk-test-no-se-usa";
    const { data, error } = await db
      .from("businesses")
      .insert({
        slug,
        name: "P12 Test",
        is_active: true,
        timezone: "America/Argentina/Buenos_Aires",
      })
      .select("id")
      .single();
    if (error || !data) throw new Error(`biz: ${error?.message}`);
    businessId = data.id;
    await db
      .from("chatbot_configs")
      .insert({ business_id: businessId, chatbot_enabled: true });
  });

  afterAll(async () => {
    // `businesses` cascadea a chatbot_configs / contacts / conversations /
    // messages, así que con borrar el negocio alcanza.
    if (businessId) await db.from("businesses").delete().eq("id", businessId);
  });

  beforeEach(async () => {
    // Cada caso estrena teléfono: así no dependen del orden ni se pisan la
    // conversación entre ellos.
    identifier = `549341${Math.floor(Math.random() * 1e7)
      .toString()
      .padStart(7, "0")}`;
    rateLimitOk = true;
    llmThrows = null;
    llmReply = "¡Hola! ¿Para cuántas personas?";
    await db
      .from("chatbot_configs")
      .update({ chatbot_enabled: true })
      .eq("business_id", businessId);
  });

  function turno(extra: Record<string, unknown> = {}) {
    return {
      businessId,
      businessSlug: slug,
      businessName: "P12 Test",
      channel: "whatsapp" as const,
      contactIdentifier: identifier,
      userMessage: "hola, tienen mesa para 6 el sábado?",
      ...extra,
    };
  }

  async function mensajesDelContacto() {
    const { data: contact } = await db
      .from("chatbot_contacts")
      .select("id")
      .eq("business_id", businessId)
      .eq("identifier", identifier)
      .maybeSingle();
    if (!contact) return [];
    const { data: convs } = await db
      .from("chatbot_conversations")
      .select("id")
      .eq("contact_id", contact.id);
    const ids = (convs ?? []).map((c) => c.id);
    if (!ids.length) return [];
    const { data } = await db
      .from("chatbot_messages")
      .select("role, content, created_at")
      .in("conversation_id", ids)
      .order("created_at", { ascending: true });
    return data ?? [];
  }

  it("con el bot apagado, el mensaje del cliente igual queda en la bandeja", async () => {
    // Apagar el bot es justamente lo que hace el dueño para atender a mano; si
    // el mensaje no se persiste, la bandeja queda vacía y nadie se entera.
    await db
      .from("chatbot_configs")
      .update({ chatbot_enabled: false })
      .eq("business_id", businessId);

    await expect(runChatbot(turno())).rejects.toBeInstanceOf(
      ChatbotNotConfiguredError,
    );

    const msgs = await mensajesDelContacto();
    expect(msgs).toHaveLength(1);
    expect(msgs[0]!.role).toBe("user");
    expect(msgs[0]!.content).toBe("hola, tienen mesa para 6 el sábado?");
  });

  it("rebotado por rate-limit, el mensaje del cliente igual queda en la bandeja", async () => {
    rateLimitOk = false;

    await expect(runChatbot(turno())).rejects.toBeInstanceOf(
      ChatbotRateLimitedError,
    );

    const msgs = await mensajesDelContacto();
    expect(msgs).toHaveLength(1);
    expect(msgs[0]!.role).toBe("user");
  });

  it("si el turno del modelo se cae, el hilo sube igual en la bandeja", async () => {
    // Primer turno normal, para dejar la conversación con un updated_at viejo.
    await runChatbot(turno());
    const { data: conv } = await db
      .from("chatbot_conversations")
      .select("id, updated_at")
      .eq("business_id", businessId)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();
    const antes = new Date(conv!.updated_at).getTime();
    await db
      .from("chatbot_conversations")
      .update({ updated_at: new Date(antes - 60_000).toISOString() })
      .eq("id", conv!.id);

    llmThrows = new Error("529 overloaded");
    await expect(
      runChatbot(turno({ userMessage: "¿me confirmás?" })),
    ).rejects.toThrow();

    const { data: despues } = await db
      .from("chatbot_conversations")
      .select("updated_at")
      .eq("id", conv!.id)
      .single();
    // La bandeja ordena por updated_at desc: sin este bump el hilo se queda
    // enterrado donde estaba, con el mensaje sin responder adentro.
    expect(new Date(despues!.updated_at).getTime()).toBeGreaterThan(
      antes - 60_000,
    );
    const msgs = await mensajesDelContacto();
    expect(msgs.map((m) => m.content)).toContain("¿me confirmás?");
  });

  it("si el envío por WhatsApp falla, no queda la burbuja del bot en la bandeja", async () => {
    // Una burbuja del bot significa "esto le llegó al cliente". Si Gupshup
    // rechazó el envío y la burbuja igual aparece, la encargada ve la
    // conversación como contestada y nadie vuelve a mirarla.
    const res = await runChatbot(
      turno({ deliver: async () => ({ ok: false, error: "sin saldo" }) }),
    );
    expect(res.delivered).toBe(false);

    const msgs = await mensajesDelContacto();
    expect(msgs.map((m) => m.role)).toEqual(["user"]);
  });

  it("si el envío sale bien, la burbuja del bot sí queda", async () => {
    const res = await runChatbot(turno({ deliver: async () => ({ ok: true }) }));
    expect(res.delivered).toBe(true);

    const msgs = await mensajesDelContacto();
    expect(msgs.map((m) => m.role)).toEqual(["user", "assistant"]);
  });

  it("al reciclar la conversación por inactividad, el handoff al humano se hereda", async () => {
    // El TTL cierra la conversación vieja y abre una nueva; la nueva nacía con
    // agent_enabled=true por default, así que el "lo atiendo yo" de la
    // encargada caducaba solo, sin que nadie lo decidiera ni lo viera.
    await runChatbot(turno({ deliver: async () => ({ ok: true }) }));
    const { data: vieja } = await db
      .from("chatbot_conversations")
      .select("id")
      .eq("business_id", businessId)
      .is("closed_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();
    await db
      .from("chatbot_conversations")
      .update({
        agent_enabled: false,
        updated_at: new Date(Date.now() - 20 * 3_600_000).toISOString(),
      })
      .eq("id", vieja!.id);

    const res = await runChatbot(
      turno({ userMessage: "¿seguís ahí?", deliver: async () => ({ ok: true }) }),
    );
    expect(res.conversationId).not.toBe(vieja!.id);
    expect(res.assistantMessage).toBe("");

    const { data: nueva } = await db
      .from("chatbot_conversations")
      .select("agent_enabled")
      .eq("id", res.conversationId)
      .single();
    expect(nueva!.agent_enabled).toBe(false);
  });
});
