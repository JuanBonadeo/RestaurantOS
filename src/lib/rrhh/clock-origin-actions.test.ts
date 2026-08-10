import { beforeEach, describe, expect, it, vi } from "vitest";

import type { BusinessRole } from "@/lib/admin/context";

// ── Fakes: tenant, auth context y service client ────────────────────────
// Cubre el gate de permisos (sólo admin) + validación de CIDR + scope.

let currentRole: BusinessRole | null = "admin";
let isPlatform = false;

let captured: {
  inserts: Record<string, unknown>[];
  deletes: { id: string; business_id: string }[];
};

function resetCaptured() {
  captured = { inserts: [], deletes: [] };
}

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

vi.mock("@/lib/tenant", () => ({
  getBusiness: async (slug: string) => ({ id: "biz1", slug }),
}));

vi.mock("@/lib/admin/context", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/admin/context")>();
  return {
    ...actual,
    ensureAdminAccess: async () => ({
      userId: "u1",
      userEmail: "a@b.com",
      isPlatformAdmin: isPlatform,
      role: currentRole,
    }),
  };
});

vi.mock("@/lib/supabase/service", () => ({
  createSupabaseServiceClient: () => ({
    from: () => ({
      insert: (row: Record<string, unknown>) => {
        captured.inserts.push(row);
        return Promise.resolve({ error: null });
      },
      delete: () => {
        const eqState: { id?: string; business_id?: string } = {};
        const chain = {
          eq: (col: string, val: string) => {
            if (col === "id") eqState.id = val;
            if (col === "business_id") eqState.business_id = val;
            if (eqState.id && eqState.business_id) {
              captured.deletes.push({
                id: eqState.id,
                business_id: eqState.business_id,
              });
              return Promise.resolve({ error: null });
            }
            return chain;
          },
        };
        return chain;
      },
    }),
  }),
}));

const { addClockOrigin, removeClockOrigin } = await import(
  "./clock-origin-actions"
);

describe("addClockOrigin", () => {
  beforeEach(() => {
    resetCaptured();
    currentRole = "admin";
    isPlatform = false;
  });

  it("admin con CIDR válido → inserta scopeado al negocio", async () => {
    const r = await addClockOrigin({ slug: "house", cidr: "192.168.10.0/24", label: "Caja" });
    expect(r.ok).toBe(true);
    expect(captured.inserts).toHaveLength(1);
    expect(captured.inserts[0]).toMatchObject({
      business_id: "biz1",
      cidr: "192.168.10.0/24",
      label: "Caja",
      created_by: "u1",
    });
  });

  it("encargado → error de permiso, no inserta", async () => {
    currentRole = "encargado";
    const r = await addClockOrigin({ slug: "house", cidr: "192.168.10.0/24" });
    expect(r.ok).toBe(false);
    expect(captured.inserts).toHaveLength(0);
  });

  it("mozo → error de permiso, no inserta", async () => {
    currentRole = "mozo";
    const r = await addClockOrigin({ slug: "house", cidr: "192.168.10.0/24" });
    expect(r.ok).toBe(false);
    expect(captured.inserts).toHaveLength(0);
  });

  it("CIDR inválido → error, no inserta", async () => {
    const r = await addClockOrigin({ slug: "house", cidr: "192.168.10.0/33" });
    expect(r.ok).toBe(false);
    expect(captured.inserts).toHaveLength(0);
  });

  it("platform admin (role null) → permitido", async () => {
    currentRole = null;
    isPlatform = true;
    const r = await addClockOrigin({ slug: "house", cidr: "10.0.0.0/8" });
    expect(r.ok).toBe(true);
    expect(captured.inserts).toHaveLength(1);
  });
});

describe("removeClockOrigin", () => {
  beforeEach(() => {
    resetCaptured();
    currentRole = "admin";
    isPlatform = false;
  });

  it("admin → borra scopeado por id + business_id", async () => {
    const r = await removeClockOrigin({ slug: "house", id: "o1" });
    expect(r.ok).toBe(true);
    expect(captured.deletes).toEqual([{ id: "o1", business_id: "biz1" }]);
  });

  it("encargado → error, no borra", async () => {
    currentRole = "encargado";
    const r = await removeClockOrigin({ slug: "house", id: "o1" });
    expect(r.ok).toBe(false);
    expect(captured.deletes).toHaveLength(0);
  });
});
