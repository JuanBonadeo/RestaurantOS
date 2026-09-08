import Link from "next/link";
import { notFound } from "next/navigation";
import { Check, ChevronRight, PartyPopper } from "lucide-react";

import { PageShell } from "@/components/admin/shell/page-shell";
import { ensureAdminAccess } from "@/lib/admin/context";
import { GRUPOS, estaEscrito } from "@/lib/ayuda/contenido";
import { getTemasLeidos, rolDeLaGuia } from "@/lib/ayuda/queries";
import { progresoDelRecorrido, temasDeRol } from "@/lib/ayuda/recorrido";
import { getReservationSettings } from "@/lib/reservations/queries";
import type { ReservationMode } from "@/lib/reservations/types";
import { getBusiness } from "@/lib/tenant";

import { Asistente } from "./asistente";

import { H1, PAGINA, PROSA, SECUNDARIO, TEXTO } from "./estilos";

// Índice de la guía — spec 134 (RestaurantOS-Brain#35), reordenado por la
// spec 169 (#255).
//
// Tarjetas grandes, una por trabajo del turno, sin buscador y sin acordeones
// (134 · D3): buscar exige saber la palabra, y el que más necesita la guía es
// justamente el que no la sabe. Un tema sin pasos escritos se muestra pero NO
// se abre (RNF-2).
//
// DOS COSAS QUE CAMBIÓ LA SPEC 169:
//
//  - **El índice se filtra por rol** (D8). El gate de sección lo hace el layout
//    de `(authed)`, pero ese gate es de puerta: `sections.ts` abrió Ayuda a
//    `mozo` y `terminal` para que la bienvenida pudiera mandarlos acá (142 ·
//    D4), y hasta esta spec caían en la guía del encargado — con sus topes de
//    autorización, que no son los de ellos.
//  - **El asistente ya no es lo primero.** Contesta muy bien al que sabe qué
//    preguntar, y el de primer ingreso no lo sabe: no tiene todavía las
//    palabras del sistema. Mismo argumento que el D3 usó contra el buscador.
//    Queda abajo de Operación, que es donde lo va a buscar el que ya conoce el
//    panel y está trabado en el mostrador.

export const metadata = { title: "Ayuda" };

