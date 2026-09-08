import { config } from "dotenv";

/**
 * Los E2E escriben: cobran mesas, cierran cajas, anulan pagos. Contra la nube
 * eso deja basura permanente en el negocio `demo` —que comparte base con
 * `golf-jcr` y `kcc`— y puede pisar lo que alguien esté mirando en vivo.
 *
 * Por eso la suite se niega a arrancar si el entorno no es local.
 *
 * **Se mira `.env.local` y sólo `.env.local`**, aunque los tests de integración
 * usen `.env.test`. Motivo: acá el que habla con la base es la app que maneja el
 * browser, y Next lee `.env.local`. Un `.env.test` apuntando al stack local no
 * prueba nada si el server que estás manejando está pegado a la nube — la
 * guarda daría verde y los tests escribirían en producción.
 */
export function assertStackLocal(): { url: string; serviceKey: string } {
  config({ path: ".env.local" });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

  if (!url || !serviceKey) {
    throw new Error(
      "Faltan NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY en .env.local.\n" +
        "Levantá el stack local: pnpm setup:local",
    );
  }

  const esLocal = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?/.test(url);
  if (!esLocal) {
    throw new Error(
      `Los E2E sólo corren contra el stack LOCAL, y .env.local apunta a:\n  ${url}\n\n` +
        "Cambiá con `pnpm env:local` (o `pnpm setup:local` la primera vez).\n" +
        "Contra la nube los tests dejarían basura en demo, que comparte base con golf-jcr y kcc.",
    );
  }

  return { url, serviceKey };
}
