// Regenera los fixtures congelados del ticket de comanda.
//
//   pnpm tsx scripts/freeze-ticket-fixtures.ts
//
// Los fixtures (`src/lib/print/__fixtures__/tickets.json`) son la red de
// seguridad de `ticket.test.ts`: fijan los bytes exactos que se imprimen en
// golf. Correr esto SOLO cuando el formato cambia a propósito — y verificar el
// papel en el local después. Los casos son los mismos que el test.
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { buildComandaContent, type TicketComanda } from "../src/lib/print/ticket";

const base: TicketComanda = {
  comanda_id: "ab12cd34-0000-0000-0000-000000000000",
  daily_number: 123,
  station_name: "Cocina",
  table_label: "5",
  batch: 2,
  emitted_at: "2026-07-20T18:30:00-03:00",
  cancelled: false,
  cancelled_reason: null,
  reprint: false,
  items: [
    { quantity: 1, product_name: "Milanesa napolitana", modifiers: [], notes: null },
    { quantity: 2, product_name: "Ñoquis", modifiers: ["con crema"], notes: "bien calientes" },
    { quantity: 1, product_name: "Café con leche", modifiers: [], notes: null },
  ],
};

const cases: Record<string, TicketComanda> = {
  normal: base,
  anulada: { ...base, cancelled: true, cancelled_reason: "cliente se fue" },
  reimpresion: { ...base, reprint: true },
  sinItems: { ...base, items: [] },
  // Payload de un server anterior al número de pedido: el ticket cae al id de
  // la comanda, como imprimía antes.
  sinNumeroDePedido: { ...base, daily_number: null },
};

const out: Record<string, { escpos_b64: string; plain: string }> = {};
for (const [name, c] of Object.entries(cases)) out[name] = buildComandaContent(c);

// Relativo al cwd: se corre desde la raíz del repo (ver uso arriba).
const dest = resolve("src/lib/print/__fixtures__/tickets.json");
writeFileSync(dest, JSON.stringify(out, null, 2) + "\n");
console.log(`✓ ${dest}\n`);
console.log(out.normal.plain);
