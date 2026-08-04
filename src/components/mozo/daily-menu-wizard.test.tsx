import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { DailyMenuWizard } from "./daily-menu-wizard";
import type {
  DailyMenuComponent,
  DailyMenuForMozo,
} from "@/lib/mozo/daily-menus-query";

/**
 * Recorrido de teclado del asistente del menú del día (spec 072).
 *
 * Cubre los criterios de aceptación 1-6: se entra con la primera opción
 * enfocada, ↓/↑ mueven, Enter y los dígitos eligen y avanzan, ← vuelve con lo
 * elegido marcado, y el paso final agrega con la misma forma de
 * `selected_choices` que consumía el modal viejo.
 */

let sortOrder = 0;

function option(
  groupId: string,
  label: string,
  i: number,
  extra = 0,
  blocks: string[] = [],
): DailyMenuComponent {
  return {
    id: `${groupId}-opt-${i}`,
    label: `${label} ${i}`,
    description: null,
    kind: "choice",
    product_id: `${groupId}-prod-${i}`,
    product_name: `${label} ${i}`,
    choice_group_id: groupId,
    choice_group_label: label,
    extra_price_cents: extra,
    blocks_choice_group_ids: blocks,
    sort_order: sortOrder++,
    modifier_groups: [],
  };
}

const entradas = [
  option("g1", "Entrada", 1),
  option("g1", "Entrada", 2),
  option("g1", "Entrada", 3),
];
const principales = [
  option("g2", "Principal", 1),
  option("g2", "Principal", 2, 150000),
];

const MENU: DailyMenuForMozo = {
  id: "m1",
  name: "Menú ejecutivo",
  description: null,
  price_cents: 1000000,
  image_url: null,
  components: [
    {
      id: "fijo",
      label: "Bebida",
      description: null,
      kind: "product",
      product_id: "p-agua",
      product_name: "Agua 500ml",
      choice_group_id: null,
      choice_group_label: null,
      extra_price_cents: 0,
      blocks_choice_group_ids: [],
      sort_order: 0,
      modifier_groups: [],
    },
    ...entradas,
    ...principales,
  ],
  choice_groups: [
    { choice_group_id: "g1", label: "Entrada", options: entradas },
    { choice_group_id: "g2", label: "Principal", options: principales },
  ],
  has_choices: true,
};

function renderWizard(menu: DailyMenuForMozo = MENU) {
  const onAdd = vi.fn();
  const onClose = vi.fn();
  render(
    <DailyMenuWizard menu={menu} onAdd={onAdd} onClose={onClose} embedded />,
  );
  return { onAdd, onClose };
}

const focused = () => document.activeElement as HTMLElement;

async function expectFocusOn(name: RegExp) {
  await waitFor(() => expect(focused()).toHaveAccessibleName(name));
}

