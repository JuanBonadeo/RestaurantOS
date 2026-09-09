import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
const { updateDailyMenuMock } = vi.hoisted(() => ({
  updateDailyMenuMock: vi.fn(async () => ({ ok: true, data: { id: "m1" } })),
}));
vi.mock("@/lib/daily-menus/daily-menu-actions", () => ({
  createDailyMenu: async () => ({ ok: true, data: { id: "m1" } }),
  updateDailyMenu: updateDailyMenuMock,
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import { DailyMenuForm } from "./daily-menu-form";
import type {
  AdminDailyMenu,
  AdminDailyMenuComponent,
} from "@/lib/admin/daily-menu-query";
import type { ProductModifierGroup } from "@/lib/daily-menus/daily-menu-modifiers";

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
let componentSeq = 200;
/** Un uuid de verdad: el schema los valida y hay un test que llega a guardar. */
const uuidN = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function option(
  groupId: string,
  groupLabel: string,
  name: string,
  extraCents = 0,
  modifierGroups: ProductModifierGroup[] = [],
  ignoredModifierGroupIds: string[] = [],
): AdminDailyMenuComponent {
  return {
    id: uuidN(componentSeq++),
    label: name,
    description: null,
    sort_order: sortOrder++,
    kind: "choice",
    product_id: uuidN(productSeq++),
    choice_group_id: groupId,
    choice_group_label: groupLabel,
    product_name: name,
    product_image_url: null,
    extra_price_cents: extraCents,
    product_modifier_groups: modifierGroups,
    ignored_modifier_group_ids: ignoredModifierGroupIds,
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
    option(GRUPO.entrada, "Bebida", "Agua", 0),
    option(GRUPO.entrada, "Bebida", "Cerveza", 50000),
    option(GRUPO.principal, "Postre", "Flan", 30000),
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
      product_modifier_groups: [],
      ignored_modifier_group_ids: [],
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

describe("editor del menú del día · los modificadores del producto (spec 148)", () => {
  /**
   * La spec 083 hace que el asistente pregunte los modificadores del producto
   * elegido dentro del combo. El editor no lo mostraba en ninguna parte: se
   * elegía «Milanesa» sin saber que arrastra su propia «Guarnición», y si el
   * menú además tenía un grupo «Guarnicion», el asistente preguntaba dos veces.
   * Eso se descubría en el salón, en hora pico — le pasó a la encargada de Golf.
   */
  const mg = (
    name: string,
    is_required = false,
    sort_order = 0,
  ): ProductModifierGroup => ({
    id: `mg-${name}`,
    name,
    is_required,
    sort_order,
  });

  it("lista los grupos que el producto va a preguntar, con si son obligatorios", () => {
    renderForm(
      menuCon([
        option(GRUPO.principal, "Principal", "Ñoquis", 0, [
          mg("Salsa para pasta", true),
        ]),
      ]),
    );

    expect(
      screen.getByText(/el asistente va a preguntar además/),
    ).toBeTruthy();
    expect(screen.getByText("Salsa para pasta")).toBeTruthy();
    expect(screen.getByText("(obligatoria)")).toBeTruthy();
  });

  it("un producto sin modificadores no agrega ruido", () => {
    renderForm(menuCon([option(GRUPO.principal, "Principal", "Flan")]));
    expect(screen.queryByText(/va a preguntar además/)).toBeNull();
  });

  it("la doble pregunta se avisa —con tildes distintas— y el menú se guarda igual", async () => {
    updateDailyMenuMock.mockClear();
    // El caso exacto de golf-jcr: el combo pregunta «Guarnicion» y la Milanesa
    // trae «Guarnición».
    renderForm(
      menuCon([
        option(GRUPO.principal, "Principal", "Milanesa", 0, [
          mg("Guarnición", true),
        ]),
        option(GRUPO.postre, "Guarnicion", "Papas"),
      ]),
    );

    expect(screen.getByText(/se pregunta dos veces/)).toBeTruthy();
    expect(
      screen.getByText(/El combo ya pregunta «Guarnicion»/),
    ).toBeTruthy();

    // D2: es un aviso, no un bloqueo.
    fireEvent.click(btn("Guardar"));
    await waitFor(() => expect(updateDailyMenuMock).toHaveBeenCalled());
  });

  it("el caso legítimo se lista como información, no como conflicto", () => {
    // El Puré trae «Variante» dentro de un grupo «Guarnición»: es exactamente
    // lo que la spec 083 quería, y no tiene que dar conflicto.
    renderForm(
      menuCon([
        option(GRUPO.principal, "Principal", "Milanesa"),
        option(GRUPO.postre, "Guarnición", "Puré", 0, [mg("Variante")]),
      ]),
    );

    expect(screen.getByText("Variante")).toBeTruthy();
    expect(screen.getByText("(opcional)")).toBeTruthy();
    expect(screen.queryByText(/se pregunta dos veces/)).toBeNull();
  });

  it("en el selector de disparadores, el producto que ya pregunta lo mismo queda marcado", () => {
    renderForm(
      menuCon([
        option(GRUPO.principal, "Principal", "Milanesa", 0, [
          mg("Guarnición", true),
        ]),
        option(GRUPO.principal, "Principal", "Ravioles"),
        option(GRUPO.postre, "Guarnicion", "Papas"),
      ]),
    );

    fireEvent.click(screen.getByRole("radio", { name: "Sólo si en" }));

    // Es donde se comete el error: se marcan 12 disparadores y tres ya traen
    // su propia guarnición.
    expect(
      screen.getByRole("checkbox", { name: /Milanesa.*ya pregunta «Guarnición»/ }),
    ).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: "Ravioles" })).toBeTruthy();
  });

  it("en un componente fijo dice que el asistente NO los pregunta", () => {
    // La spec 083 dejó los fijos explícitamente fuera: la Milanesa fija con
    // «Punto de cocción» obligatorio no lo pregunta. Mostrarlo con el texto de
    // las opciones sería mentir.
    const fijo: AdminDailyMenuComponent = {
      id: "fijo-1",
      label: "Principal",
      description: null,
      sort_order: sortOrder++,
      kind: "product",
      product_id: uuid(7),
      choice_group_id: null,
      choice_group_label: null,
      product_name: "Milanesa",
      product_image_url: null,
      extra_price_cents: 0,
      product_modifier_groups: [mg("Punto de cocción", true)],
      ignored_modifier_group_ids: [],
    };
    renderForm(menuCon([fijo]));

    expect(
      screen.getByText(/al ser un componente fijo el asistente no los pregunta/),
    ).toBeTruthy();
    expect(screen.getByText("Punto de cocción")).toBeTruthy();
  });
});

describe("editor del menú del día · apagar un grupo del producto (spec 175)", () => {
  /**
   * La 148 mostró lo que el producto arrastra; ésta le pone el interruptor.
   * El caso es el de golf-jcr: el menú pregunta la guarnición con un
   * `choice_group` —cuyas opciones son productos, y por eso el Puré puede
   * preguntar su «Variante»— y la Milanesa arrastra la suya, que es una lista
   * de hojas. Apagando la del producto queda el camino bueno.
   */
  const mg = (
    name: string,
    is_required = false,
    sort_order = 0,
  ): ProductModifierGroup => ({
    id: `mg-${name}`,
    name,
    is_required,
    sort_order,
  });

  const casilla = (nombre: string) =>
    screen.getByRole("checkbox", {
      name: new RegExp(`preguntar «${nombre}»`, "i"),
    }) as HTMLInputElement;

  it("cada grupo trae su casilla, tildada por defecto", () => {
    renderForm(
      menuCon([
        option(GRUPO.principal, "Principal", "Milanesa", 0, [
          mg("Guarnición"),
          mg("Punto de cocción", true, 1),
        ]),
      ]),
    );
    expect(casilla("Guarnición").checked).toBe(true);
    expect(casilla("Punto de cocción").checked).toBe(true);
  });

  it("arranca destildada la que el menú ya tenía apagada", () => {
    renderForm(
      menuCon([
        option(
          GRUPO.principal,
          "Principal",
          "Milanesa",
          0,
          [mg("Guarnición"), mg("Punto de cocción", true, 1)],
          ["mg-Guarnición"],
        ),
      ]),
    );
    expect(casilla("Guarnición").checked).toBe(false);
    expect(casilla("Punto de cocción").checked).toBe(true);
  });

  it("destildar apaga el grupo y baja el aviso de que se pregunta dos veces", () => {
    renderForm(
      menuCon([
        // El grupo del menú se llama «Guarnicion» y el del producto
        // «Guarnición»: mismo concepto, distinta tilde (el caso real).
        option(GRUPO.principal, "Guarnicion", "Milanesa", 0, [mg("Guarnición")]),
      ]),
    );
    expect(screen.getByText(/se pregunta dos veces/)).toBeTruthy();

    fireEvent.click(casilla("Guarnición"));

    expect(casilla("Guarnición").checked).toBe(false);
    expect(screen.queryByText(/se pregunta dos veces/)).toBeNull();
  });

  it("un componente fijo no ofrece casilla: no abre pasos que apagar", () => {
    const fijo: AdminDailyMenuComponent = {
      id: uuidN(componentSeq++),
      label: "Principal",
      description: null,
      sort_order: sortOrder++,
      kind: "product",
      product_id: uuidN(productSeq++),
      choice_group_id: null,
      choice_group_label: null,
      product_name: "Milanesa",
      product_image_url: null,
      extra_price_cents: 0,
      product_modifier_groups: [mg("Punto de cocción", true)],
      ignored_modifier_group_ids: [],
    };
    renderForm(menuCon([fijo]));
    expect(screen.queryByRole("checkbox", { name: /preguntar/i })).toBeNull();
  });
});
