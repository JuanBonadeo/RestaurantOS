import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// ── Por qué este test fuerza TZ=UTC ────────────────────────────────────
// El corte del día del fichaje se armaba con `new Date("2026-09-08T00:00:00")`
// —un string SIN offset—, así que JS lo parseaba en la timezone del PROCESO.
// En la máquina de dev (America/Argentina, UTC-3) eso daba justo la medianoche
// AR y el bug quedaba tapado; en Vercel el proceso corre en UTC y la ventana de
// «hoy» arrancaba a las 21:00 del día anterior, comiéndose el pico de cena de
// anoche. Por eso el test corre en UTC: es el único entorno donde el bug se ve,
// y es el entorno de producción.
//
// Mismo problema, tres lugares más: el `from`/`to` del drill-down por día, el
// rango del mes y el agrupado por fecha (`clock_in.slice(0, 10)` = fecha UTC,
// que manda al día siguiente todo fichaje posterior a las 21:00 AR).

const AR = "America/Argentina/Buenos_Aires";

let originalTz: string | undefined;

beforeAll(() => {
  originalTz = process.env.TZ;
  process.env.TZ = "UTC";
});

afterAll(() => {
  process.env.TZ = originalTz;
});

// ── Fake del service client, con captura de filtros ────────────────────

type Filters = Record<string, string>;

let captured: { filters: Filters };

function makeFakeService(rows: {
  clockEntries?: Record<string, unknown>[];
  members?: Record<string, unknown>[];
}) {
  captured = { filters: {} };

  function builder(table: string) {
    const data =
      table === "clock_entries"
        ? (rows.clockEntries ?? [])
        : (rows.members ?? []);
    const b: Record<string, unknown> = {
      select: () => b,
      eq: () => b,
      is: () => b,
      in: () => b,
      not: () => b,
      order: () => b,
      limit: () => b,
      gte: (col: string, v: string) => {
        captured.filters[`gte:${col}`] = v;
        return b;
      },
      lte: (col: string, v: string) => {
        captured.filters[`lte:${col}`] = v;
        return b;
      },
      lt: (col: string, v: string) => {
        captured.filters[`lt:${col}`] = v;
        return b;
      },
      then: (resolve: (v: { data: unknown; error: null }) => void) =>
        resolve({ data, error: null }),
    };
    return b;
  }

  return { from: builder };
}

let currentClient = makeFakeService({});

vi.mock("@/lib/supabase/service", () => ({
  createSupabaseServiceClient: () => currentClient,
}));

const { getTodaySummary, getClockHistory, getMonthlyOverview } = await import(
  "./clock-queries"
);

/** Medianoche AR del día `d` (AR no tiene DST: siempre UTC-3). */
function medianocheAr(d: string): string {
  return `${d}T03:00:00.000Z`;
}

describe("cortes del día del fichaje en timezone AR (server en UTC)", () => {
  it("getTodaySummary arranca en la medianoche AR, no en la del proceso", async () => {
    currentClient = makeFakeService({ clockEntries: [], members: [] });

    await getTodaySummary("biz1", AR);

    const desde = captured.filters["gte:clock_in"];
    // Con el bug: 2026-09-08T00:00:00Z = 7/9 21:00 AR → entraban como «hoy»
    // los fichajes de la cena de anoche.
    const hoyAr = new Intl.DateTimeFormat("en-CA", {
      timeZone: AR,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
    expect(desde).toBe(medianocheAr(hoyAr));
  });

  it("getClockHistory interpreta un from/to sin offset como hora AR", async () => {
    currentClient = makeFakeService({ clockEntries: [] });

    await getClockHistory("biz1", {
      from: "2026-09-08T00:00:00",
      to: "2026-09-08T23:59:59",
    });

    expect(captured.filters["gte:clock_in"]).toBe("2026-09-08T03:00:00.000Z");
    expect(captured.filters["lte:clock_in"]).toBe("2026-09-09T02:59:59.000Z");
  });

  it("getClockHistory respeta un from/to que ya trae offset", async () => {
    currentClient = makeFakeService({ clockEntries: [] });

    await getClockHistory("biz1", {
      from: "2026-09-08T03:00:00.000Z",
      to: "2026-09-09T02:59:59.000Z",
    });

    expect(captured.filters["gte:clock_in"]).toBe("2026-09-08T03:00:00.000Z");
    expect(captured.filters["lte:clock_in"]).toBe("2026-09-09T02:59:59.000Z");
  });

  it("getMonthlyOverview toma el mes calendario AR completo", async () => {
    currentClient = makeFakeService({ clockEntries: [] });

    // Como lo arma la página de RRHH: la medianoche AR del 1° de septiembre.
    await getMonthlyOverview("biz1", new Date("2026-09-01T03:00:00.000Z"));

    expect(captured.filters["gte:clock_in"]).toBe("2026-09-01T03:00:00.000Z");
    expect(captured.filters["lt:clock_in"]).toBe("2026-10-01T03:00:00.000Z");
  });

  it("agrupa las horas por el día AR del fichaje, no por la fecha UTC", async () => {
    // Un turno que arranca 22:00 AR del 8 = 01:00Z del 9. Con el agrupado por
    // fecha UTC (`slice(0, 10)`) las 5 horas se le atribuían al día 9.
    currentClient = makeFakeService({
      clockEntries: [
        {
          user_id: "u1",
          clock_in: "2026-09-09T01:00:00+00:00",
          clock_out: "2026-09-09T06:00:00+00:00",
          duration_minutes: 300,
        },
      ],
      members: [{ user_id: "u1", full_name: "Ana", role: "mozo" }],
    });

    const overview = await getMonthlyOverview(
      "biz1",
      new Date("2026-09-01T03:00:00.000Z"),
    );

    expect(overview.dailyTotals).toHaveLength(1);
    expect(overview.dailyTotals[0].date).toBe("2026-09-08");
    expect(overview.dailyTotals[0].totalMinutes).toBe(300);
  });
});

describe("parseMonthStart — el mes del panel de RRHH", () => {
  it("«2026-09» arranca en la medianoche AR del 1°, no en la del proceso", async () => {
    const { parseMonthStart } = await import("./clock-queries");
    // Con `new Date(y, m - 1, 1)` en un server UTC esto daba
    // 2026-09-01T00:00:00Z = 31/8 21:00 AR: el mes empezaba en agosto.
    expect(parseMonthStart("2026-09", AR).toISOString()).toBe(
      "2026-09-01T03:00:00.000Z",
    );
  });

  it("sin mes en la URL cae en el mes corriente del local", async () => {
    const { parseMonthStart, monthKey } = await import("./clock-queries");
    const mesAr = new Intl.DateTimeFormat("en-CA", {
      timeZone: AR,
      year: "numeric",
      month: "2-digit",
    })
      .format(new Date())
      .slice(0, 7);
    expect(monthKey(parseMonthStart(undefined, AR), AR)).toBe(mesAr);
  });

  it("un mes basura no rompe: cae en el mes corriente", async () => {
    const { parseMonthStart } = await import("./clock-queries");
    expect(parseMonthStart("no-es-un-mes", AR).getUTCDate()).toBe(1);
  });
});