describe("asistente del menú del día · teclado (spec 072)", () => {
  it("abre en el primer grupo, con la primera opción enfocada", async () => {
    renderWizard();
    expect(screen.getByRole("radiogroup", { name: "Entrada" })).toBeTruthy();
    // El principal todavía no se muestra: un paso, una decisión.
    expect(screen.queryByRole("radiogroup", { name: "Principal" })).toBeNull();
    await expectFocusOn(/Entrada 1/);
  });

  it("↓ ↓ Enter elige la tercera entrada y pasa al principal", async () => {
    renderWizard();
    await expectFocusOn(/Entrada 1/);

    fireEvent.keyDown(focused(), { key: "ArrowDown" });
    await expectFocusOn(/Entrada 2/);
    fireEvent.keyDown(focused(), { key: "ArrowDown" });
    await expectFocusOn(/Entrada 3/);

    fireEvent.keyDown(focused(), { key: "Enter" });
    await expectFocusOn(/Principal 1/);
    expect(screen.getByRole("radiogroup", { name: "Principal" })).toBeTruthy();
  });

  it("↑ no se pasa del primero (clamp, sin wrap-around)", async () => {
    renderWizard();
    await expectFocusOn(/Entrada 1/);
    fireEvent.keyDown(focused(), { key: "ArrowUp" });
    await expectFocusOn(/Entrada 1/);
  });

  it("un dígito elige esa opción y avanza sin pasar por las flechas", async () => {
    renderWizard();
    await expectFocusOn(/Entrada 1/);
    fireEvent.keyDown(focused(), { key: "2" });
    await expectFocusOn(/Principal 1/);
  });

  it("← vuelve al paso anterior con lo elegido enfocado y marcado", async () => {
    renderWizard();
    await expectFocusOn(/Entrada 1/);
    fireEvent.keyDown(focused(), { key: "3" }); // elige Entrada 3 → Principal
    await expectFocusOn(/Principal 1/);

    fireEvent.keyDown(focused(), { key: "ArrowLeft" });
    await expectFocusOn(/Entrada 3/);
    expect(focused()).toHaveAttribute("aria-checked", "true");
  });

  it("al resolver el último grupo llega al paso final con «Agregar» enfocado", async () => {
    renderWizard();
    await expectFocusOn(/Entrada 1/);
    fireEvent.keyDown(focused(), { key: "1" });
    await expectFocusOn(/Principal 1/);
    fireEvent.keyDown(focused(), { key: "1" });
    await expectFocusOn(/Agregar/);
  });

  it("en el paso final, + sube la cantidad y Enter agrega el menú", async () => {
    const { onAdd } = renderWizard();
    await expectFocusOn(/Entrada 1/);
    fireEvent.keyDown(focused(), { key: "2" }); // Entrada 2
    await expectFocusOn(/Principal 1/);
    fireEvent.keyDown(focused(), { key: "2" }); // Principal 2 (+$1500)
    await expectFocusOn(/Agregar/);

    fireEvent.keyDown(focused(), { key: "+" });
    // Total = (10000 + 1500) * 2 en pesos, mostrado en el botón.
    await waitFor(() => expect(focused()).toHaveAccessibleName(/23\.000/));

    fireEvent.click(focused()); // lo que hace Enter sobre el botón enfocado
    expect(onAdd).toHaveBeenCalledTimes(1);
    const [menu, quantity, choices] = onAdd.mock.calls[0];
    expect(menu.id).toBe("m1");
    expect(quantity).toBe(2);
    expect(choices).toEqual([
      expect.objectContaining({
        choice_group_id: "g1",
        product_id: "g1-prod-2",
        extra_price_cents: 0,
      }),
      expect.objectContaining({
        choice_group_id: "g2",
        product_id: "g2-prod-2",
        extra_price_cents: 150000,
      }),
    ]);
  });

  it("desde el paso final se puede cambiar una elección y se vuelve derecho ahí", async () => {
    renderWizard();
    await expectFocusOn(/Entrada 1/);
    fireEvent.keyDown(focused(), { key: "1" });
    await expectFocusOn(/Principal 1/);
    fireEvent.keyDown(focused(), { key: "1" });
    await expectFocusOn(/Agregar/);

    fireEvent.click(screen.getByRole("button", { name: /Entrada.*cambiar/i }));
    await expectFocusOn(/Entrada 1/);
    fireEvent.keyDown(focused(), { key: "3" });
    // No repite el paso del principal: vuelve al final.
    await expectFocusOn(/Agregar/);
  });

  it("un menú sin grupos de opciones abre directo en el paso final", async () => {
    const sinOpciones: DailyMenuForMozo = {
      ...MENU,
      components: [MENU.components[0]!],
      choice_groups: [],
      has_choices: false,
    };
    renderWizard(sinOpciones);
    await expectFocusOn(/Agregar/);
    expect(screen.getByText("Agua 500ml", { exact: false })).toBeTruthy();
  });

  it("Esc cierra el asistente", async () => {
    const { onClose } = renderWizard();
    await expectFocusOn(/Entrada 1/);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });
});

