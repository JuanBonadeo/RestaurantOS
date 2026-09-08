import { describe, expect, it } from "vitest";

import {
  buildGupshupSessionForm,
  buildGupshupTemplateForm,
  parseGupshupInbound,
  parseGupshupResponse,
  verifyGupshupToken,
} from "./whatsapp-gupshup";

describe("buildGupshupSessionForm", () => {
  it("arma el form-urlencoded de un texto de sesión con el mensaje como JSON-string", () => {
    const form = buildGupshupSessionForm({
      source: "+54 9 11 0000-0000",
      srcName: "GolfHouse",
      to: "+54 9 11 2233-4455",
      text: "Hola Ana",
    });
    expect(form).toEqual({
      channel: "whatsapp",
      source: "5491100000000",
      destination: "5491122334455",
      "src.name": "GolfHouse",
      message: JSON.stringify({ type: "text", text: "Hola Ana" }),
    });
  });

  it("el campo message es parseable y del tipo text", () => {
    const form = buildGupshupSessionForm({
      source: "5491100000000",
      srcName: "App",
      to: "5491122334455",
      text: "con \"comillas\" y ñ",
    });
    expect(JSON.parse(form.message)).toEqual({
      type: "text",
      text: 'con "comillas" y ñ',
    });
  });
});

describe("buildGupshupTemplateForm", () => {
  it("arma el form con template {id, params posicional}", () => {
    const form = buildGupshupTemplateForm({
      source: "5491100000000",
      srcName: "App",
      to: "5491122334455",
      templateId: "c6aecef6-bcb0-4fb1-8100-28c094e3bc6b",
      params: ["Ana", "42"],
    });
    expect(form.channel).toBe("whatsapp");
    expect(form.destination).toBe("5491122334455");
    expect(JSON.parse(form.template)).toEqual({
      id: "c6aecef6-bcb0-4fb1-8100-28c094e3bc6b",
      params: ["Ana", "42"],
    });
  });
});

describe("parseGupshupResponse", () => {
  it("éxito → ok con el messageId del provider", () => {
    const res = parseGupshupResponse(200, {
      status: "submitted",
      messageId: "183dc8f1-7ecc-4419-895f-04fd0b1bfe07",
    });
    expect(res).toEqual({
      ok: true,
      messageId: "183dc8f1-7ecc-4419-895f-04fd0b1bfe07",
    });
  });

  it("2xx sin status submitted → ok:false", () => {
    const res = parseGupshupResponse(202, { status: "error", message: "Invalid Destination" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("Invalid Destination");
  });

  it("error HTTP con message → ok:false legible", () => {
    const res = parseGupshupResponse(401, { status: "error", message: "Authentication Failed" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("Authentication Failed");
  });

  it("error sin cuerpo parseable → mensaje genérico con el status", () => {
    const res = parseGupshupResponse(500, null);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("500");
  });
});

describe("parseGupshupInbound", () => {
  const textEnvelope = {
    app: "GolfHouse",
    timestamp: 1580227766370,
    version: 2,
    type: "message",
    payload: {
      id: "ABEGkYaYVSEEAhAL",
      source: "5491122334455",
      type: "text",
      payload: { text: "Quiero reservar" },
      sender: { phone: "5491122334455", name: "Ana" },
    },
  };

  it("mensaje de texto → kind text con phone/name/text/id/app", () => {
    const r = parseGupshupInbound(textEnvelope);
    expect(r).toEqual({
      kind: "text",
      app: "GolfHouse",
      phone: "5491122334455",
      name: "Ana",
      text: "Quiero reservar",
      providerEventId: "ABEGkYaYVSEEAhAL",
    });
  });

  it("media (image) → kind media (fase 1 no procesa)", () => {
    const r = parseGupshupInbound({
      app: "GolfHouse",
      type: "message",
      payload: {
        id: "X1",
        source: "549110",
        type: "image",
        payload: { url: "https://filemanager.gupshup.io/x.jpg" },
        sender: { phone: "549110" },
      },
    });
    expect(r.kind).toBe("media");
  });

  it("media trae el remitente y el id, para poder guardarla en la bandeja", () => {
    // El parser devolvía sólo `{kind:'media', app}`, así que el webhook no tenía
    // con qué anotar el audio/foto/ubicación en la bandeja: quedaba sin
    // teléfono al que atribuirlo y sin id para deduplicar.
    const r = parseGupshupInbound({
      app: "GolfHouse",
      type: "message",
      payload: {
        id: "AUD-1",
        source: "5491122334455",
        type: "audio",
        payload: { url: "https://filemanager.gupshup.io/a.ogg" },
        sender: { phone: "5491122334455", name: "Ana" },
      },
    });
    expect(r).toEqual({
      kind: "media",
      app: "GolfHouse",
      phone: "5491122334455",
      name: "Ana",
      mediaType: "audio",
      providerEventId: "AUD-1",
    });
  });

  it("message-event (DLR) → kind event", () => {
    const r = parseGupshupInbound({ app: "GolfHouse", type: "message-event", payload: {} });
    expect(r.kind).toBe("event");
  });

  it("user-event → kind event", () => {
    const r = parseGupshupInbound({ app: "GolfHouse", type: "user-event", payload: {} });
    expect(r.kind).toBe("event");
  });

  it("botón quick-reply (title sin text) → kind text con el título", () => {
    const r = parseGupshupInbound({
      app: "GolfHouse",
      type: "message",
      payload: {
        id: "B1",
        source: "549110",
        type: "text",
        payload: { title: "Sí, confirmar" },
        sender: { phone: "549110" },
      },
    });
    expect(r.kind).toBe("text");
    if (r.kind === "text") expect(r.text).toBe("Sí, confirmar");
  });

  it("sin id o sin phone → kind ignore", () => {
    expect(parseGupshupInbound({ type: "message", payload: { type: "text" } }).kind).toBe(
      "ignore",
    );
  });
});

describe("verifyGupshupToken", () => {
  it("token correcto → true", () => {
    expect(verifyGupshupToken("s3cr3t-token", "s3cr3t-token")).toBe(true);
  });
  it("token incorrecto → false", () => {
    expect(verifyGupshupToken("wrong", "s3cr3t-token")).toBe(false);
  });
  it("token ausente o expected ausente → false (fail-closed)", () => {
    expect(verifyGupshupToken(null, "s3cr3t-token")).toBe(false);
    expect(verifyGupshupToken("x", null)).toBe(false);
    expect(verifyGupshupToken(undefined, undefined)).toBe(false);
  });
});
