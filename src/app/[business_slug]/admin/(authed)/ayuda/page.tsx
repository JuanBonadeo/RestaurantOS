import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronRight } from "lucide-react";

import { PageShell } from "@/components/admin/shell/page-shell";
import { GRUPOS, TEMAS, estaEscrito } from "@/lib/ayuda/contenido";
import { getReservationSettings } from "@/lib/reservations/queries";
import type { ReservationMode } from "@/lib/reservations/types";
import { getBusiness } from "@/lib/tenant";

import { ANCHO, H1, PROSA, SECUNDARIO } from "./estilos";

// Índice de la guía del encargado — spec 134 (RestaurantOS-Brain#35).
//
// Tarjetas grandes, una por trabajo del turno, sin buscador y sin acordeones
// (D3): buscar exige saber la palabra, y el que más necesita la guía es
// justamente el que no la sabe. Un tema sin pasos escritos se muestra pero NO
// se abre (RNF-2).
//
// El gate de rol lo hace el layout de `(authed)`: el mozo ya está redirigido a
// /mozo antes de llegar acá, y `canSee("ayuda", …)` decide el ítem del sidebar.

export const metadata = { title: "Ayuda" };

export default async function AyudaIndice({
  params,
}: {
  params: Promise<{ business_slug: string }>;
}) {
  const { business_slug } = await params;
  const business = await getBusiness(business_slug);
  if (!business) notFound();

  // D12: el índice también depende del modo, porque de él sale si `reservas`
  // está escrito para ESTE negocio o todavía no.
  const settings = await getReservationSettings(business.id);
  const modo: ReservationMode = settings.mode ?? "estricto";

  return (
    <PageShell width="narrow">
      <div className={ANCHO}>
        <h1 className={H1}>Ayuda</h1>
        <p className={`mt-2 ${SECUNDARIO}`}>
          Cómo se usa el panel, explicado paso a paso. Elegí lo que necesitás hacer.
        </p>

        {/* Agrupado y no una tira de dieciséis tarjetas iguales: con esta
            cantidad, una lista plana obliga a leerlas todas para encontrar una.
            Los grupos van de lo que se hace hoy a lo que se abre cuando algo se
            rompió. Un grupo sin temas escritos no se pinta. */}
        {GRUPOS.map((grupo) => {
          const temas = TEMAS.filter((t) => t.grupo === grupo.id);
          if (temas.length === 0) return null;

          return (
            <section key={grupo.id} className="mt-10">
              <h2 className="text-[22px] font-semibold leading-snug text-zinc-900">
                {grupo.titulo}
              </h2>
              <p className={`mt-1 ${SECUNDARIO}`}>{grupo.bajada}</p>

              <div className="mt-4 space-y-3">
                {temas.map((tema) => {
                  const Icono = tema.icono;
                  const listo = estaEscrito(tema, modo);
                  // La etiqueta "En preparación" va DEBAJO del texto y no al
                  // costado: a 375 px robarle 110 px a la columna deja el
                  // título en dos palabras por línea. El chevron sí puede ir al
                  // costado, mide 22 px.
                  const cuerpo = (
                    <>
                      <div
                        className="grid size-12 shrink-0 place-items-center rounded-xl"
                        style={{ background: "var(--brand-soft)", color: "var(--brand)" }}
                      >
                        <Icono className="size-6" strokeWidth={1.75} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-3">
                          <div className="text-[20px] font-semibold leading-snug text-zinc-900">
                            {tema.titulo}
                          </div>
                          {listo && (
                            <ChevronRight
                              className="mt-0.5 size-[22px] shrink-0 text-zinc-400"
                              strokeWidth={1.75}
                            />
                          )}
                        </div>
                        <div className={`mt-1 ${SECUNDARIO}`}>{tema.resumen}</div>
                        {!listo && (
                          <span className="mt-2.5 inline-flex rounded-full bg-zinc-100 px-2.5 py-1 text-[14px] font-medium text-zinc-600">
                            En preparación
                          </span>
                        )}
                      </div>
                    </>
                  );

                  return listo ? (
                    <Link
                      key={tema.slug}
                      href={`/${business_slug}/admin/ayuda/${tema.slug}`}
                      className="flex items-start gap-4 rounded-2xl bg-white p-4 ring-1 ring-zinc-200/70 transition hover:ring-zinc-300 sm:p-5"
                    >
                      {cuerpo}
                    </Link>
                  ) : (
                    <div
                      key={tema.slug}
                      className="flex items-start gap-4 rounded-2xl bg-white p-4 opacity-70 ring-1 ring-zinc-200/70 sm:p-5"
                    >
                      {cuerpo}
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })}

        <p className={`mt-10 ${PROSA}`}>
          ¿No encontrás lo que buscás? Preguntanos — y contanos qué te faltó, así lo
          agregamos acá.
        </p>
      </div>
    </PageShell>
  );
}

export const dynamic = "force-dynamic";