describe("asistente del menú del día · grupos condicionados (spec 074)", () => {
  /**
   * Principal + Guarnición + Postre, donde «Principal 2» (los ravioles) no
   * lleva guarnición. La guarnición tiene adicional para poder verificar que
   * descartarla también descuenta la plata.
   */
  function menuConGuarnicion(): DailyMenuForMozo {
    const principales = [
      option("gp", "Principal", 1),
      option("gp", "Principal", 2, 0, ["gg"]),
    ];
    const guarniciones = [
      option("gg", "Guarnición", 1, 300000),
      option("gg", "Guarnición", 2),
    ];
    const postres = [option("gd", "Postre", 1)];
    return {
      id: "m-cond",
      name: "Menú con guarnición",
      description: null,
      price_cents: 1000000,
      image_url: null,
      components: [...principales, ...guarniciones, ...postres],
      choice_groups: [
        { choice_group_id: "gp", label: "Principal", options: principales },
        { choice_group_id: "gg", label: "Guarnición", options: guarniciones },
        { choice_group_id: "gd", label: "Postre", options: postres },
      ],
      has_choices: true,
    };
  }

  it("elegir el plato que no lleva guarnición saltea ese paso (FR-003)", async () => {
    renderWizard(menuConGuarnicion());
    await expectFocusOn(/Principal 1/);
    expect(screen.getByText(/Paso 1 de 4/)).toBeTruthy();

    // «Principal 2» bloquea la guarnición: el paso siguiente es el postre.
    fireEvent.keyDown(focused(), { key: "2" });
    await expectFocusOn(/Postre 1/);
    expect(screen.getByText(/Paso 2 de 3/)).toBeTruthy();
  });

  it("el plato que sí la lleva conserva el paso", async () => {
    renderWizard(menuConGuarnicion());
    await expectFocusOn(/Principal 1/);
    fireEvent.keyDown(focused(), { key: "1" });
    await expectFocusOn(/Guarnición 1/);
    expect(screen.getByText(/Paso 2 de 4/)).toBeTruthy();
  });

  it("cambiar a un plato sin guarnición descarta la ya elegida y su adicional (FR-004)", async () => {
    const { onAdd } = renderWizard(menuConGuarnicion());
    await expectFocusOn(/Principal 1/);
    fireEvent.keyDown(focused(), { key: "1" });
    await expectFocusOn(/Guarnición 1/);
    fireEvent.keyDown(focused(), { key: "1" }); // la de +$3.000
    await expectFocusOn(/Postre 1/);
    fireEvent.keyDown(focused(), { key: "1" });
    await expectFocusOn(/Agregar/);
    expect(screen.getByRole("button", { name: /Agregar/ }).textContent).toContain(
      "13.000",
    );

    // Volver al principal y pasarse a los ravioles.
    fireEvent.click(screen.getByRole("button", { name: /Principal.*cambiar/i }));
    await expectFocusOn(/Principal 1/);
    fireEvent.keyDown(focused(), { key: "2" });
    await expectFocusOn(/Agregar/);

    // La guarnición no está ni en el resumen ni en el total (FR-007).
    expect(screen.queryByRole("button", { name: /Guarnición.*cambiar/i })).toBeNull();
    expect(screen.getByRole("button", { name: /Agregar/ }).textContent).toContain(
      "10.000",
    );

    fireEvent.click(screen.getByRole("button", { name: /Agregar/ }));
    const choices = onAdd.mock.calls[0]![2];
    expect(choices.map((c: { choice_group_id: string }) => c.choice_group_id)).toEqual([
      "gp",
      "gd",
    ]);
  });

  it("volver al plato original hace reaparecer el paso, vacío", async () => {
    renderWizard(menuConGuarnicion());
    await expectFocusOn(/Principal 1/);
    fireEvent.keyDown(focused(), { key: "2" }); // ravioles → sin guarnición
    await expectFocusOn(/Postre 1/);

    fireEvent.keyDown(focused(), { key: "ArrowLeft" });
    await expectFocusOn(/Principal 2/);
    fireEvent.keyDown(focused(), { key: "1" }); // vuelve al que sí la lleva
    await expectFocusOn(/Guarnición 1/);
    expect(screen.getByText(/Paso 2 de 4/)).toBeTruthy();
  });
});
