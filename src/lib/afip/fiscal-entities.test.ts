import { beforeEach, describe, expect, it } from "vitest";

import {
  buscarEntidades,
  buscarEntidadPorCuit,
  resolverEntidadParaFactura,
  type FiscalEntity,
} from "./fiscal-entities";

// Spec 150 (#226) — a quién se le emite el comprobante.
//
// Lo que se fija acá es el D4: **un CUIT que ya existe no se pisa**. Es lógica
// de plata: la entidad equivocada no se corrige con un undo, se arrastra a
// todas las facturas siguientes de ese cliente. Y el escenario 5, que es el que
// rompe solo: el CUIT se tipea con guiones y en la base vive sin.

const SANATORIO: FiscalEntity = {
  id: "fe-1",
  business_id: "biz-1",
  cuit: "30500237305",
  razon_social: "SANATORIO PARQUE SA",
  condicion_iva: 1,
  domicilio: null,
  localidad: null,
  provincia: null,
  cod_postal: null,
  email: null,
  phone: null,
  customer_id: null,
  external_ref: null,
  created_at: "2026-09-03T00:00:00Z",
  updated_at: "2026-09-03T00:00:00Z",
};

const UNIQUE_VIOLATION = "23505";

type FakeOpts = {
  rows?: FiscalEntity[];
  /** Simula que otra transacción insertó la misma fila entre el select y el
   *  insert: el unique (business_id, cuit) la rebota. */
  raceRow?: FiscalEntity;
};

/** Service client de mentira sobre una `fiscal_entities` en memoria. */
function fakeService(opts: FakeOpts = {}) {
  const state = {
    rows: [...(opts.rows ?? [])],
    inserts: [] as Record<string, unknown>[],
  };
  let raced = false;

  const service = {
    from(table: string) {
      if (table !== "fiscal_entities") {
        throw new Error(`tabla inesperada: ${table}`);
      }
      const eqs: Record<string, string> = {};
      let orClause: string | null = null;
      let pending: Record<string, unknown> | null = null;

      const matches = () =>
        state.rows.filter((row) => {
          const r = row as unknown as Record<string, unknown>;
          for (const [col, val] of Object.entries(eqs)) {
            if (r[col] !== val) return false;
          }
          if (orClause) {
            // `razon_social.ilike.*term*,cuit.ilike.*digits*`
            return orClause.split(",").some((clause) => {
              const [col, , pattern] = clause.split(".");
              const needle = (pattern ?? "").replace(/\*/g, "").toLowerCase();
              return String(r[col] ?? "")
                .toLowerCase()
                .includes(needle);
            });
          }
          return true;
        });

      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: (col: string, val: string) => {
          eqs[col] = val;
          return chain;
        },
        or: (clause: string) => {
          orClause = clause;
          return chain;
        },
        order: () => chain,
        limit: (n: number) =>
          Promise.resolve({ data: matches().slice(0, n), error: null }),
        maybeSingle: () =>
          Promise.resolve({ data: matches()[0] ?? null, error: null }),
        insert: (row: Record<string, unknown>) => {
          pending = row;
          return chain;
        },
        single: () => {
          if (!pending) {
            return Promise.resolve({ data: matches()[0] ?? null, error: null });
          }
          state.inserts.push(pending);
          if (opts.raceRow && !raced) {
            raced = true;
            state.rows.push(opts.raceRow);
            return Promise.resolve({
              data: null,
              error: { code: UNIQUE_VIOLATION, message: "duplicate key" },
            });
          }
          const created = { ...SANATORIO, ...pending, id: "fe-nueva" };
          state.rows.push(created as unknown as FiscalEntity);
          return Promise.resolve({ data: created, error: null });
        },
      };
      return chain;
    },
  };

  return { service: service as never, state };
}

let fake: ReturnType<typeof fakeService>;

beforeEach(() => {
  fake = fakeService({ rows: [SANATORIO] });
});

