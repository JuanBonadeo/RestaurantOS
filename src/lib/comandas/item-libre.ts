import type { BusinessRole } from "@/lib/admin/context";
import { canCargarItemLibre } from "@/lib/permissions/can";

/**
 * Spec 174 — el renglón libre, el «no existe» de MaxiRest.
 *
 * Nombre y precio tipeados en el momento, sin producto de catálogo detrás: la
 * torta que trajo el cliente, el pescado del día que nadie cargó, el menú que
 * se le factura al sanatorio a fin de mes.
 *
 * Módulo puro por la misma razón que [`price-override.ts`](./price-override.ts):
 * las dos piezas —el gate y la fila que se escribe— tienen que comportarse
 * igual en los tres caminos de escritura (`enviarComanda` para la mesa,
 * `persistOrder` para el pedido sin mesa y para la venta de mostrador).
 * Duplicarlas es cómo se termina con un camino que no chequea el rol.
 *
 * La diferencia con el override de la 069: allá el encargado cambia **el
 * precio** de un producto que existe y por eso debe un motivo; acá escribe el
 * renglón entero, y el nombre —que es lo que va a leer el cliente en el
 * ticket— *es* la explicación. Por eso no pide motivo aparte.
 */

/** Lo que manda el cliente para un renglón libre. */
export type ItemLibreInput = {
  name: string;
  unit_price_cents: number;
  quantity: number;
  notes?: string | null;
};

/** Ya validado y normalizado (nombre recortado). */
export type ItemLibre = {
  name: string;
  unit_price_cents: number;
  quantity: number;
  notes: string | null;
};

export type ItemLibreValidation =
  | { ok: true; libre: ItemLibre }
  | { ok: false; error: string };

export const ITEM_LIBRE_ROL_ERROR =
  "Solo un encargado puede cargar un artículo que no está en la carta.";

/** Tope del nombre, igual que el schema Zod: lo que entra en un renglón de ticket. */
const NOMBRE_MAX = 80;

/**
 * Valida el renglón contra el rol y normaliza el nombre.
 *
 * El gate corre server-side y no sólo escondiendo la UI: el que tipea nombre y
 * precio a mano está fijando plata, y una action que confía en que el botón no
 * se ve es una action sin permiso.
 *
 * Sin tope de precio, igual que el override de la 069 — $0 es válido (la
 * cortesía que igual se lista en el ticket) y quedar por encima de cualquier
 * precio de la carta también.
 */
export function validateItemLibre(
  input: ItemLibreInput,
  role: BusinessRole,
): ItemLibreValidation {
  if (!canCargarItemLibre(role)) {
    return { ok: false, error: ITEM_LIBRE_ROL_ERROR };
  }

  const name = (input.name ?? "").trim();
  if (name.length === 0) {
    return { ok: false, error: "Poné un nombre para el artículo." };
  }
  if (name.length > NOMBRE_MAX) {
    return {
      ok: false,
      error: `El nombre no puede pasar de ${NOMBRE_MAX} caracteres.`,
    };
  }

  const cents = input.unit_price_cents;
  if (!Number.isInteger(cents) || cents < 0) {
    return {
      ok: false,
      error: "El precio tiene que ser un monto válido (sin centavos partidos).",
    };
  }

  const qty = input.quantity;
  if (!Number.isInteger(qty) || qty < 1 || qty > 99) {
    return { ok: false, error: "La cantidad tiene que ser un número de 1 a 99." };
  }

  const notes = typeof input.notes === "string" ? input.notes.trim() : "";
  return {
    ok: true,
    libre: {
      name,
      unit_price_cents: cents,
      quantity: qty,
      notes: notes.length > 0 ? notes : null,
    },
  };
}

/** La fila de `order_items` de un renglón libre. */
export type ItemLibreRow = {
  order_id: string;
  product_id: null;
  product_name: string;
  unit_price_cents: number;
  quantity: number;
  subtotal_cents: number;
  notes: string | null;
  station_id: null;
  kitchen_status: "delivered";
  loaded_by: string | null;
};

/**
 * Arma la fila. Cero migraciones: `order_items.product_id` es nullable desde la
 * `0020` y el pedido flash ya escribe así.
 *
 * `station_id: null` + `kitchen_status: 'delivered'` no es una excepción nueva
 * — es la regla que ya aplican `enviarComanda` y `routeOrderToCocina` desde el
 * issue #189: lo que no va a cocina no espera a cocina. Dejarlo `pending`
 * sería una cola que nadie va a marcar nunca.
 */
export function buildItemLibreRow(
  libre: ItemLibre | ItemLibreInput,
  ctx: { orderId: string; userId: string | null },
): ItemLibreRow {
  const name = libre.name.trim();
  const notes =
    typeof libre.notes === "string" && libre.notes.trim().length > 0
      ? libre.notes.trim()
      : null;
  return {
    order_id: ctx.orderId,
    product_id: null,
    product_name: name,
    unit_price_cents: libre.unit_price_cents,
    quantity: libre.quantity,
    subtotal_cents: libre.unit_price_cents * libre.quantity,
    notes,
    station_id: null,
    kitchen_status: "delivered",
    loaded_by: ctx.userId,
  };
}
