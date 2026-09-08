import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Fakes configurables: service client de Supabase + next/headers ──────
// Cubren el enforcement de origen de `clockPunch` (spec 11) sin DB ni red.

type Member = { user_id: string; full_name: string | null; disabled_at: null };

let currentXff: string | null = null;

let captured: {
  blocked: Record<string, unknown>[];
  entries: Record<string, unknown>[];
};

function makeFakeService(opts: {
  origins?: { cidr: string }[];
  member?: Member | null;
  openEntry?: { id: string; clock_in: string } | null;
}) {
  captured = { blocked: [], entries: [] };
  const origins = opts.origins ?? [];
  const member = opts.member ?? null;
  const openEntry = opts.openEntry ?? null;

  function builder(table: string) {
    const b: Record<string, unknown> = {
      select: () => b,
      eq: () => b,
      is: () => b,
      order: () => b,
      in: () => b,
      maybeSingle: () => {
        if (table === "businesses")
          return Promise.resolve({ data: { id: "biz1" }, error: null });
        if (table === "business_users")
          return Promise.resolve({ data: member, error: null });
        if (table === "clock_entries")
          return Promise.resolve({ data: openEntry, error: null });
        return Promise.resolve({ data: null, error: null });
      },
      single: () =>
        Promise.resolve({
          data: { clock_in: "2026-06-14T12:00:00.000Z" },
          error: null,
        }),
      // Awaitable directo (clock_allowed_origins: select().eq()).
      then: (resolve: (v: { data: unknown; error: null }) => void) =>
        resolve({
          data: table === "clock_allowed_origins" ? origins : [],
          error: null,
        }),
      insert: (row: Record<string, unknown>) => {
        if (table === "clock_blocked_attempts") {
          captured.blocked.push(row);
          return Promise.resolve({ error: null });
        }
        if (table === "clock_entries") {
          captured.entries.push(row);
          return b; // sigue con .select().single()
        }
        return Promise.resolve({ error: null });
      },
      update: () => ({ eq: () => Promise.resolve({ error: null }) }),
    };
    return b;
  }

  return { from: builder };
}

let currentClient = makeFakeService({});

vi.mock("@/lib/supabase/service", () => ({
  createSupabaseServiceClient: () => currentClient,
}));

// ── Techo de intentos por IP ───────────────────────────────────────────
// El limitador real vive en `@/lib/rate-limit` (Upstash). Acá lo controlamos a
// mano para poder probar el caso «budget agotado» sin Redis.
let limitOk = true;
const limitCalls: string[] = [];
vi.mock("@/lib/rate-limit", () => ({
  limitClockPunch: async (ip: string) => {
    limitCalls.push(ip);
    return { success: limitOk };
  },
}));

vi.mock("next/headers", () => ({
  headers: async () => ({
    get: (k: string) => (k === "x-forwarded-for" ? currentXff : null),
  }),
}));

const { clockPunch } = await import("./clock-actions");

const MEMBER: Member = {
  user_id: "u1",
  full_name: "Ana",
  disabled_at: null,
};

describe("clockPunch — enforcement de origen (spec 11)", () => {
  beforeEach(() => {
    currentXff = null;
    limitOk = true;
    limitCalls.length = 0;
  });

  it("PIN mal formado → error sin tocar la DB", async () => {
    currentClient = makeFakeService({});
    const r = await clockPunch("house", "12");
    expect(r.ok).toBe(false);
    expect(captured.entries).toHaveLength(0);
  });

  it("allowlist vacía → sin enforcement, ficha entrada (back-compat)", async () => {
    currentClient = makeFakeService({ origins: [], member: MEMBER, openEntry: null });
    currentXff = "200.51.23.7"; // IP pública, pero no hay allowlist
    const r = await clockPunch("house", "1234");
    expect(r.ok).toBe(true);
    expect(captured.entries).toHaveLength(1);
    expect(captured.blocked).toHaveLength(0);
  });

  it("origen dentro del CIDR → ficha entrada", async () => {
    currentClient = makeFakeService({
      origins: [{ cidr: "192.168.10.0/24" }],
      member: MEMBER,
      openEntry: null,
    });
    currentXff = "192.168.10.42";
    const r = await clockPunch("house", "1234");
    expect(r.ok).toBe(true);
    expect(captured.entries).toHaveLength(1);
    expect(captured.blocked).toHaveLength(0);
  });

  it("origen fuera del CIDR → rechaza, no crea clock_entry y loguea el intento", async () => {
    currentClient = makeFakeService({
      origins: [{ cidr: "192.168.10.0/24" }],
      member: MEMBER,
      openEntry: null,
    });
    currentXff = "200.51.23.7"; // celular fuera de la red
    const r = await clockPunch("house", "1234");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/computadoras del local/i);
    expect(captured.entries).toHaveLength(0);
    expect(captured.blocked).toHaveLength(1);
    // PIN enmascarado, nunca en claro.
    expect(captured.blocked[0].pin_masked).toBe("1**4");
    expect(captured.blocked[0].pin_masked).not.toBe("1234");
  });

  it("sin x-forwarded-for y con allowlist → rechaza (no se puede verificar origen)", async () => {
    currentClient = makeFakeService({
      origins: [{ cidr: "192.168.10.0/24" }],
      member: MEMBER,
      openEntry: null,
    });
    currentXff = null;
    const r = await clockPunch("house", "1234");
    expect(r.ok).toBe(false);
    expect(captured.blocked).toHaveLength(1);
    expect(captured.blocked[0].ip).toBe("unknown");
  });
});

// ── Enumeración de PINs ────────────────────────────────────────────────
// `/fichar` es un kiosco público: no pide sesión, y el PIN es la credencial.
// Sin techo de intentos, los 10.000 PINs de cuatro dígitos se barren desde
// internet — y cada acierto no es una lectura, es un fichaje real insertado en
// `clock_entries` a nombre de otro (horas que van a la liquidación).
describe("clockPunch — techo de intentos por IP", () => {
  beforeEach(() => {
    currentXff = "200.51.23.7";
    limitOk = true;
    limitCalls.length = 0;
  });

  it("consume el techo con la IP del que ficha, incluso sin allowlist", async () => {
    currentClient = makeFakeService({ origins: [], member: MEMBER, openEntry: null });
    const r = await clockPunch("house", "1234");
    expect(r.ok).toBe(true);
    expect(limitCalls).toEqual(["200.51.23.7"]);
  });

  it("techo agotado → no ficha, no revela si el PIN existe, y deja rastro", async () => {
    currentClient = makeFakeService({ origins: [], member: MEMBER, openEntry: null });
    limitOk = false;

    const r = await clockPunch("house", "1234");

    expect(r.ok).toBe(false);
    // El efecto que importa: NO hay fichaje nuevo.
    expect(captured.entries).toHaveLength(0);
    // Y el intento queda registrado — antes, sin allowlist cargada, barrer el
    // padrón entero no dejaba una sola fila en ningún lado.
    expect(captured.blocked).toHaveLength(1);
    expect(captured.blocked[0].reason).toBe("rate_limit");
    expect(captured.blocked[0].pin_masked).toBe("1**4");
  });

  it("PIN mal formado no consume el techo (no llega a la DB)", async () => {
    currentClient = makeFakeService({});
    const r = await clockPunch("house", "12");
    expect(r.ok).toBe(false);
    expect(limitCalls).toHaveLength(0);
  });
});