describe("resolverEntidadParaFactura", () => {
  it("un CUIT que no está cargado crea la entidad (escenario 4)", async () => {
    const entidad = await resolverEntidadParaFactura({
      service: fake.service,
      businessId: "biz-1",
      cuit: "30-71234567-8",
      razonSocial: "  Club de Campo SRL  ",
      condicionIva: 6,
    });

    expect(entidad?.id).toBe("fe-nueva");
    expect(fake.state.inserts).toHaveLength(1);
    expect(fake.state.inserts[0]).toMatchObject({
      business_id: "biz-1",
      // Se guarda normalizado: el CHECK de la tabla exige 11 dígitos.
      cuit: "30712345678",
      razon_social: "Club de Campo SRL",
      condicion_iva: 6,
    });
  });

  it("un CUIT que ya existe NO se pisa con lo que se tipeó (D4)", async () => {
    const entidad = await resolverEntidadParaFactura({
      service: fake.service,
      businessId: "biz-1",
      cuit: "30500237305",
      razonSocial: "SANATORIO PARKE SA", // el error de tipeo del apuro
      condicionIva: 6,
    });

    expect(entidad).toEqual(SANATORIO);
    expect(entidad?.razon_social).toBe("SANATORIO PARQUE SA");
    expect(entidad?.condicion_iva).toBe(1);
    expect(fake.state.inserts).toHaveLength(0);
  });

  it("el CUIT tipeado con guiones matchea la entidad guardada (escenario 5)", async () => {
    const entidad = await resolverEntidadParaFactura({
      service: fake.service,
      businessId: "biz-1",
      cuit: "30-50023730-5",
      razonSocial: "SANATORIO PARQUE SA",
      condicionIva: 1,
    });

    expect(entidad?.id).toBe("fe-1");
    expect(fake.state.inserts).toHaveLength(0);
  });

  it("no crea nada si el CUIT no tiene 11 dígitos", async () => {
    const entidad = await resolverEntidadParaFactura({
      service: fake.service,
      businessId: "biz-1",
      cuit: "3050023",
      razonSocial: "A medio tipear SA",
      condicionIva: 1,
    });

    expect(entidad).toBeNull();
    expect(fake.state.inserts).toHaveLength(0);
  });

  it("sin razón social no inventa una entidad", async () => {
    // Una fila sin nombre no se puede buscar ni reconocer en la lista, y el
    // `check (length(trim(razon_social)) > 0)` la rebotaría igual.
    const entidad = await resolverEntidadParaFactura({
      service: fake.service,
      businessId: "biz-1",
      cuit: "30712345678",
      razonSocial: "   ",
      condicionIva: 1,
    });

    expect(entidad).toBeNull();
    expect(fake.state.inserts).toHaveLength(0);
  });

  it("si otra emisión ganó la carrera, devuelve la que quedó guardada", async () => {
    const ganadora: FiscalEntity = {
      ...SANATORIO,
      id: "fe-ganadora",
      cuit: "30712345678",
      razon_social: "Club de Campo SRL",
    };
    const race = fakeService({ rows: [], raceRow: ganadora });

    const entidad = await resolverEntidadParaFactura({
      service: race.service,
      businessId: "biz-1",
      cuit: "30712345678",
      razonSocial: "Club de Campo SRL",
      condicionIva: 1,
    });

    expect(entidad?.id).toBe("fe-ganadora");
  });
});

describe("buscarEntidadPorCuit", () => {
  it("normaliza antes de la query", async () => {
    const entidad = await buscarEntidadPorCuit(
      fake.service,
      "biz-1",
      "30-50023730-5",
    );
    expect(entidad?.id).toBe("fe-1");
  });

  it("un CUIT incompleto no busca", async () => {
    expect(await buscarEntidadPorCuit(fake.service, "biz-1", "305")).toBeNull();
  });
});

describe("buscarEntidades", () => {
  it("encuentra por razón social", async () => {
    const rows = await buscarEntidades(fake.service, "biz-1", "sanatorio");
    expect(rows.map((r) => r.id)).toEqual(["fe-1"]);
  });

  it("encuentra por CUIT tipeado con guiones (escenario 5)", async () => {
    const rows = await buscarEntidades(fake.service, "biz-1", "30-50023730");
    expect(rows.map((r) => r.id)).toEqual(["fe-1"]);
  });

  it("un término demasiado corto no devuelve la tabla entera", async () => {
    expect(await buscarEntidades(fake.service, "biz-1", "s")).toEqual([]);
  });
});
