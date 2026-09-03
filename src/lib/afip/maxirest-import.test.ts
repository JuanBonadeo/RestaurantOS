import { describe, expect, it } from "vitest";

import {
  condicionIvaDesdeTipoIva,
  domicilioDe,
  planificarImport,
  razonSocialDe,
  type MxcliRow,
} from "./maxirest-import";

// Spec 152 (#228) — el mapeo de `mxcli` a `fiscal_entities`.
//
// Es lógica de datos fiscales: lo que salga de acá termina impreso en un
// comprobante. Por eso va con test antes que script, y no con «lo corrí y
// parece que anduvo».

function row(over: Partial<MxcliRow> = {}): MxcliRow {
  return {
    codigo: "1",
    nombre: "",
    apellido: "",
    razon: "",
    cuit: "",
    tipo_iva: "2",
    calle: "",
    altura: "",
    localidad: "",
    provincia: "",
    cod_postal: "",
    telefono: "",
    celular: "",
    e_mail: "",
    ...over,
  };
}

describe("razonSocialDe", () => {
  it("usa la razón social cuando está", () => {
    expect(razonSocialDe(row({ razon: "  JOCKEY CLUB DE ROSARIO " }))).toBe(
      "JOCKEY CLUB DE ROSARIO",
    );
  });

  it("sin razón social cae a «APELLIDO, NOMBRE» (D3)", () => {
    // 138 de los 410 con CUIT de Golf entran por acá: son personas físicas con
    // CUIT, cargadas por nombre y no por razón social.
    expect(razonSocialDe(row({ apellido: "HOURCADE", nombre: "JUAN LUIS" }))).toBe(
      "HOURCADE, JUAN LUIS",
    );
  });

  it("con apellido solo, no inventa la coma", () => {
    expect(razonSocialDe(row({ apellido: "SUEIRAS MUNUCE" }))).toBe(
      "SUEIRAS MUNUCE",
    );
  });

  it("con nombre solo, alcanza", () => {
    expect(razonSocialDe(row({ nombre: "FEDERACION SANTAFESINA DE" }))).toBe(
      "FEDERACION SANTAFESINA DE",
    );
  });

  it("cuando nombre y apellido son lo mismo, no lo repite", () => {
    // 24 de las 138 que entran por el fallback: el usuario de MaxiRest escribió
    // la empresa en los dos campos. Sin esto quedaban como
    // "TANONI HNOS SA, TANONI HNOS SA".
    expect(
      razonSocialDe(row({ apellido: "TANONI HNOS SA", nombre: "TANONI HNOS SA" })),
    ).toBe("TANONI HNOS SA");
  });

  it("cuando uno contiene al otro, se queda con el más completo", () => {
    expect(
      razonSocialDe(row({ apellido: "DE CAPUA", nombre: "DE CAPUA CESAR ARIEL" })),
    ).toBe("DE CAPUA CESAR ARIEL");
    expect(
      razonSocialDe(row({ apellido: "JULIO MALAMUD", nombre: "MALAMUD" })),
    ).toBe("JULIO MALAMUD");
  });

  it("sin nada devuelve null — no se inventa un nombre desde el CUIT", () => {
    // Una fila sin nombre no se puede reconocer en la lista, y el CHECK de la
    // tabla (`length(trim(razon_social)) > 0`) la rebotaría igual.
    expect(razonSocialDe(row({ cuit: "30-56162862-5" }))).toBeNull();
  });
});

describe("condicionIvaDesdeTipoIva", () => {
  // ⚠️ Los códigos de MaxiRest NO son los de ARCA. Allá el `1` es justamente el
  // que NO tiene CUIT. Copiar el número declararía Responsable Inscripto a un
  // consumidor final.
  it("2 (MaxiRest) es Responsable Inscripto = 1 (ARCA)", () => {
    expect(condicionIvaDesdeTipoIva("2")).toBe(1);
  });

  it("6 (MaxiRest) es Exento = 4 (ARCA), NO Monotributo", () => {
    // Los 11 de Golf son clubes, federaciones, mutuales y fundaciones (CUIT
    // 30/33, ni una persona física) y en 189.380 comprobantes NO recibieron ni
    // una Factura A. Un monotributista sí puede recibirla.
    expect(condicionIvaDesdeTipoIva("6")).toBe(4);
  });

  it("1 (MaxiRest) es Consumidor Final = 5 (ARCA)", () => {
    expect(condicionIvaDesdeTipoIva("1")).toBe(5);
  });

  it("un código que no conocemos no se adivina", () => {
    expect(condicionIvaDesdeTipoIva("9")).toBeNull();
    expect(condicionIvaDesdeTipoIva("")).toBeNull();
  });
});

