import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// El picker de productos y el uploader pegan al server; acá sólo importa el
// orden de las tarjetas, así que se neutralizan.
// Muestra el nombre del producto elegido: es lo que permite leer en qué orden
// quedaron las opciones.
vi.mock("@/components/admin/daily-menus/product-picker", () => ({
  ProductPicker: ({ value }: { value: { name: string } | null }) => (
    <div data-testid="product-picker">{value?.name ?? "sin producto"}</div>
  ),
}));
vi.mock("@/components/admin/catalog/image-uploader", () => ({
  ImageUploader: () => <div data-testid="image-uploader" />,
}));
vi.mock("@/lib/daily-menus/daily-menu-actions", () => ({
  createDailyMenu: async () => ({ ok: true, data: { id: "m1" } }),
  updateDailyMenu: async () => ({ ok: true, data: { id: "m1" } }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import { DailyMenuForm } from "./daily-menu-form";
import type {
  AdminDailyMenu,
  AdminDailyMenuComponent,
} from "@/lib/admin/daily-menu-query";

/**
 * Reordenar y borrar en el editor del menú del día (spec 076).
 *
 * El orden de las tarjetas ES el `sort_order` que se persiste, y de él dependen
 * los pasos del asistente del mozo (spec 072) y qué grupos puede condicionar
 * una opción (spec 074). Antes de esta spec el array sólo crecía: no había
 * forma de mover nada ni de borrar un grupo.
 */

const uuid = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;
const GRUPO = { entrada: uuid(1), principal: uuid(2), postre: uuid(3) };

let sortOrder = 0;
let productSeq = 100;

function option(
  groupId: string,
  groupLabel: string,
  name: string,
  blocks: string[] = [],
  extraCents = 0,
): AdminDailyMenuComponent {
  return {
    id: `opt-${name}`,
    label: name,
    description: null,
    sort_order: sortOrder++,
    kind: "choice",
    product_id: `00000000-0000-4000-8000-0000000${productSeq++}`,
    choice_group_id: groupId,
    choice_group_label: groupLabel,
    product_name: name,
    product_image_url: null,
    extra_price_cents: extraCents,
    blocks_choice_group_ids: blocks,
  };
}

function menuCon(components: AdminDailyMenuComponent[]): AdminDailyMenu {
  return {
    id: "m1",
    name: "Menú ejecutivo",
    slug: "ejecutivo",
    description: null,
    price_cents: 1000000,
    image_url: null,
    available_days: [1, 2, 3],
    is_active: true,
    is_available: true,
    sort_order: 0,
    display_context: "both",
    is_suggestion: false,
    components,
    choice_groups: [],
  };
}

const MENU = menuCon([
  option(GRUPO.entrada, "Entrada", "Empanadas"),
  option(GRUPO.entrada, "Entrada", "Provoleta"),
  option(GRUPO.principal, "Principal", "Milanesa"),
  option(GRUPO.principal, "Principal", "Ravioles"),
  option(GRUPO.postre, "Postre", "Flan"),
]);

function renderForm(menu: AdminDailyMenu = MENU) {
  return render(
    <DailyMenuForm slug="golf-jcr" businessId={uuid(8)} menu={menu} />,
  );
}

/** Orden de las tarjetas, leído de los botones «Subir …» que hay uno por tarjeta. */
const cardOrder = () =>
  screen
    .getAllByRole("button", { name: /^Subir el (grupo|componente)/ })
    .map((b) => b.getAttribute("aria-label")!.replace("Subir el ", ""));

/** Orden en que quedaron TODAS las opciones, leído de los pickers de producto. */
const optionOrder = () =>
  screen.getAllByTestId("product-picker").map((el) => el.textContent);

const btn = (name: string | RegExp) => screen.getByRole("button", { name });

afterEach(() => vi.restoreAllMocks());

describe("editor del menú del día · reordenar (spec 076)", () => {
  it("bajar un grupo lo pone después del siguiente, con sus opciones", () => {
    renderForm();
    expect(cardOrder()).toEqual(["grupo Entrada", "grupo Principal", "grupo Postre"]);

    fireEvent.click(btn("Bajar el grupo Entrada"));

    expect(cardOrder()).toEqual(["grupo Principal", "grupo Entrada", "grupo Postre"]);
    // Las dos opciones de Entrada viajaron juntas y en su orden.
    expect(optionOrder()).toEqual([
      "Milanesa",
      "Ravioles",
      "Empanadas",
      "Provoleta",
      "Flan",
    ]);
  });

  it("subir un grupo lo pone antes del anterior", () => {
    renderForm();
    fireEvent.click(btn("Subir el grupo Postre"));
    expect(cardOrder()).toEqual(["grupo Entrada", "grupo Postre", "grupo Principal"]);
  });

  it("los botones de los extremos están deshabilitados", () => {
    renderForm();
    expect(btn("Subir el grupo Entrada")).toBeDisabled();
    expect(btn("Bajar el grupo Postre")).toBeDisabled();
    expect(btn("Bajar el grupo Entrada")).not.toBeDisabled();
  });

  it("después de mover, el foco queda en el botón de la nueva posición", () => {
    renderForm();
    fireEvent.click(btn("Bajar el grupo Entrada"));
    // El grupo quedó en el medio: sigue habiendo «Bajar» y ahí está el foco.
    expect(document.activeElement).toBe(btn("Bajar el grupo Entrada"));
  });

  it("al llegar al extremo el foco pasa al botón contrario, que no está deshabilitado", () => {
    renderForm();
    fireEvent.click(btn("Subir el grupo Postre"));
    fireEvent.click(btn("Subir el grupo Postre"));
    expect(cardOrder()[0]).toBe("grupo Postre");
    expect(document.activeElement).toBe(btn("Bajar el grupo Postre"));
    expect(document.activeElement).not.toBeDisabled();
  });

  it("las opciones se ordenan dentro de su grupo, sin tocar los otros grupos", () => {
    renderForm();

    fireEvent.click(btn("Bajar la opción 1 de Entrada"));

    // Ese orden es el que numera los atajos 1-9 del asistente del mozo: ahora
    // el «1» del mozo carga la provoleta.
    expect(optionOrder()).toEqual([
      "Provoleta",
      "Empanadas",
      "Milanesa",
      "Ravioles",
      "Flan",
    ]);
    expect(cardOrder()).toEqual(["grupo Entrada", "grupo Principal", "grupo Postre"]);
    // Quedó última: el foco pasa al botón contrario, que sí está habilitado.
    expect(document.activeElement).toBe(btn("Subir la opción 2 de Entrada"));
    expect(document.activeElement).not.toBeDisabled();
  });
});

describe("editor del menú del día · los valores viajan con la tarjeta (spec 076)", () => {
  /**
   * Regresión encontrada en la revisión adversarial del diff: con `replace()`
   * de `useFieldArray`, los `Controller` de cada campo no se re-sincronizaban y
   * los valores quedaban pegados al **índice**, no a la opción. Mover la opción
   * de arriba dejaba su «+$» en la que le ocupó el lugar — el editor mostraba
   * un adicional que no era el de ese plato. Por eso `applyComponents` escribe
   * con `reset`.
   */
  const CON_PRECIOS = menuCon([
    option(GRUPO.entrada, "Bebida", "Agua", [], 0),
    option(GRUPO.entrada, "Bebida", "Cerveza", [], 50000),
    option(GRUPO.principal, "Postre", "Flan", [], 30000),
  ]);

  const precios = () =>
    screen
      .getAllByLabelText("Adicional en pesos")
      .map((el) => (el as HTMLInputElement).value);

  it("el +$ sigue a su opción al moverla dentro del grupo", () => {
    renderForm(CON_PRECIOS);
    expect(optionOrder()).toEqual(["Agua", "Cerveza", "Flan"]);
    expect(precios()).toEqual(["0", "500", "300"]);

    fireEvent.click(btn("Bajar la opción 1 de Bebida"));

    expect(optionOrder()).toEqual(["Cerveza", "Agua", "Flan"]);
    expect(precios()).toEqual(["500", "0", "300"]);
  });

  it("el +$ sigue a las opciones al mover el grupo entero", () => {
    renderForm(CON_PRECIOS);

    fireEvent.click(btn("Subir el grupo Postre"));

    expect(optionOrder()).toEqual(["Flan", "Agua", "Cerveza"]);
    expect(precios()).toEqual(["300", "0", "500"]);
  });

  it("mover un componente suelto se ve en pantalla, no sólo en los datos", () => {
    // Este era el peor caso del bug: los inputs de texto no se movían, así que
    // ▲/▼ parecía no hacer nada mientras el array sí se reordenaba. Editando
    // "el de arriba" se le pisaba el nombre a otro componente.
    const texto = (label: string): AdminDailyMenuComponent => ({
      id: `t-${label}`,
      label,
      description: null,
      sort_order: sortOrder++,
      kind: "text",
      product_id: null,
      choice_group_id: null,
      choice_group_label: null,
      product_name: null,
      product_image_url: null,
      extra_price_cents: 0,
      blocks_choice_group_ids: [],
    });
    renderForm(menuCon([texto("Entrada"), texto("Principal"), texto("Postre")]));
    const textos = () =>
      screen
        .getAllByPlaceholderText("Milanesa con puré")
        .map((el) => (el as HTMLInputElement).value);
    expect(textos()).toEqual(["Entrada", "Principal", "Postre"]);

    fireEvent.click(btn("Bajar el componente Entrada"));

    expect(textos()).toEqual(["Principal", "Entrada", "Postre"]);
  });

  it("el nombre del grupo sigue a su tarjeta", () => {
    renderForm(CON_PRECIOS);
    fireEvent.click(btn("Subir el grupo Postre"));
    const labels = screen
      .getAllByPlaceholderText("Ej: Bebida")
      .map((el) => (el as HTMLInputElement).value);
    expect(labels).toEqual(["Postre", "Bebida"]);
  });
});

describe("editor del menú del día · agregar una opción (spec 076)", () => {
  it("la nueva opción queda pegada a su grupo, no al final del menú", () => {
    renderForm();
    // Un botón «Opción» por grupo; el primero es el de Entrada.
    fireEvent.click(screen.getAllByRole("button", { name: "Opción" })[0]);

    expect(optionOrder()).toEqual([
      "Empanadas",
      "Provoleta",
      "sin producto", // la nueva, dentro de Entrada
      "Milanesa",
      "Ravioles",
      "Flan",
    ]);
  });
});

describe("editor del menú del día · borrar un grupo (spec 076)", () => {
  it("pide confirmación diciendo cuántas opciones se lleva", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    renderForm();

    fireEvent.click(btn("Borrar el grupo Entrada"));

    expect(confirm).toHaveBeenCalledWith(
      "¿Borrar el grupo «Entrada» y sus 2 opciones?",
    );
    // Con una sola opción la frase cambia: «y sus 1 opción» no se dice.
    // Canceló: no se borró nada.
    expect(cardOrder()).toEqual(["grupo Entrada", "grupo Principal", "grupo Postre"]);
  });

  it("con una sola opción, la frase no dice «sus 1 opción»", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    renderForm(menuCon([option(GRUPO.postre, "Postre", "Flan")]));

    fireEvent.click(btn("Borrar el grupo Postre"));

    expect(confirm).toHaveBeenCalledWith(
      "¿Borrar el grupo «Postre» y su única opción?",
    );
  });

  it("confirmando, se lleva el grupo entero", () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderForm();

    fireEvent.click(btn("Borrar el grupo Principal"));

    expect(cardOrder()).toEqual(["grupo Entrada", "grupo Postre"]);
    expect(screen.queryByDisplayValue("Principal")).toBeNull();
  });
});

describe("editor del menú del día · la condición vive en el grupo (spec 087)", () => {
  /**
   * Antes esto era una grilla de casillas «Lleva X» repartidas por opción: para
   * decir «los ravioles no llevan guarnición» había que destildar una casilla
   * en cada plato. Ahora es una regla, en el grupo, y en positivo.
   */
  const CON_GRUPOS = menuCon([
    option(GRUPO.principal, "Principal", "Milanesa"),
    option(GRUPO.principal, "Principal", "Ravioles"),
    option(GRUPO.postre, "Guarnición", "Papas"),
  ]);

  it("ya no hay casillas «Lleva X» en las opciones", () => {
    renderForm(CON_GRUPOS);
    expect(screen.queryAllByLabelText(/^Lleva /)).toHaveLength(0);
  });

  it("el primer grupo no tiene de quién depender, así que no pregunta nada", () => {
    renderForm(CON_GRUPOS);
    // Un solo bloque de condición: el de Guarnición, que sí tiene uno anterior.
    expect(screen.getAllByText("¿Cuándo aparece este grupo?")).toHaveLength(1);
  });

  it("un grupo posterior puede depender del anterior, eligiendo qué opciones lo habilitan", () => {
    renderForm(CON_GRUPOS);
    expect(screen.getByRole("radio", { name: "Siempre" })).toBeChecked();

    fireEvent.click(screen.getByRole("radio", { name: "Sólo si en" }));

    // Arranca con todas tildadas: el encargado destilda las pocas que no lo
    // llevan, que es como piensa el caso real.
    expect(screen.getByRole("checkbox", { name: "Milanesa" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Ravioles" })).toBeChecked();

    fireEvent.click(screen.getByRole("checkbox", { name: "Ravioles" }));
    expect(screen.getByRole("checkbox", { name: "Ravioles" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Milanesa" })).toBeChecked();
  });

  it("el selector sólo ofrece grupos anteriores", () => {
    renderForm(CON_GRUPOS);
    fireEvent.click(screen.getByRole("radio", { name: "Sólo si en" }));
    const select = screen.getByRole("combobox", {
      name: /Grupo del que depende/,
    });
    expect(
      Array.from(select.querySelectorAll("option")).map((o) => o.textContent),
    ).toEqual(["Principal"]);
  });

  it("avisa si la condición deja al grupo sin ninguna opción que lo habilite", () => {
    renderForm(CON_GRUPOS);
    fireEvent.click(screen.getByRole("radio", { name: "Sólo si en" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Milanesa" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Ravioles" }));
    expect(screen.getByText(/no va a aparecer nunca/)).toBeTruthy();
  });
});
