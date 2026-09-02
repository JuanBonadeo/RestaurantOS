import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ChevronRight, CircleAlert, CornerDownRight, Star, TriangleAlert } from "lucide-react";

import { Captura } from "../captura";

import { PageShell } from "@/components/admin/shell/page-shell";
import {
  estaEscrito,
  pasosDe,
  temaPorSlug,
  temaSiguiente,
  type Aviso,
} from "@/lib/ayuda/contenido";
import { getReservationSettings } from "@/lib/reservations/queries";
import type { ReservationMode } from "@/lib/reservations/types";
import { getBusiness } from "@/lib/tenant";

import { ANCHO, H1, H2, PROSA, SECUNDARIO } from "../estilos";

// Un tema de la guía — spec 134 (RestaurantOS-Brain#35).
//
// TODO desplegado: sin acordeones, sin "leer más", sin pestañas (D3). Plegar
// contenido ahorra scroll y cuesta comprensión; acá el scroll es gratis y la
// comprensión es todo el punto.

export async function generateMetadata({
  params,
}: {
  params: Promise<{ tema: string }>;
}) {
  const { tema } = await params;
  return { title: temaPorSlug(tema)?.titulo ?? "Ayuda" };
}

// 'ojo' = tenelo en cuenta · 'peligro' = si lo hacés mal se cobra dos veces, se
// acepta una caja que no cierra, o se anula algo sin registro. El rojo se
// reserva para eso y no se gasta en advertencias menores.
function AvisoBox({ aviso }: { aviso: Aviso }) {
  const peligro = aviso.tono === "peligro";
  const Icono = peligro ? TriangleAlert : CircleAlert;
  return (
    <div
      className={`mt-4 flex items-start gap-3 rounded-xl p-4 ring-1 ${
        peligro
          ? "bg-red-50 text-red-900 ring-red-200"
          : "bg-amber-50 text-amber-900 ring-amber-200"
      }`}
    >
      <Icono className="mt-0.5 size-[22px] shrink-0" strokeWidth={1.75} />
      <p className="text-[18px] font-medium leading-[1.6]">{aviso.texto}</p>
    </div>
  );
}

/**
 * «Lo importante» — spec 134. Va arriba de todo y antes de los pasos.
 *
 * El tema se leyó entero una vez, el día que lo abriste con calma. Las otras
 * veces se entra con el salón lleno, se mira cinco segundos y se sale. Esas
 * veces esto es lo único que se lee, así que acá va el límite de lo que la
 * persona puede hacer sola y lo que sale caro si se hace mal — no un resumen.
 */
function Claves({ claves }: { claves: string[] }) {
  return (
    <section
      className="mt-6 rounded-2xl bg-white p-5 ring-1 ring-zinc-200/70"
      aria-labelledby="lo-importante"
    >
      <h2
        id="lo-importante"
        className="flex items-center gap-2 text-[15px] font-semibold uppercase tracking-[0.12em] text-zinc-500"
      >
        <Star className="size-4" strokeWidth={2} style={{ color: "var(--brand)" }} />
        Lo importante
      </h2>
      <ul className="mt-3 space-y-2.5">
        {claves.map((c) => (
          <li key={c} className={`flex gap-3 ${PROSA}`}>
            <span
              aria-hidden
              className="mt-[0.6em] size-1.5 shrink-0 rounded-full"
              style={{ background: "var(--brand)" }}
            />
            <span>{c}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default async function TemaPage({
  params,
}: {
  params: Promise<{ business_slug: string; tema: string }>;
}) {
  const { business_slug, tema: slug } = await params;
  const business = await getBusiness(business_slug);
  if (!business) notFound();

  const tema = temaPorSlug(slug);
  if (!tema) notFound();

  // D12 — el modo del negocio decide qué pasos se muestran. Se lee de la
  // config, no se le pregunta al lector "¿tu local usa reservas flexibles?".
  const settings = await getReservationSettings(business.id);
  const modo: ReservationMode = settings.mode ?? "estricto";

  const base = `/${business_slug}/admin/ayuda`;
  const pasos = pasosDe(tema, modo);
  const siguiente = temaSiguiente(tema.slug, modo);
  // Un catálogo se escanea; una secuencia se sigue. Ver TipoTema.
  const catalogo = tema.tipo === "catalogo";

  return (
    <PageShell width="narrow">
      <div className={ANCHO}>
        <Link
          href={base}
          className="inline-flex min-h-12 items-center gap-2 text-[17px] font-medium text-zinc-600 transition hover:text-zinc-900"
        >
          <ArrowLeft className="size-5" strokeWidth={1.75} /> Volver a Ayuda
        </Link>

        <h1 className={`mt-2 ${H1}`}>{tema.titulo}</h1>
        <p className={`mt-2 ${SECUNDARIO}`}>{tema.resumen}</p>

        {tema.claves.length > 0 && <Claves claves={tema.claves} />}

        {estaEscrito(tema, modo) ? (
          <ol className={catalogo ? "mt-8 space-y-7" : "mt-8 space-y-8"}>
            {pasos.map((paso, i) => (
              <li
                key={paso.titulo}
                className={
                  catalogo
                    ? "border-l-4 pl-4"
                    : "flex items-start gap-4"
                }
                style={catalogo ? { borderColor: "var(--brand)" } : undefined}
              >
                {!catalogo && (
                  <span
                    className="grid size-10 shrink-0 place-items-center rounded-full text-[18px] font-semibold"
                    style={{
                      background: "var(--brand)",
                      color: "var(--brand-foreground)",
                    }}
                  >
                    {i + 1}
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <h2 className={H2}>{paso.titulo}</h2>
                  <p className={`mt-2 ${PROSA}`}>{paso.texto}</p>
                  {paso.imagen && (
                    <Captura
                      src={paso.imagen}
                      alt={paso.alt ?? ""}
                      marcas={paso.marcas}
                    />
                  )}
                  {paso.aviso && <AvisoBox aviso={paso.aviso} />}
                  {paso.verTambien && (
                    <Link
                      href={`${base}/${paso.verTambien.tema}`}
                      className="mt-3 inline-flex min-h-12 items-center gap-2 text-[18px] font-medium text-zinc-900 underline underline-offset-4 transition hover:text-zinc-600"
                    >
                      <CornerDownRight className="size-5" strokeWidth={1.75} />{" "}
                      {paso.verTambien.texto}
                    </Link>
                  )}
                </div>
              </li>
            ))}
          </ol>
        ) : (
          // Se llega acá tipeando la URL: el índice no enlaza un tema vacío.
          <div className="mt-8 rounded-2xl bg-zinc-50 p-6 ring-1 ring-zinc-200/70">
            <p className={PROSA}>
              Este tema todavía no está escrito. Mientras tanto preguntanos — y decinos
              qué necesitabas, así lo escribimos primero.
            </p>
          </div>
        )}

        {siguiente && (
          <div className="mt-12 border-t border-zinc-200 pt-6">
            <Link
              href={`${base}/${siguiente.slug}`}
              className="inline-flex min-h-12 items-center gap-2 rounded-xl px-5 text-[17px] font-medium"
              style={{
                background: "var(--brand)",
                color: "var(--brand-foreground)",
              }}
            >
              Seguir con: {siguiente.titulo}{" "}
              <ChevronRight className="size-5" strokeWidth={1.75} />
            </Link>
          </div>
        )}
      </div>
    </PageShell>
  );
}

export const dynamic = "force-dynamic";
