// @vitest-environment node
import { describe, expect, it } from "vitest";

import { upsertContact, type RunChatbotInput } from "./agent";

/**
 * La carrera del primer mensaje: un número que nunca escribió manda «hola» y
 * enseguida «quiero reservar». Gupshup entrega los dos POST casi juntos y
 * Vercel los puede correr en instancias distintas: los dos turnos hacen SELECT
 * sin encontrar fila y los dos hacen INSERT. La constraint
 * `UNIQUE (business_id, channel, identifier)` hace que uno reciba 23505.
 *
 * Sin recuperación, ese turno moría entero y el mensaje no se persistía en
 * ningún lado — justo en el primer contacto del cliente, que es el que trae el
 * pedido o la reserva. `getOrOpenConversation` ya contemplaba exactamente esta
 * carrera treinta líneas más abajo; era la misma regla escrita en un solo lado.
 */

type Row = { id: string } | null;

/** Doble del cliente de Supabase, sólo con lo que toca `upsertContact`. */
function fakeService(opts: {
  selectResults: Row[];
  insertError: { code: string } | null;
}) {
  const selects = [...opts.selectResults];
  const estado = { selectCount: 0, insertCount: 0 };
  const service = {
    from() {
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => {
                  estado.selectCount += 1;
                  return { data: selects.shift() ?? null, error: null };
                },
              }),
            }),
          }),
        }),
        insert: () => ({
          select: () => ({
            single: async () => {
              estado.insertCount += 1;
              return opts.insertError
                ? { data: null, error: opts.insertError }
                : { data: { id: "nuevo" }, error: null };
            },
          }),
        }),
      };
    },
  };
  return { service, estado };
}

const input: RunChatbotInput = {
  businessId: "b1",
  businessSlug: "golf",
  businessName: "Golf",
  channel: "whatsapp",
  contactIdentifier: "5491122334455",
  userMessage: "hola",
};

type Service = Parameters<typeof upsertContact>[0];

describe("upsertContact — el perdedor de la carrera no pierde el mensaje", () => {
  it("con 23505, relee el contacto que ganó en vez de tirar el turno", async () => {
    const { service, estado } = fakeService({
      // 1er SELECT: no existe todavía. 2do (tras el 23505): lo creó el otro turno.
      selectResults: [null, { id: "el-que-gano" }],
      insertError: { code: "23505" },
    });

    await expect(
      upsertContact(service as unknown as Service, input),
    ).resolves.toBe("el-que-gano");
    expect(estado.insertCount).toBe(1);
    expect(estado.selectCount).toBe(2);
  });

  it("si el contacto ya existe, ni siquiera intenta insertar", async () => {
    const { service, estado } = fakeService({
      selectResults: [{ id: "ya-estaba" }],
      insertError: null,
    });

    await expect(
      upsertContact(service as unknown as Service, input),
    ).resolves.toBe("ya-estaba");
    expect(estado.insertCount).toBe(0);
  });

  it("un error que NO es la carrera sigue rompiendo el turno", async () => {
    // No queremos tapar un problema real de la base con un reintento mudo.
    const { service } = fakeService({
      selectResults: [null, null],
      insertError: { code: "23503" }, // foreign_key_violation
    });

    await expect(
      upsertContact(service as unknown as Service, input),
    ).rejects.toThrow(/Failed to upsert contact/);
  });
});
