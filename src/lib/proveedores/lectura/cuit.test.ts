import { describe, expect, it } from "vitest";

import {
  cuitValido,
  formatearCuit,
  normalizarCuit,
} from "@/lib/proveedores/lectura/cuit";

describe("normalizarCuit", () => {
  it("saca los separadores que imprime el papel", () => {
    expect(normalizarCuit("30-68469261-1")).toBe("30684692611");
    expect(normalizarCuit("30684692611")).toBe("30684692611");
    expect(normalizarCuit("30.68469261.1")).toBe("30684692611");
    expect(normalizarCuit("  30-68469261-1  ")).toBe("30684692611");
  });

  it("saca la etiqueta que el modelo se trae del renglón", () => {
    // El campo `proveedor_cuit` casi nunca viene pelado: viene con lo que estaba
    // impreso al lado.
    expect(normalizarCuit("CUIT: 30-68469261-1")).toBe("30684692611");
    expect(normalizarCuit("C.U.I.T. 30 68469261 1")).toBe("30684692611");
    expect(normalizarCuit("C.U.I.T. Nº 30-68469261-1")).toBe("30684692611");
  });

  it("devuelve null si no hay exactamente once dígitos", () => {
    // Diez dígitos no es «un CUIT incompleto»: es un CUIT mal leído, y mandarlo
    // al RPC de proveedor no encuentra nada o encuentra a otro.
    expect(normalizarCuit("3068469261")).toBeNull();
    expect(normalizarCuit("30-6846926-1")).toBeNull();
    expect(normalizarCuit("306846926110")).toBeNull();
    expect(normalizarCuit("30-68469261-10")).toBeNull();
  });

  it("devuelve null cuando no hay nada que leer", () => {
    expect(normalizarCuit(null)).toBeNull();
    expect(normalizarCuit(undefined)).toBeNull();
    expect(normalizarCuit("")).toBeNull();
    expect(normalizarCuit("   ")).toBeNull();
    expect(normalizarCuit("s/d")).toBeNull();
    expect(normalizarCuit("—")).toBeNull();
  });

  it("rescata el CUIT cuando el campo trae además otro número", () => {
    // El clásico del membrete: CUIT e Ingresos Brutos en el mismo renglón. Se
    // busca la FORMA del CUIT (2-8-1) en vez de rendirse por contar dígitos.
    expect(normalizarCuit("CUIT 30-68469261-1 IIBB 901-123456-7")).toBe("30684692611");
  });

  it("normaliza aunque el verificador esté mal — son dos preguntas distintas", () => {
    // Se devuelve el número para poder mostrarlo y que la persona lo corrija;
    // quien decide si sirve para buscar es `cuitValido`.
    expect(normalizarCuit("30-68469261-2")).toBe("30684692612");
  });
});

describe("cuitValido · módulo 11", () => {
  it("acepta los CUIT bien formados", () => {
    expect(cuitValido("30684692611")).toBe(true);
    // El de ARCA, para tener un testigo verificable fuera de este repo.
    expect(cuitValido("33693450239")).toBe(true);
  });

  it("rechaza el verificador cambiado", () => {
    // Es exactamente el error que buscamos: un dígito que se leyó mal en la foto.
    expect(cuitValido("30684692612")).toBe(false);
    expect(cuitValido("30684692610")).toBe(false);
    expect(cuitValido("33693450230")).toBe(false);
  });

  it("resuelve la rama del cálculo que da 11 ⇒ verificador 0", () => {
    expect(cuitValido("30100000020")).toBe(true);
    expect(cuitValido("30100000021")).toBe(false);
  });

  it("resuelve la rama del cálculo que da 10 ⇒ verificador 9", () => {
    // Cuando el cálculo da 10 no hay dígito posible con prefijo 20/27, así que
    // ARCA le cambia el prefijo a la persona física (20→23, 27→24) y el
    // verificador queda 9. El CUIT que la persona tiene de verdad —con el 23—
    // cierra por el camino normal…
    expect(cuitValido("23100000059")).toBe(true);
    // …y el 20 con verificador 9 lo aceptamos igual: acá se valida un papel
    // escaneado, no el padrón, y rechazarlo nos deja sin la pista del CUIT.
    expect(cuitValido("20100000059")).toBe(true);
    expect(cuitValido("20100000051")).toBe(false);
  });

  it("rechaza lo que no sean once dígitos", () => {
    expect(cuitValido("")).toBe(false);
    expect(cuitValido("3068469261")).toBe(false);
    expect(cuitValido("306846926110")).toBe(false);
    expect(cuitValido("30-68469261-1")).toBe(false);
  });
});

describe("formatearCuit", () => {
  it("arma el formato de pantalla", () => {
    expect(formatearCuit("30684692611")).toBe("30-68469261-1");
  });

  it("deja pasar lo que no tenga once dígitos", () => {
    expect(formatearCuit("3068")).toBe("3068");
    expect(formatearCuit("")).toBe("");
  });
});
