import { NextResponse } from "next/server";

import { expireStalePendingReservations } from "@/lib/reservations/pending-sweep";
import { sendDueReservationReminders } from "@/lib/reservations/reminders";

// Tick de reservas cada 15 min, disparado por `pg_cron` vía `pg_net` (migración
// 0011) o curl-eado a mano. Hace dos barridos:
//   - recordatorio antes del turno (spec 45)
//   - vencimiento de las solicitudes que el local nunca respondió (spec 131)
// Protegido por `CRON_SECRET` (Bearer). Fail-closed: sin secreto, cerrado.
export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "cron not configured" }, { status: 503 });
  }

  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const reminders = await sendDueReservationReminders();
  const pending = await expireStalePendingReservations();
  return NextResponse.json({ ok: true, ...reminders, pending });
}

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
