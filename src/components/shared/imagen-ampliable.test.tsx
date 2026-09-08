import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { ImagenAmpliable, type PaginaImagen } from "./imagen-ampliable";

const PAGINAS: PaginaImagen[] = [
  { id: "a", url: "blob:a", etiqueta: "Página 1 de 2" },
  { id: "b", url: "blob:b", etiqueta: "Página 2 de 2" },
];

function abrir(onIndice = vi.fn(), indice = 0) {
  render(
    <ImagenAmpliable paginas={PAGINAS} indice={indice} onIndice={onIndice}>
      <button type="button">Ampliar</button>
    </ImagenAmpliable>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Ampliar" }));
  return onIndice;
}

describe("ImagenAmpliable", () => {
  it("el Esc cierra la foto y NO llega a la pantalla de atrás", () => {
    // El caso que esto protege: la carga de una compra, con las fotos subidas y
    // los renglones ya revisados a mano. Si el Esc burbujea hasta el dismissable
    // de la pantalla, se cierra todo y se pierde el trabajo.
    const pantallaDeAtras = vi.fn();
    document.addEventListener("keydown", pantallaDeAtras);
    try {
      abrir();
      expect(screen.getByRole("dialog")).toBeTruthy();

      fireEvent.keyDown(document.body, { key: "Escape" });

      expect(screen.queryByRole("dialog")).toBeNull();
      expect(pantallaDeAtras).not.toHaveBeenCalled();
    } finally {
      document.removeEventListener("keydown", pantallaDeAtras);
    }
  });

  it("←/→ pasan de página y se frenan en los bordes", () => {
    const onIndice = abrir(vi.fn(), 0);

    fireEvent.keyDown(document.body, { key: "ArrowLeft" });
    expect(onIndice).not.toHaveBeenCalled();

    fireEvent.keyDown(document.body, { key: "ArrowRight" });
    expect(onIndice).toHaveBeenCalledWith(1);
  });

  it("el disparador conserva su propio onClick", () => {
    const propio = vi.fn();
    render(
      <ImagenAmpliable paginas={PAGINAS} indice={0} onIndice={vi.fn()}>
        <button type="button" onClick={propio}>
          Ampliar
        </button>
      </ImagenAmpliable>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Ampliar" }));
    expect(propio).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("devuelve el scroll del body al cerrar", () => {
    abrir();
    expect(document.body.style.overflow).toBe("hidden");
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(document.body.style.overflow).toBe("");
  });
});
