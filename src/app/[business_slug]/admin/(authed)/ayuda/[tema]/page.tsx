import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ChevronRight, CircleAlert, CornerDownRight, Star, TriangleAlert } from "lucide-react";

import { Captura } from "../captura";

import { PageShell } from "@/components/admin/shell/page-shell";
import { ensureAdminAccess } from "@/lib/admin/context";
import { marcarLeidoYSeguir } from "@/lib/ayuda/actions";
import {
  estaEscrito,
  loomEmbedSrc,
  pasosDe,
  temaPorSlug,
  temaSiguiente,
  type Aviso,
  type Video,
} from "@/lib/ayuda/contenido";
import { getTemasLeidos, rolDeLaGuia } from "@/lib/ayuda/queries";
import { posicionEnRecorrido, progresoDelRecorrido } from "@/lib/ayuda/recorrido";
import { getReservationSettings } from "@/lib/reservations/queries";
import type { ReservationMode } from "@/lib/reservations/types";
import { getBusiness } from "@/lib/tenant";

import { H1, H2, PAGINA, PAGINA_TEXTO, PROSA, SECUNDARIO, TEXTO } from "../estilos";

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
      className={`mt-5 flex max-w-[68ch] items-start gap-3 rounded-xl p-4 ring-1 ${
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
      className={`mt-8 rounded-2xl bg-white p-6 ring-1 ring-zinc-200/70 sm:p-7 ${TEXTO}`}
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

/**
 * El video del tema — spec 134 D21.
 *
 * `loading="lazy"`: el iframe de Loom trae su propio player y no tiene que
 * pesar en una guía que se abre para leer dos frases. Y va ARRIBA de los pasos
 * pero nunca en lugar de ellos: abajo está todo escrito.
 */
function VideoDelTema({ video }: { video: Video }) {
  const src = loomEmbedSrc(video.url);
  if (!src) return null;
  return (
    <figure className="mt-8 max-w-[900px]">
      <div className="relative w-full overflow-hidden rounded-2xl bg-zinc-900 pt-[56.25%] ring-1 ring-zinc-200">
        <iframe
          src={src}
          title={video.titulo}
          loading="lazy"
          allowFullScreen
          className="absolute inset-0 size-full"
        />
      </div>
      <figcaption className={`mt-2 ${SECUNDARIO}`}>
        {video.titulo}
        {video.duracion ? ` · ${video.duracion}` : ""} · abajo está todo escrito.
      </figcaption>
    </figure>
  );
}

/**
 * La barra del recorrido — spec 169 · D1 y D3.
 *
 * Dice dónde está («3 de 9») y ofrece la puerta de salida en la misma línea. Lo
 * segundo no es una concesión: sin salida visible, un recorrido de nueve pasos
 * el primer día se siente como un trámite obligatorio, y lo que se hace con un
 * trámite obligatorio es apretar *siguiente* hasta el final sin leer.
 *
 * Sólo se pinta mientras el recorrido esté a medias. Terminado, un tema es un
 * tema y no el paso de nada.
 */
function BarraRecorrido({
  indice,
  total,
  salir,
}: {
  indice: number;
  total: number;
  salir: string;
}) {
  // Lo COMPLETADO, que es lo de antes de este tema: recién cuando lo termine y
  // apriete el botón del pie, la barra avanza. Marcarlo lleno al abrirlo sería
  // contar como leído algo que todavía no leyó.
  const pct = Math.round(((indice - 1) / total) * 100);
  return (
    <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-3 rounded-2xl bg-white p-4 ring-1 ring-zinc-200/70 sm:p-5">
      <div className="min-w-[220px] flex-1">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-[17px] font-semibold text-zinc-900">
            Arrancá por acá
          </span>
          <span className="text-[17px] leading-[1.6] text-zinc-600">
            {indice} de {total}
          </span>
        </div>
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={indice - 1}
          aria-label={`Tema ${indice} de ${total} de la guía`}
          className="mt-2 h-2 w-full overflow-hidden rounded-full bg-zinc-200"
        >
          <div
            className="h-full rounded-full transition-[width]"
            style={{ width: `${pct}%`, background: "var(--brand)" }}
          />
        </div>
      </div>
      <Link
        href={salir}
        className="inline-flex min-h-12 items-center text-[17px] font-medium text-zinc-600 underline underline-offset-4 transition hover:text-zinc-900"
      >
        Salir de la guía
      </Link>
    </div>
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

  // Spec 169 — el rol decide si este tema es parte de SU recorrido, y las
  // lecturas dicen si el recorrido sigue abierto. Las dos consultas salen del
  // mismo request que ya hace el layout, así que no agregan viaje.
  const ctx = await ensureAdminAccess(business.id, business_slug);
  const rol = rolDeLaGuia(ctx);
  const leidos = await getTemasLeidos(business.id, ctx.userId);
  const progreso = progresoDelRecorrido(rol, modo, leidos);
  const posicion = posicionEnRecorrido(tema.slug, rol, modo);
  const enRecorrido = posicion !== null && !progreso.completo;

  const base = `/${business_slug}/admin/ayuda`;
  const pasos = pasosDe(tema, modo);
  const siguiente = temaSiguiente(tema.slug, modo);
  // Un catálogo se escanea; una secuencia se sigue. Ver TipoTema.
  const catalogo = tema.tipo === "catalogo";

  // La página se hizo ancha para que entren las capturas (D20). En un tema que
  // no tiene ninguna, ese ancho no compra nada: deja el texto contra la
  // izquierda con media pantalla vacía al lado. Ahí se vuelve a una medida
  // centrada, que es lo que corresponde a una página de puro texto.
  const conCapturas = pasos.some((paso) => Boolean(paso.imagen));

  return (
    <PageShell width="wide" className="px-4 py-10 sm:px-8 lg:px-12 lg:py-14">
      <div className={conCapturas ? PAGINA : PAGINA_TEXTO}>
        <Link
          href={base}
          className="inline-flex min-h-12 items-center gap-2 text-[17px] font-medium text-zinc-600 transition hover:text-zinc-900"
        >
          <ArrowLeft className="size-5" strokeWidth={1.75} /> Volver a Ayuda
        </Link>

        {enRecorrido && posicion && (
          <BarraRecorrido
            indice={posicion.indice}
            total={posicion.total}
            salir={`/${business_slug}/admin`}
          />
        )}

        <h1 className={`mt-2 ${H1} ${TEXTO}`}>{tema.titulo}</h1>
        <p className={`mt-3 ${SECUNDARIO} ${TEXTO}`}>{tema.resumen}</p>

        {tema.claves.length > 0 && <Claves claves={tema.claves} />}

        {tema.video && <VideoDelTema video={tema.video} />}

        {estaEscrito(tema, modo) ? (
          <ol
            className={
              catalogo
                ? "mt-10 space-y-8 lg:columns-2 lg:gap-10 lg:space-y-0 [&>li]:break-inside-avoid lg:[&>li]:mb-8"
                : "mt-12 space-y-12 lg:space-y-16"
            }
          >
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
                    className="grid size-11 shrink-0 place-items-center rounded-full text-[19px] font-semibold"
                    style={{
                      background: "var(--brand)",
                      color: "var(--brand-foreground)",
                    }}
                  >
                    {i + 1}
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  {/* El ancho de lectura va en cada pieza de TEXTO, no en el
                      contenedor: así la captura de abajo usa la página entera
                      (D20). Ver el comentario de `estilos.ts`. */}
                  <h2 className={`${H2} ${TEXTO}`}>{paso.titulo}</h2>
                  <p className={`mt-2 ${PROSA} ${TEXTO}`}>{paso.texto}</p>
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
          <div className={`mt-8 rounded-2xl bg-zinc-50 p-6 ring-1 ring-zinc-200/70 ${TEXTO}`}>
            <p className={PROSA}>
              Este tema todavía no está escrito. Mientras tanto preguntanos — y decinos
              qué necesitabas, así lo escribimos primero.
            </p>
          </div>
        )}

        {/* El botón del pie es lo único que marca un tema como leído (D5), y por
            eso es un form y no un Link: un GET no puede escribir. Sin JS
            hidratado igual funciona, que en el celular del salón importa.

            La etiqueta cambia con el lugar: adentro del recorrido nombra el
            paso que sigue, y en el último cierra. Afuera del recorrido queda
            como estaba — la guía también se lee salteada. */}
        {(posicion || siguiente) && (
          <div className="mt-16 border-t border-zinc-200 pt-8">
            <form action={marcarLeidoYSeguir.bind(null, business_slug, tema.slug)}>
              <button
                type="submit"
                className="inline-flex min-h-12 items-center gap-2 rounded-xl px-5 text-[17px] font-medium"
                style={{
                  background: "var(--brand)",
                  color: "var(--brand-foreground)",
                }}
              >
                {posicion
                  ? posicion.siguiente
                    ? `Listo, seguir con: ${posicion.siguiente.titulo}`
                    : "Listo, terminé la guía"
                  : `Seguir con: ${siguiente?.titulo ?? "la guía"}`}
                <ChevronRight className="size-5" strokeWidth={1.75} />
              </button>
            </form>
          </div>
        )}
      </div>
    </PageShell>
  );
}

export const dynamic = "force-dynamic";
