import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { InvoiceVisor, type PaginaFoto } from "./invoice-visor";

const PAGINAS: PaginaFoto[] = [
  { id: "a", path: "biz/a.jpg", previewUrl: "blob:a", estado: "lista" },
  { id: "b", path: "biz/b.jpg", previewUrl: "blob:b", estado: "leyendo" },
];

function montar(props: Partial<Parameters<typeof InvoiceVisor>[0]> = {}) {
  const onReordenar = vi.fn();
  const onAgregar = vi.fn();
  const onActiva = vi.fn();
  const onQuitar = vi.fn();
  render(
    <InvoiceVisor
      paginas={PAGINAS}
      activa={0}
      onActiva={onActiva}
      onReordenar={onReordenar}
      onQuitar={onQuitar}
      onAgregar={onAgregar}
      maxPaginas={5}
      {...props}
    />,
  );
  return { onReordenar, onAgregar, onActiva, onQuitar };
}

describe("InvoiceVisor", () => {
  it("↑ sobre una miniatura la mueve de lugar", () => {
    const { onReordenar } = montar();
    const segunda = screen.getByTitle(/Página 2 de 2/);

    fireEvent.keyDown(segunda, { key: "ArrowUp" });
    expect(onReordenar).toHaveBeenCalledWith(1, 0);

    // La última no puede bajar más: sin el borde, el índice se va del array.
    fireEvent.keyDown(segunda, { key: "ArrowDown" });
    expect(onReordenar).toHaveBeenCalledTimes(1);
  });

  it("pegar una imagen con Ctrl+V la suma", () => {
    const { onAgregar } = montar();
    const foto = new File(["x"], "ticket.jpg", { type: "image/jpeg" });

    fireEvent(
      window,
      Object.assign(new Event("paste"), { clipboardData: { files: [foto] } }),
    );
    expect(onAgregar).toHaveBeenCalledWith([foto]);
  });

  it("pegar texto no suma nada", () => {
    const { onAgregar } = montar();
    fireEvent(window, Object.assign(new Event("paste"), { clipboardData: { files: [] } }));
    expect(onAgregar).not.toHaveBeenCalled();
  });

  it("con el cupo lleno no acepta más páginas", () => {
    const { onAgregar } = montar({ maxPaginas: 2 });
    const foto = new File(["x"], "ticket.jpg", { type: "image/jpeg" });
    fireEvent(window, Object.assign(new Event("paste"), { clipboardData: { files: [foto] } }));
    expect(onAgregar).not.toHaveBeenCalled();
  });

  it("avisa el orden que espera el lector", () => {
    montar();
    expect(screen.getAllByText(/La 1 tiene el encabezado, la última el total/).length).toBeGreaterThan(0);
  });
});
