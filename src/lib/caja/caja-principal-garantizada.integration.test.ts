// @vitest-environment node
//
// issue #266 — un negocio siempre tiene una caja principal.
//
// De esa marca cuelgan las dos guardas del cierre (`cerrarCaja` las gatea con
// `caja.is_default` y se lo pasa a la RPC como `p_barrer_salon`), y nada
// garantizaba que existiera: `cajas_one_default_per_business` es un único
// PARCIAL —como mucho una, nunca al menos una—, `crearCaja` inserta sin la
// marca, el trigger de alta siembra sólo la Caja Mayor (administrativa) y
// `setCajaDefault` es manual.
//
// Un negocio nuevo operaba con las guardas apagadas hasta que alguien se
// acordara de marcarla. El cierre no chequeaba mesas abiertas, no exigía
// rendiciones, no barría el salón, y reportaba éxito.
//
// Fix: migración 0081 (trigger `caja_default_si_no_hay` + backfill).
import { afterAll, describe, expect, it } from "vitest";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local" });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const dbAvailable = Boolean(supabaseUrl && serviceKey);

const TAG = `test-cajadef-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

describe.skipIf(!dbAvailable)("cajas · siempre hay una principal", () => {
  const db = createClient(supabaseUrl!, serviceKey!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const creados: string[] = [];

  const nuevoNegocio = async (slug: string) => {
    const { data } = await db
      .from("businesses")
      .insert({ slug, name: slug, is_active: true })
      .select("id").single();
    creados.push(data!.id);
    return data!.id as string;
  };

  const cajas = async (bizId: string) => {
    const { data } = await db
      .from("cajas")
      .select("name, is_default, is_administrative")
      .eq("business_id", bizId)
      .order("sort_order");
    return data ?? [];
  };

  afterAll(async () => {
    for (const id of creados) await db.from("businesses").delete().eq("id", id);
  });

  it("la Caja Mayor que se siembra sola NO queda como principal", async () => {
    // Es administrativa: no cobra ni se arquea (spec 160). Si quedara marcada,
    // el cierre gatearía sobre una caja que nunca se cierra.
    const biz = await nuevoNegocio(`${TAG}-a`);
    const c = await cajas(biz);
    const mayor = c.find((x) => x.is_administrative);
    expect(mayor, "el trigger de alta siembra la Caja Mayor").toBeTruthy();
    expect(mayor!.is_default).toBe(false);
  });

  it("la primera caja de turno queda como principal, y sólo la primera", async () => {
    const biz = await nuevoNegocio(`${TAG}-b`);
    await db.from("cajas").insert([
      { business_id: biz, name: "Caja Principal", is_active: true, sort_order: 0, is_administrative: false },
    ]);
    await db.from("cajas").insert([
      { business_id: biz, name: "Caja Bar", is_active: true, sort_order: 1, is_administrative: false },
    ]);

    const c = await cajas(biz);
    const principales = c.filter((x) => x.is_default);
    expect(principales).toHaveLength(1);
    expect(principales[0]!.name).toBe("Caja Principal");
  });

  it("todo negocio con cajas de turno tiene exactamente una principal activa", async () => {
    // El invariante que sostiene las guardas del cierre, medido sobre TODO lo
    // que hay en la base — incluido el demo que sembró el seed.
    const { data } = await db
      .from("cajas")
      .select("business_id, is_default, is_active, is_administrative");
    const porNegocio = new Map<string, { turno: number; principal: number }>();
    for (const c of (data ?? []) as Array<{
      business_id: string;
      is_default: boolean;
      is_active: boolean;
      is_administrative: boolean;
    }>) {
      const e = porNegocio.get(c.business_id) ?? { turno: 0, principal: 0 };
      if (c.is_active && !c.is_administrative) e.turno++;
      if (c.is_default && c.is_active) e.principal++;
      porNegocio.set(c.business_id, e);
    }
    const rotos = [...porNegocio.entries()]
      .filter(([, e]) => e.turno > 0 && e.principal !== 1)
      .map(([id]) => id);
    expect(rotos, `negocios sin principal activa: ${rotos.join(", ")}`).toEqual([]);
  });
});
