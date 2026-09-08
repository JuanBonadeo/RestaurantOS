import { describe, expect, it } from "vitest";

import { parseFechaAR } from "@/lib/proveedores/lectura/fecha-ar";

describe("parseFechaAR", () => {
  it("lee la fecha en orden argentino", () => {
    expect(parseFechaAR("15/03/2026")).toBe("2026-03-15");
    expect(parseFechaAR("15-03-2026")).toBe("2026-03-15");
    expect(parseFechaAR("15.03.2026")).toBe("2026-03-15");
    expect(parseFechaAR("15 03 2026")).toBe("2026-03-15");
  });

  it("día y mes en ese orden, siempre — el caso que hay que no romper nunca", () => {
    // «05/06/2026» es el 5 de JUNIO. Leerlo al revés mueve el vencimiento de la
    // cuenta corriente un mes entero, y los primeros doce días de cada mes son
    // justo los que nadie puede notar a ojo.
    expect(parseFechaAR("05/06/2026")).toBe("2026-06-05");
    expect(parseFechaAR("06/05/2026")).toBe("2026-05-06");
    expect(parseFechaAR("01/02/2026")).toBe("2026-02-01");
  });

  it("completa el año de dos dígitos a este siglo", () => {
    expect(parseFechaAR("15-03-26")).toBe("2026-03-15");
    expect(parseFechaAR("3/7/26")).toBe("2026-07-03");
    expect(parseFechaAR("1/1/25")).toBe("2025-01-01");
  });

  it("deja pasar el ISO que a veces ya viene armado", () => {
    // Cuatro dígitos adelante sólo pueden ser el año: si esto entrara por la
    // regla argentina daría «el día 2026 del mes 03» y perdería una fecha que
    // estaba perfecta.
    expect(parseFechaAR("2026-03-15")).toBe("2026-03-15");
    expect(parseFechaAR("2026/03/15")).toBe("2026-03-15");
  });

  it("lee el mes en letras", () => {
    expect(parseFechaAR("15 MAR 2026")).toBe("2026-03-15");
    expect(parseFechaAR("15/MAR/2026")).toBe("2026-03-15");
    expect(parseFechaAR("15 de marzo de 2026")).toBe("2026-03-15");
    expect(parseFechaAR("1 SET 26")).toBe("2026-09-01");
    expect(parseFechaAR("7 dic. 2025")).toBe("2025-12-07");
  });

  it("saca la etiqueta de adelante y la hora de atrás", () => {
    expect(parseFechaAR("Fecha: 15/03/2026")).toBe("2026-03-15");
    expect(parseFechaAR("15/03/2026 14:32")).toBe("2026-03-15");
  });

  it("no rueda al mes siguiente cuando el día no existe", () => {
    // `new Date(2026, 12, 32)` no falla: se convierte en un 1 de febrero de 2027
    // con toda naturalidad, y nadie lo vuelve a mirar. Por eso la validación es
    // aritmética y no `Date`.
    expect(parseFechaAR("32/13/2026")).toBeNull();
    expect(parseFechaAR("31/02/2026")).toBeNull();
    expect(parseFechaAR("00/03/2026")).toBeNull();
    expect(parseFechaAR("15/13/2026")).toBeNull();
  });

  it("acepta el 29 de febrero sólo en año bisiesto", () => {
    expect(parseFechaAR("29/02/2024")).toBe("2024-02-29");
    expect(parseFechaAR("29/02/2026")).toBeNull();
    // Y el siglo, que es la regla que casi nadie escribe bien: 2000 SÍ es
    // bisiesto porque es múltiplo de 400.
    expect(parseFechaAR("29/02/2000")).toBe("2000-02-29");
  });

  it("devuelve null y NUNCA hoy cuando no hay fecha", () => {
    // Un campo vacío lo completa el encargado en dos segundos mirando el papel;
    // una fecha inventada mueve el vencimiento y no la nota nadie.
    expect(parseFechaAR(null)).toBeNull();
    expect(parseFechaAR(undefined)).toBeNull();
    expect(parseFechaAR("")).toBeNull();
    expect(parseFechaAR("   ")).toBeNull();
    expect(parseFechaAR("s/d")).toBeNull();
    expect(parseFechaAR("—")).toBeNull();
    expect(parseFechaAR("varios")).toBeNull();
  });

  it("no confunde con una fecha lo que es otro número del papel", () => {
    // El número de comprobante y el CUIT también son dígitos con guiones.
    expect(parseFechaAR("0001-00012345")).toBeNull();
    expect(parseFechaAR("30-68469261-1")).toBeNull();
    expect(parseFechaAR("20260315")).toBeNull();
    expect(parseFechaAR("15/03/20265")).toBeNull();
  });

  it("rechaza el año que salió de un dígito mal leído", () => {
    // Cuesta que el encargado tipee seis caracteres; aceptarlo cuesta un
    // vencimiento a mil años vista en el listado de deuda.
    expect(parseFechaAR("15/03/1026")).toBeNull();
    expect(parseFechaAR("15/03/2999")).toBeNull();
  });

  it("no inventa un mes que no existe", () => {
    expect(parseFechaAR("15 XXX 2026")).toBeNull();
  });
});
