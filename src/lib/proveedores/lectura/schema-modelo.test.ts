import { describe, expect, it } from "vitest";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";

import { LecturaModelo } from "@/lib/proveedores/lectura/schema-modelo";
import { detectarMime } from "@/lib/proveedores/lectura/leer";

/**
 * El contrato con la API, fijado — spec 172.
 *
 * Existe por un bug que llegó a producción: el JSON Schema estaba escrito a mano
 * y usaba `type: ["string", "null"]` para los campos opcionales, que el validador
 * de structured outputs NO acepta. La API devolvía 400 en TODAS las lecturas, con
 * cualquier foto, y el mensaje que veía la encargada la mandaba a sacar otra —
 * así que sacó la misma dos veces.
 */
describe("el formato de salida se deriva del Zod", () => {
  it("el helper digiere el schema entero", () => {
    const format = zodOutputFormat(LecturaModelo) as { type: string; schema: unknown };
    expect(format.type).toBe("json_schema");
    expect(format.schema).toBeTruthy();
  });

  it("los campos que pueden faltar salen como anyOf, nunca como type array", () => {
    const format = zodOutputFormat(LecturaModelo) as unknown as {
      schema: { properties: Record<string, { anyOf?: unknown[]; type?: unknown }> };
    };
    const motivo = format.schema.properties.motivo_descarte!;

    expect(motivo.anyOf).toHaveLength(2);
    // La forma que rompía: `type` como array de dos strings.
    expect(Array.isArray(motivo.type)).toBe(false);
  });

  it("no queda ningún `type` en forma de array en todo el schema", () => {
    const json = JSON.stringify(zodOutputFormat(LecturaModelo));
    expect(json).not.toMatch(/"type":\s*\[/);
  });
});

describe("detectarMime · los bytes mandan, no el MIME declarado", () => {
  const con = (...bytes: number[]) => {
    const b = new Uint8Array(16);
    bytes.forEach((v, i) => (b[i] = v));
    return b.buffer;
  };

  it("reconoce lo que la API sabe leer", () => {
    expect(detectarMime(con(0xff, 0xd8, 0xff))).toBe("image/jpeg");
    expect(detectarMime(con(0x89, 0x50, 0x4e, 0x47))).toBe("image/png");
    expect(detectarMime(con(0x47, 0x49, 0x46, 0x38))).toBe("image/gif");
  });

  it("reconoce el webp por su RIFF, no sólo por los primeros cuatro bytes", () => {
    const b = new Uint8Array(16);
    [0x52, 0x49, 0x46, 0x46].forEach((v, i) => (b[i] = v));
    [0x57, 0x45, 0x42, 0x50].forEach((v, i) => (b[8 + i] = v));
    expect(detectarMime(b.buffer)).toBe("image/webp");
  });

  it("distingue el PDF, que no es una foto", () => {
    expect(detectarMime(con(0x25, 0x50, 0x44, 0x46))).toBe("application/pdf");
  });

  it("rechaza el HEIC del iPhone en vez de mandarlo y comerse un 400", () => {
    // ....ftypheic
    const b = new Uint8Array(16);
    [0x66, 0x74, 0x79, 0x70].forEach((v, i) => (b[4 + i] = v));
    expect(detectarMime(b.buffer)).toBeNull();
  });

  it("no se deja engañar por un archivo que no es imagen", () => {
    expect(detectarMime(con(0x50, 0x4b, 0x03, 0x04))).toBeNull(); // zip
    expect(detectarMime(con(0x3c, 0x21, 0x44, 0x4f))).toBeNull(); // html
    expect(detectarMime(new ArrayBuffer(0))).toBeNull();
  });
});
