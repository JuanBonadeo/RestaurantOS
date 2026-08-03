import { describe, it, expect } from "vitest";

import {
  gridNextIndex,
  indexFromDigit,
  isPrintableKey,
  nextIndex,
} from "./roving";

describe("nextIndex", () => {
  it("baja una posición dentro de la lista", () => {
    expect(nextIndex(1, 1, 5)).toEqual({ kind: "index", index: 2 });
  });

  it("sube una posición dentro de la lista", () => {
    expect(nextIndex(3, -1, 5)).toEqual({ kind: "index", index: 2 });
  });

  it("↓ en el último NO clampea: avisa que hay que salir por abajo", () => {
    expect(nextIndex(4, 1, 5)).toEqual({ kind: "exit", edge: "down" });
  });

  it("↑ en el primero NO clampea: avisa que hay que salir por arriba", () => {
    expect(nextIndex(0, -1, 5)).toEqual({ kind: "exit", edge: "up" });
  });

  it("lista de un solo elemento: sale por los dos bordes", () => {
    expect(nextIndex(0, 1, 1)).toEqual({ kind: "exit", edge: "down" });
    expect(nextIndex(0, -1, 1)).toEqual({ kind: "exit", edge: "up" });
  });

  it("zona vacía: es transparente, sale en la dirección del movimiento", () => {
    expect(nextIndex(-1, 1, 0)).toEqual({ kind: "exit", edge: "down" });
    expect(nextIndex(-1, -1, 0)).toEqual({ kind: "exit", edge: "up" });
  });

  it("sin selección previa (-1), ↓ entra por el primero", () => {
    expect(nextIndex(-1, 1, 5)).toEqual({ kind: "index", index: 0 });
  });

  it("índice fuera de rango: se acomoda antes de moverse", () => {
    // El catálogo cambió y el índice quedó viejo: no explota ni salta al vacío.
    expect(nextIndex(99, -1, 5)).toEqual({ kind: "index", index: 3 });
  });

  it("delta 0: se queda donde está", () => {
    expect(nextIndex(2, 0, 5)).toEqual({ kind: "index", index: 2 });
  });
});

describe("gridNextIndex", () => {
  // Selector de 5 métodos de pago en 2 columnas:
  //   0 1
  //   2 3
  //   4
  const LENGTH = 5;
  const COLS = 2;

  it("↓ baja una fila (no se va al costado)", () => {
    expect(gridNextIndex(0, "ArrowDown", LENGTH, COLS)).toEqual({
      kind: "index",
      index: 2,
    });
  });

  it("↑ sube una fila", () => {
    expect(gridNextIndex(3, "ArrowUp", LENGTH, COLS)).toEqual({
      kind: "index",
      index: 1,
    });
  });

  it("↑ en la primera fila sale por arriba", () => {
    expect(gridNextIndex(1, "ArrowUp", LENGTH, COLS)).toEqual({
      kind: "exit",
      edge: "up",
    });
  });

  it("↓ sin fila debajo sale por abajo (última fila incompleta)", () => {
    // Desde el 3 (fila 1, col 1) no hay col 1 en la fila 2: sólo está el 4.
    expect(gridNextIndex(3, "ArrowDown", LENGTH, COLS)).toEqual({
      kind: "exit",
      edge: "down",
    });
  });

  it("→ y ← se mueven en orden de lectura, cruzando de fila", () => {
    expect(gridNextIndex(1, "ArrowRight", LENGTH, COLS)).toEqual({
      kind: "index",
      index: 2,
    });
    expect(gridNextIndex(2, "ArrowLeft", LENGTH, COLS)).toEqual({
      kind: "index",
      index: 1,
    });
  });

  it("← en el primero sale por arriba y → en el último por abajo", () => {
    expect(gridNextIndex(0, "ArrowLeft", LENGTH, COLS)).toEqual({
      kind: "exit",
      edge: "up",
    });
    expect(gridNextIndex(4, "ArrowRight", LENGTH, COLS)).toEqual({
      kind: "exit",
      edge: "down",
    });
  });

  it("una sola columna: se comporta como lista", () => {
    expect(gridNextIndex(1, "ArrowDown", 3, 1)).toEqual({
      kind: "index",
      index: 2,
    });
    expect(gridNextIndex(2, "ArrowDown", 3, 1)).toEqual({
      kind: "exit",
      edge: "down",
    });
  });

  it("columnas inválidas: no rompe, trata la grilla como lista", () => {
    expect(gridNextIndex(0, "ArrowDown", 3, 0)).toEqual({
      kind: "index",
      index: 1,
    });
  });

  it("grilla vacía: transparente en las cuatro direcciones", () => {
    expect(gridNextIndex(-1, "ArrowDown", 0, COLS)).toEqual({
      kind: "exit",
      edge: "down",
    });
    expect(gridNextIndex(-1, "ArrowUp", 0, COLS)).toEqual({
      kind: "exit",
      edge: "up",
    });
  });

  it("tecla que no es flecha: null (el caller la deja pasar)", () => {
    expect(gridNextIndex(0, "Enter", LENGTH, COLS)).toBeNull();
    expect(gridNextIndex(0, "a", LENGTH, COLS)).toBeNull();
  });
});

describe("indexFromDigit", () => {
  it("1..9 mapean a 0..8", () => {
    expect(indexFromDigit("1", 5)).toBe(0);
    expect(indexFromDigit("5", 5)).toBe(4);
  });

  it("dígito más allá del último elemento: null", () => {
    expect(indexFromDigit("6", 5)).toBeNull();
  });

  it("el 0 no es un atajo (las opciones se numeran desde 1)", () => {
    expect(indexFromDigit("0", 5)).toBeNull();
  });

  it("cualquier otra tecla: null", () => {
    expect(indexFromDigit("a", 5)).toBeNull();
    expect(indexFromDigit("Enter", 5)).toBeNull();
    expect(indexFromDigit("ArrowDown", 5)).toBeNull();
  });
});

describe("isPrintableKey", () => {
  it("una letra o un número suelto es escribible", () => {
    expect(isPrintableKey({ key: "a" })).toBe(true);
    expect(isPrintableKey({ key: "7" })).toBe(true);
    expect(isPrintableKey({ key: "ñ" })).toBe(true);
  });

  it("el espacio NO: activa el elemento enfocado", () => {
    expect(isPrintableKey({ key: " " })).toBe(false);
  });

  it("las teclas de control no lo son", () => {
    expect(isPrintableKey({ key: "Enter" })).toBe(false);
    expect(isPrintableKey({ key: "ArrowDown" })).toBe(false);
    expect(isPrintableKey({ key: "Escape" })).toBe(false);
  });

  it("con un modificador no lo es (⌘K no escribe una k)", () => {
    expect(isPrintableKey({ key: "k", metaKey: true })).toBe(false);
    expect(isPrintableKey({ key: "k", ctrlKey: true })).toBe(false);
    expect(isPrintableKey({ key: "k", altKey: true })).toBe(false);
  });

  it("Shift sí escribe (una mayúscula es texto)", () => {
    expect(isPrintableKey({ key: "K", shiftKey: true })).toBe(true);
  });
});