describe("domicilioDe", () => {
  it("junta calle y altura", () => {
    expect(domicilioDe(row({ calle: "Av. Pellegrini", altura: "1234" }))).toBe(
      "Av. Pellegrini 1234",
    );
  });

  it("sin altura, la calle sola", () => {
    expect(domicilioDe(row({ calle: "Bv. Oroño" }))).toBe("Bv. Oroño");
  });

  it("sin calle no hay domicilio", () => {
    expect(domicilioDe(row({ altura: "1234" }))).toBeNull();
  });
});

describe("planificarImport", () => {
  it("entra sólo quien tiene CUIT de 11 dígitos (D2)", () => {
    const plan = planificarImport([
      row({ codigo: "10", cuit: "30-50023730-5", razon: "JOCKEY CLUB" }),
      row({ codigo: "11", cuit: "", nombre: "JUAN", apellido: "PEREZ" }),
      row({ codigo: "12", cuit: "305002", razon: "A MEDIO TIPEAR" }),
    ]);

    expect(plan.entidades).toHaveLength(1);
    expect(plan.entidades[0]).toMatchObject({
      cuit: "30500237305",
      razon_social: "JOCKEY CLUB",
      external_ref: "10",
    });
    // El que no tiene CUIT no es un receptor: es un comensal. No se reporta como
    // problema, simplemente no es de esta tabla.
    expect(plan.sinCuit).toBe(1);
    // El CUIT a medio tipear SÍ se reporta: alguien quiso cargarlo.
    expect(plan.descartadas).toEqual([
      { codigo: "12", cuit: "305002", motivo: "CUIT inválido (no son 11 dígitos)" },
    ]);
  });

  it("el CUIT se guarda normalizado, sin guiones", () => {
    const plan = planificarImport([
      row({ cuit: "30-50023730-5", razon: "JOCKEY CLUB" }),
    ]);
    expect(plan.entidades[0].cuit).toBe("30500237305");
  });

  it("deduplica por CUIT y gana la razón social propia sobre el nombre (D4)", () => {
    const plan = planificarImport([
      // El fallback del D3 le daría "LAGOS, EDUARDO", pero la otra fila tiene
      // razón social cargada de verdad: esa manda.
      row({ codigo: "9", cuit: "20-14081198-0", apellido: "LAGOS", nombre: "EDUARDO" }),
      row({ codigo: "5", cuit: "20-14081198-0", razon: "EDUARDO LUIS LAGOS" }),
    ]);

    expect(plan.entidades).toHaveLength(1);
    expect(plan.entidades[0]).toMatchObject({
      razon_social: "EDUARDO LUIS LAGOS",
      external_ref: "5",
    });
    expect(plan.duplicadas).toEqual([
      {
        codigo: "9",
        cuit: "20140811980",
        motivo: "CUIT duplicado — se importó el código 5",
      },
    ]);
  });

  it("la fila sin nombre se descarta por eso, y su CUIT entra igual por la gemela", () => {
    // Es el caso real del código 1178 de Golf: sin razón social, nombre ni
    // apellido, pero con el mismo CUIT que el 1193, que sí lo tiene. El motivo
    // que se reporta es el verdadero —le falta el nombre— y el CUIT no se
    // pierde: entra por la otra fila.
    const plan = planificarImport([
      row({ codigo: "1178", cuit: "30-56162862-5" }),
      row({ codigo: "1193", cuit: "30-56162862-5", razon: "SANATORIO NEUROPATICO S. R. L." }),
    ]);

    expect(plan.entidades).toHaveLength(1);
    expect(plan.entidades[0]).toMatchObject({
      razon_social: "SANATORIO NEUROPATICO S. R. L.",
      external_ref: "1193",
    });
    expect(plan.descartadas).toEqual([
      {
        codigo: "1178",
        cuit: "30561628625",
        motivo: "sin razón social, nombre ni apellido",
      },
    ]);
    expect(plan.duplicadas).toEqual([]);
  });

  it("si las dos tienen razón social, gana el código más bajo — y es determinista", () => {
    const filas = [
      row({ codigo: "712", cuit: "30-50023730-5", razon: "JOCKEY CLUB DE ROSARIO" }),
      row({ codigo: "1", cuit: "30-50023730-5", razon: "JOCKEY CLUB DE ROSARIO" }),
    ];
    expect(planificarImport(filas).entidades[0].external_ref).toBe("1");
    // El orden en que vengan las filas no puede cambiar el resultado.
    expect(planificarImport([...filas].reverse()).entidades[0].external_ref).toBe("1");
  });

  it("una razón social distinta en el duplicado se reporta, no se pierde en silencio", () => {
    // Son 10 casos en Golf: casi todos la misma empresa escrita de dos formas
    // ("VALOR AGREGADO S.R.L." vs "VALOR AGREGADO SRL"). Elegir por nosotros
    // está bien; hacerlo sin decirlo, no.
    const plan = planificarImport([
      row({ codigo: "5", cuit: "30-71106880-1", razon: "VALOR AGREGADO S.R.L." }),
      row({ codigo: "9", cuit: "30-71106880-1", razon: "VALOR AGREGADO SRL" }),
    ]);
    expect(plan.entidades).toHaveLength(1);
    expect(plan.conflictos).toEqual([
      {
        cuit: "30711068801",
        importada: "VALOR AGREGADO S.R.L.",
        descartadas: ["VALOR AGREGADO SRL"],
      },
    ]);
  });

  it("sin razón social ni nombre, se descarta y se reporta (D3)", () => {
    const plan = planificarImport([row({ codigo: "1178", cuit: "30-56162862-5" })]);
    expect(plan.entidades).toHaveLength(0);
    expect(plan.descartadas).toEqual([
      {
        codigo: "1178",
        cuit: "30561628625",
        motivo: "sin razón social, nombre ni apellido",
      },
    ]);
  });

  it("un tipo_iva desconocido no se adivina: se descarta y se reporta", () => {
    const plan = planificarImport([
      row({ codigo: "77", cuit: "30-50023730-5", razon: "ALGO SA", tipo_iva: "9" }),
    ]);
    expect(plan.entidades).toHaveLength(0);
    expect(plan.descartadas[0].motivo).toContain("tipo_iva");
  });

  it("no marca para revisar una fila que perdió la deduplicación", () => {
    // Si la fila que entró es otra, avisar sobre la descartada es ruido: manda
    // la condición de la que quedó guardada.
    const plan = planificarImport([
      row({ codigo: "2362", cuit: "27-32251304-1", apellido: "SUEIRAS MUNUCE", tipo_iva: "1" }),
      row({ codigo: "9", cuit: "27-32251304-1", razon: "SUEIRAS, INES", tipo_iva: "2" }),
    ]);
    expect(plan.entidades[0]).toMatchObject({
      razon_social: "SUEIRAS, INES",
      condicion_iva: 1,
    });
    expect(plan.aRevisar).toEqual([]);
  });

  it("un consumidor final CON CUIT entra, pero queda marcado para revisar", () => {
    // Son 3 en Golf. El CUIT es la evidencia dura (alguien tipeó 11 dígitos a
    // propósito); que MaxiRest lo tenga como consumidor final es contradictorio,
    // así que entra con lo que dice el origen y se lista para mirarlo.
    const plan = planificarImport([
      row({ codigo: "2362", cuit: "27-32251304-1", apellido: "SUEIRAS MUNUCE", tipo_iva: "1" }),
    ]);
    expect(plan.entidades[0].condicion_iva).toBe(5);
    expect(plan.aRevisar).toEqual([
      {
        codigo: "2362",
        cuit: "27322513041",
        nota: "MaxiRest lo tiene como consumidor final pero tiene CUIT",
      },
    ]);
  });

  it("el contacto es opcional y el vacío va como null, no como cadena vacía", () => {
    const plan = planificarImport([
      row({ cuit: "30-50023730-5", razon: "JOCKEY CLUB", calle: "  ", e_mail: "" }),
    ]);
    expect(plan.entidades[0]).toMatchObject({
      domicilio: null,
      localidad: null,
      provincia: null,
      cod_postal: null,
      email: null,
      phone: null,
    });
  });

  it("trae el teléfono cuando está, y el celular si no hay fijo", () => {
    const conFijo = planificarImport([
      row({ cuit: "30-50023730-5", razon: "A", telefono: "341-4260000", celular: "341-5550000" }),
    ]);
    expect(conFijo.entidades[0].phone).toBe("341-4260000");

    const soloCel = planificarImport([
      row({ cuit: "30-50023730-5", razon: "A", celular: "341-5550000" }),
    ]);
    expect(soloCel.entidades[0].phone).toBe("341-5550000");
  });
});
