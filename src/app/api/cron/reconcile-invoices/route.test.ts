import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "./route";

// El endpoint dispara un barrido que cierra comprobantes fiscales: la única
// barrera es el CRON_SECRET, así que su gate va con test propio.
const reconcilePendingInvoices = vi.fn();
vi.mock("@/lib/afip/reconcile", () => ({
  reconcilePendingInvoices: () => reconcilePendingInvoices(),
}));

const ORIGINAL = process.env.CRON_SECRET;

function req(auth?: string) {
  return new Request("http://localhost/api/cron/reconcile-invoices", {
    method: "POST",
    headers: auth ? { authorization: auth } : {},
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  reconcilePendingInvoices.mockResolvedValue({
    considered: 2,
    authorized: 1,
    failed: 1,
    stillPending: 0,
    stale: 0,
    skipped: 0,
    unknownJob: 0,
  });
});

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = ORIGINAL;
});

describe("POST /api/cron/reconcile-invoices", () => {
  it("sin CRON_SECRET configurado queda cerrado (fail-closed)", async () => {
    delete process.env.CRON_SECRET;

    const res = await POST(req("Bearer lo-que-sea"));

    expect(res.status).toBe(503);
    expect(reconcilePendingInvoices).not.toHaveBeenCalled();
  });

  it("rechaza un Bearer que no matchea", async () => {
    process.env.CRON_SECRET = "correcto";

    const res = await POST(req("Bearer incorrecto"));

    expect(res.status).toBe(401);
    expect(reconcilePendingInvoices).not.toHaveBeenCalled();
  });

  it("rechaza si no viene Authorization", async () => {
    process.env.CRON_SECRET = "correcto";

    const res = await POST(req());

    expect(res.status).toBe(401);
    expect(reconcilePendingInvoices).not.toHaveBeenCalled();
  });

  it("con el secreto correcto corre el barrido y devuelve los contadores", async () => {
    process.env.CRON_SECRET = "correcto";

    const res = await POST(req("Bearer correcto"));

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      ok: true,
      considered: 2,
      authorized: 1,
      failed: 1,
    });
    expect(reconcilePendingInvoices).toHaveBeenCalledTimes(1);
  });
});
