import { describe, expect, it } from "vitest";

import { duracionDelTurno } from "./formato-cierre";

describe("duracionDelTurno", () => {
  it("un turno de noche se lee en horas y minutos", () => {
    // 2/9 18:32 → 3/9 01:14, el caso que se mira todos los días.
    expect(
      duracionDelTurno("2026-09-02T21:32:00Z", "2026-09-03T04:14:00Z"),
    ).toBe("6 h 42 m");
  });

  it("rellena el minuto con cero para que la columna no baile", () => {
    expect(
      duracionDelTurno("2026-09-02T21:00:00Z", "2026-09-03T04:05:00Z"),
    ).toBe("7 h 05 m");
  });

  it("omite los minutos cuando son cero", () => {
    expect(
      duracionDelTurno("2026-09-02T21:00:00Z", "2026-09-03T04:00:00Z"),
    ).toBe("7 h");
  });

  it("menos de una hora va en minutos", () => {
    expect(
      duracionDelTurno("2026-09-03T03:50:00Z", "2026-09-03T04:14:00Z"),
    ).toBe("24 m");
  });

  it("un cierre salteado sigue en horas hasta las 48", () => {
    expect(
      duracionDelTurno("2026-09-01T21:00:00Z", "2026-09-03T04:00:00Z"),
    ).toBe("31 h");
  });

  it("recién arriba de 48 h pasa a días", () => {
    expect(
      duracionDelTurno("2026-08-31T21:00:00Z", "2026-09-03T04:00:00Z"),
    ).toBe("2 d 7 h");
  });

  it("una duración negativa se dice que no se sabe, no se muestra en negativo", () => {
    expect(
      duracionDelTurno("2026-09-03T04:14:00Z", "2026-09-02T21:32:00Z"),
    ).toBe("—");
  });

  it("una fecha inválida no rompe la fila", () => {
    expect(duracionDelTurno("no-es-fecha", "2026-09-03T04:14:00Z")).toBe("—");
  });
});
