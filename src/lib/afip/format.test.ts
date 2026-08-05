import { describe, expect, it } from "vitest";

import { isDemorada } from "./format";

describe("isDemorada (spec 088)", () => {
  const now = new Date("2026-08-04T23:00:00Z").getTime();

  it("una pending recién emitida no está demorada", () => {
    expect(isDemorada("2026-08-04T22:55:00Z", now)).toBe(false);
  });

  it("pasados 10 minutos sí", () => {
    expect(isDemorada("2026-08-04T22:45:00Z", now)).toBe(true);
  });

  it("una fecha inválida no rompe la tabla", () => {
    expect(isDemorada("no-es-fecha", now)).toBe(false);
  });
});
