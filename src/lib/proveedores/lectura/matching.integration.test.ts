// @vitest-environment node
import { describe, expect, it } from "vitest";
import { config } from "dotenv";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

config({ path: ".env.local" });

/**
 * Los umbrales del matcher — spec 172·D4.
 *
 * Esta es la red que sostiene el número. `0,62` de umbral y `0,15` de margen no
 * son elegidos: salen de correr estas líneas reales contra los 122 insumos del
 * catálogo y mirar dónde queda el hueco entre aciertos y falsos positivos.
 *
 * Importa porque un falso positivo acá **pisa
 * `ingredient_presentations.cost_cents` del insumo equivocado**, y eso se propaga
 * a todas las recetas que lo usan y al food cost — y anular la compra devuelve el
 * stock pero NO el precio (165·D4). El umbral está alto porque la segunda línea
 * de defensa no existe.
 *
 * Si alguien lo baja para «agarrar más», este archivo se pone rojo y le dice cuál
 * es el primero que se rompe.
 */
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

let db: SupabaseClient;
let businessId = "";

async function preparar(): Promise<boolean> {
  if (!supabaseUrl || !serviceKey) return false;
  db = createClient(supabaseUrl, serviceKey);
  const { data, error } = await db.from("businesses").select("id").eq("slug", "demo").single();
  if (error || !data) return false;
  businessId = data.id;
  // Sin la migración 0092 no hay nada que testear.
  const { error: rpcErr } = await db.rpc("proponer_insumos_para_lineas", {
    p_business_id: businessId,
    p_supplier_id: null,
    p_lineas: [],
  });
  return !rpcErr;
}

const ready = await preparar();

type Propuesta = { texto: string; ingredient_id: string | null; match_source: string | null };

async function proponer(lineas: string[]): Promise<Map<string, { nombre: string | null; fuente: string | null }>> {
  const { data } = await db.rpc("proponer_insumos_para_lineas", {
    p_business_id: businessId,
    p_supplier_id: null,
    p_lineas: lineas,
  });

  const ids = (data as Propuesta[]).map((p) => p.ingredient_id).filter(Boolean) as string[];
  const { data: insumos } = ids.length
    ? await db.from("ingredients").select("id, name").in("id", ids)
    : { data: [] };
  const nombres = new Map((insumos ?? []).map((i) => [i.id, i.name]));

  return new Map(
    (data as Propuesta[]).map((p) => [
      p.texto,
      { nombre: p.ingredient_id ? (nombres.get(p.ingredient_id) ?? null) : null, fuente: p.match_source },
    ]),
  );
}

describe.skipIf(!ready)("proponer_insumos_para_lineas · los umbrales medidos", () => {
  it("acierta las líneas que tienen respuesta en el catálogo", async () => {
    const esperado: Record<string, string> = {
      ENTRECOT: "Entrecot",
      NALGA: "Nalga",
      // Plural contra singular: el trigrama lo resuelve solo, sin stemmer.
      ENTRAÑAS: "Entraña",
      PECETOS: "Peceto",
      "CREMA DE LECHE x 1L": "Crema de leche",
      "LECHUGA MANTECOSA": "Lechuga",
      "Papa Lavada": "Papa",
      "HUEVOS ENTRE RIOS B1": "Huevos",
      "TOMATE PERITA CAJON 20K": "Tomate",
      "PECHUGA POLLO FRESCA": "Pechuga de pollo",
      // El caso que la 164·D2 dejó sin resolver, a 0,650 — el acierto más
      // ajustado de todos y la razón de que el umbral no pueda subir.
      "QUESO MUZZARELLA": "Muzarella",
    };

    const r = await proponer(Object.keys(esperado));
    for (const [linea, insumo] of Object.entries(esperado)) {
      expect(r.get(linea)?.nombre, linea).toBe(insumo);
    }
  });

  it("no elige el genérico corto que contiene el nombre", async () => {
    // `word_similarity` sola da 1,00 con «Calabaza», «Leche» y «Papa» — elegiría
    // el insumo equivocado Y más barato. El término `similarity` lo desarma.
    const r = await proponer(["SORRENTINOS DE CALABAZA", "PAN DE LOMO", "Ñoquis de papa"]);

    expect(r.get("SORRENTINOS DE CALABAZA")?.nombre).toBe("Sorrentinos de calabaza");
    expect(r.get("PAN DE LOMO")?.nombre).toBe("Pan de lomo");
    expect(r.get("Ñoquis de papa")?.nombre).toBe("Ñoquis de papa");
  });

  it("se abstiene antes que arriesgar un match que escribe plata", async () => {
    const seAbstiene = [
      // Su top-1 real es `Panko`, a 0,355. Escribiría el precio del pan rallado
      // sobre el panko.
      "PAN RALLADO x 5 KG",
      // Un corte de carne cuyo top-1 es `Pan de lomo`, a 0,327 y con margen 0.
      "Pickers Pulpa de Pal",
      // Es `Pechuga de pollo` y el trigrama no lo puede saber: no comparten un
      // solo token. Lo levanta el modelo o la memoria del proveedor.
      "FILET PECH. SURAVIC",
      "PATA MUSLO ENERCOOP",
      // Limpieza y reventa: no son insumos y no deben serlo.
      "Detergente Thames Bioultra",
      "Coca Cola Zero x 150",
    ];

    const r = await proponer(seAbstiene);
    for (const linea of seAbstiene) {
      expect(r.get(linea)?.nombre, linea).toBeNull();
      expect(r.get(linea)?.fuente, linea).toBeNull();
    }
  });

  it("el nombre exacto no pasa por el fuzzy", async () => {
    // No es una adivinanza: la cadena, sin mayúsculas ni acentos, ES el nombre.
    // Por eso llega tildado en la pantalla y el fuzzy no.
    const r = await proponer(["ENTRECOT", "entraña", "  Muzarella  "]);

    expect(r.get("ENTRECOT")?.fuente).toBe("exacto");
    expect(r.get("entraña")?.fuente).toBe("exacto");
    expect(r.get("  Muzarella  ")?.fuente).toBe("exacto");
  });

  it("la memoria del proveedor le gana al fuzzy", async () => {
    const { data: sup } = await db
      .from("suppliers")
      .insert({ business_id: businessId, name: `test-alias-${Date.now()}` })
      .select("id")
      .single();
    const { data: ing } = await db
      .from("ingredients")
      .select("id")
      .eq("business_id", businessId)
      .eq("name", "Pechuga de pollo")
      .single();

    await db.from("supplier_ingredient_aliases").insert({
      business_id: businessId,
      supplier_id: sup!.id,
      alias_norm: "filet pech suravic",
      alias_raw: "FILET PECH. SURAVIC",
      ingredient_id: ing!.id,
      origen: "manual",
    });

    const { data } = await db.rpc("proponer_insumos_para_lineas", {
      p_business_id: businessId,
      p_supplier_id: sup!.id,
      p_lineas: ["FILET PECH. SURAVIC"],
    });

    // La línea que el trigrama no puede resolver, resuelta por una confirmación
    // que ya hizo un humano sobre ESE texto y ESE proveedor.
    expect((data as Propuesta[])[0]?.ingredient_id).toBe(ing!.id);
    expect((data as Propuesta[])[0]?.match_source).toBe("memoria");

    await db.from("suppliers").delete().eq("id", sup!.id);
  });
});
