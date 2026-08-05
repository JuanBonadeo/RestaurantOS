import { NextResponse } from "next/server";

import { reconcilePendingInvoices } from "@/lib/afip/reconcile";

// Cierre de las facturas `pending` contra el gateway ARCA (spec 088 · #140).
// Lo dispara `pg_cron` vía `pg_net` cada 2 minutos (migración 0037), o se
// puede curl-ear a mano. Protegido por `CRON_SECRET` (Bearer). Fail-closed:
// sin secreto configurado, el endpoint queda cerrado.
//
// El barrido es idempotente: el UPDATE de cada factura lleva
// `.eq("status","pending")`, así que dos ticks solapados no la cierran dos
// veces ni pisan al poller de la pantalla.
export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "cron not configured" },
      { status: 503 },
    );
  }

  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const result = await reconcilePendingInvoices();
  return NextResponse.json({ ok: true, ...result });
}

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// Un tick puede consultar hasta 25 facturas contra el gateway; el default de
// la cuenta no alcanza si el gateway está lento.
export const maxDuration = 60;