export default async function AyudaIndice({
  params,
  searchParams,
}: {
  params: Promise<{ business_slug: string }>;
  searchParams: Promise<{ listo?: string }>;
}) {
  const { business_slug } = await params;
  const { listo } = await searchParams;
  const business = await getBusiness(business_slug);
  if (!business) notFound();

  // D12: el índice también depende del modo, porque de él sale si `reservas`
  // está escrito para ESTE negocio o todavía no.
  const settings = await getReservationSettings(business.id);
  const modo: ReservationMode = settings.mode ?? "estricto";

  const ctx = await ensureAdminAccess(business.id, business_slug);
  const rol = rolDeLaGuia(ctx);
  const mios = temasDeRol(rol);
  const leidos = await getTemasLeidos(business.id, ctx.userId);
  const progreso = progresoDelRecorrido(rol, modo, leidos);

  const base = `/${business_slug}/admin/ayuda`;

  // Todavía no hay una línea escrita para el salón (169 · D9). Se lo decimos,
  // que es mejor que darle la del encargado: ahí adentro están el tope de
  // descuento y el de diferencia de caja, y no son los suyos.
  if (mios.length === 0) {
    return (
      <PageShell width="wide" className="px-4 py-10 sm:px-8 lg:px-12 lg:py-14">
        <div className={PAGINA}>
          <h1 className={H1}>Ayuda</h1>
          <div className={`mt-6 rounded-2xl bg-white p-6 ring-1 ring-zinc-200/70 sm:p-7`}>
            <p className={`${PROSA} ${TEXTO}`}>
              La guía de tu puesto todavía se está escribiendo. Mientras tanto,
              cualquier duda preguntale a tu encargado — y contale qué te faltó,
              así lo escribimos primero.
            </p>
          </div>
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell width="wide" className="px-4 py-10 sm:px-8 lg:px-12 lg:py-14">
      <div className={PAGINA}>
        <h1 className={H1}>Ayuda</h1>
        <p className={`mt-3 ${SECUNDARIO} ${TEXTO}`}>
          Cómo se usa el panel, explicado paso a paso. Elegí un tema, o preguntá
          lo que necesités.
        </p>

        {/* El cierre del recorrido. Llega sólo desde el botón del último tema
            (`?listo=1`), no cada vez que se entra con todo leído: felicitar a
            alguien por algo que hizo la semana pasada es ruido. */}
        {listo === "1" && progreso.completo && progreso.total > 0 && (
          <div className="mt-6 flex items-start gap-4 rounded-2xl bg-white p-6 ring-1 ring-zinc-200/70 sm:p-7">
            <div
              className="grid size-12 shrink-0 place-items-center rounded-xl"
              style={{ background: "var(--brand-soft)", color: "var(--brand)" }}
            >
              <PartyPopper className="size-6" strokeWidth={1.75} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[20px] font-semibold leading-snug text-zinc-900">
                Listo: eso es todo lo del turno
              </div>
              <p className={`mt-1 ${SECUNDARIO} ${TEXTO}`}>
                El resto está acá abajo, y el signo de pregunta de cada pantalla
                te trae al tema de esa pantalla. No hace falta que te lo acuerdes.
              </p>
            </div>
          </div>
        )}

        {/* Mientras el recorrido esté a medias, lo primero de la página es
            dónde retomar (169 · D4). No es un modal ni un tour con flechitas
            encima del panel: es una barra sin terminar, que pide sola que la
            terminen y se puede ignorar sin pelearse con nada. */}
        {!progreso.completo && progreso.proximo && (
          <Link
            href={`${base}/${progreso.proximo.slug}`}
            className="mt-6 flex items-center gap-4 rounded-2xl bg-white p-5 ring-1 ring-zinc-200/70 transition hover:ring-zinc-300 sm:p-6"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-[20px] font-semibold leading-snug text-zinc-900">
                  {progreso.leidos === 0
                    ? "Arrancá por acá"
                    : "Seguí donde ibas"}
                </span>
                <span className={SECUNDARIO}>
                  {progreso.leidos} de {progreso.total}
                </span>
              </div>
              <div
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={progreso.total}
                aria-valuenow={progreso.leidos}
                aria-label={`Leíste ${progreso.leidos} de ${progreso.total} temas del turno`}
                className="mt-2.5 h-2 w-full overflow-hidden rounded-full bg-zinc-200"
              >
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${Math.round((progreso.leidos / progreso.total) * 100)}%`,
                    background: "var(--brand)",
                  }}
                />
              </div>
              <div className={`mt-2.5 ${SECUNDARIO}`}>
                Sigue: {progreso.proximo.titulo}
              </div>
            </div>
            <ChevronRight
              className="size-[22px] shrink-0 text-zinc-400"
              strokeWidth={1.75}
            />
          </Link>
        )}

        {/* Agrupado y no una tira de dieciséis tarjetas iguales: con esta
            cantidad, una lista plana obliga a leerlas todas para encontrar una.
            Los grupos van de lo que se hace hoy a lo que se abre cuando algo se
            rompió. Un grupo sin temas escritos no se pinta. */}
        {GRUPOS.map((grupo) => {
          const temas = mios.filter((t) => t.grupo === grupo.id);
          if (temas.length === 0) return null;

          return (
            <div key={grupo.id}>
              <section className="mt-12 lg:mt-16">
                <h2 className="text-[24px] font-semibold leading-snug text-zinc-900 sm:text-[26px]">
                  {grupo.titulo}
                </h2>
                <p className={`mt-1.5 ${SECUNDARIO} ${TEXTO}`}>{grupo.bajada}</p>

                {/* Dos columnas desde `lg`: con diecinueve temas, una sola tira
                    obliga a scrollear la guía entera para ver qué hay. En dos, el
                    índice entra casi de una sola mirada. */}
                <div className="mt-5 grid gap-4 lg:grid-cols-2">
                  {temas.map((tema) => {
                    const Icono = tema.icono;
                    const listoTema = estaEscrito(tema, modo);
                    const leido = leidos.has(tema.slug);
                    // La etiqueta "En preparación" va DEBAJO del texto y no al
                    // costado: a 375 px robarle 110 px a la columna deja el
                    // título en dos palabras por línea. El chevron sí puede ir al
                    // costado, mide 22 px.
                    const cuerpo = (
                      <>
                        <div
                          className="grid size-12 shrink-0 place-items-center rounded-xl"
                          style={{
                            background: "var(--brand-soft)",
                            color: "var(--brand)",
                          }}
                        >
                          <Icono className="size-6" strokeWidth={1.75} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-start justify-between gap-3">
                            <div className="text-[20px] font-semibold leading-snug text-zinc-900">
                              {tema.titulo}
                            </div>
                            {listoTema && (
                              <ChevronRight
                                className="mt-0.5 size-[22px] shrink-0 text-zinc-400"
                                strokeWidth={1.75}
                              />
                            )}
                          </div>
                          <div className={`mt-1 ${SECUNDARIO}`}>{tema.resumen}</div>
                          {!listoTema && (
                            <span className="mt-2.5 inline-flex rounded-full bg-zinc-100 px-2.5 py-1 text-[14px] font-medium text-zinc-600">
                              En preparación
                            </span>
                          )}
                          {/* El tilde no premia nada: está para que se vea de
                              un vistazo qué le falta. */}
                          {listoTema && leido && (
                            <span className="mt-2.5 inline-flex items-center gap-1.5 text-[15px] font-medium text-zinc-500">
                              <Check className="size-4" strokeWidth={2.25} /> Leído
                            </span>
                          )}
                        </div>
                      </>
                    );

                    return listoTema ? (
                      <Link
                        key={tema.slug}
                        href={`${base}/${tema.slug}`}
                        className="flex items-start gap-4 rounded-2xl bg-white p-5 ring-1 ring-zinc-200/70 transition hover:ring-zinc-300 sm:p-6"
                      >
                        {cuerpo}
                      </Link>
                    ) : (
                      <div
                        key={tema.slug}
                        className="flex items-start gap-4 rounded-2xl bg-white p-5 opacity-70 ring-1 ring-zinc-200/70 sm:p-6"
                      >
                        {cuerpo}
                      </div>
                    );
                  })}
                </div>
              </section>

              {/* Acá abajo, y no arriba de todo (169 · D7). */}
              {grupo.id === "operacion" && (
                <div className="mt-12 lg:mt-16">
                  <Asistente slug={business_slug} />
                </div>
              )}
            </div>
          );
        })}

        <p className={`mt-14 ${PROSA} ${TEXTO}`}>
          ¿No encontrás lo que buscás? Preguntanos — y contanos qué te faltó, así lo
          agregamos acá.
        </p>
      </div>
    </PageShell>
  );
}

export const dynamic = "force-dynamic";
