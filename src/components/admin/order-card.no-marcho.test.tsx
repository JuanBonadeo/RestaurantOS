/** @vitest-environment jsdom */
//
// P06 · issue #259 — «No marchó» no puede apagarse cuando más importa.
//
// El chip se calculaba sobre `isScheduledForLater(scheduled_at)`, que es
// `scheduled_at > now`: el pedido dejaba de contar como agendado **en el
// instante en que se pasaba de la hora prometida**. El de las 21:00 se ponía en
// rojo a las 20:40 y volvía a parecer normal a las 21:00 en punto — con el
// cliente en la puerta y la comida sin empezar.
//
// Es el peor tipo de falla silenciosa: la alarma existió, se apagó sola, y el
// encargado que miró la pantalla a las 21:05 no vio nada raro.
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { OrderCard } from "./order-card";

const base = {
  id: "o1",
  order_number: 12,
  daily_number: 12,
  customer_name: "Ana",
  customer_phone: "111",
  delivery_type: "pickup" as const,
  status: "confirmed",
  payment_status: "pending",
  total_cents: 15_000,
  created_at: new Date().toISOString(),
  items: [],
};

function renderCard(scheduledAt: Date) {
  return render(
    <OrderCard
      order={{ ...base, scheduled_at: scheduledAt.toISOString() } as never}
      slug="golf"
      timezone="America/Argentina/Buenos_Aires"
      onAdvance={() => {}}
    />,
  );
}

describe("OrderCard · el chip del agendado", () => {
  it("marca «No marchó» cuando ya pasó la hora de marchar", () => {
    // Hora pedida dentro de 5 min → con el lead de cocina, tenía que marchar
    // hace rato.
    renderCard(new Date(Date.now() + 5 * 60_000));
    expect(screen.getByText("No marchó")).toBeInTheDocument();
  });

  it("SIGUE marcando «No marchó» después de la hora prometida", () => {
    // Éste es el bug: a las 21:05 de un pedido de las 21:00 el chip desaparecía.
    renderCard(new Date(Date.now() - 5 * 60_000));
    expect(screen.getByText("No marchó")).toBeInTheDocument();
  });
});
