"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { CornerDownLeft, Loader2, Sparkles } from "lucide-react";

import { preguntarALaGuia } from "@/lib/ayuda/actions";
import type { Turno } from "@/lib/ayuda/asistente";
import { temaPorSlug } from "@/lib/ayuda/contenido";

import { PROSA, SECUNDARIO, TEXTO } from "./estilos";

// La caja de preguntas de la guía — spec 135 (RestaurantOS-Brain#36).
//
// Va ARRIBA del índice, no escondida en un botón flotante: preguntar tiene que
// ser lo primero que se ve al entrar a Ayuda, porque es más rápido que buscar
// entre diecinueve temas cuando uno no sabe en cuál mirar.

/** Ejemplos reales de lo que se pregunta en el mostrador. Arrancan la
 *  conversación sin obligar a escribir, que con el salón lleno es medio
 *  trámite — y de paso enseñan qué clase de cosas puede contestar. */
const EJEMPLOS = [
  "Me falta plata en la caja, ¿qué hago?",
  "¿Hasta cuánto descuento puedo hacer?",
  "No salió una comanda",
];

type Estado =
  | { fase: "inicial" }
  | { fase: "pensando"; pregunta: string }
  | { fase: "respuesta"; pregunta: string; texto: string; temas: string[] }
  | { fase: "error"; mensaje: string };

export function Asistente({ slug }: { slug: string }) {
  const [texto, setTexto] = useState("");
  const [estado, setEstado] = useState<Estado>({ fase: "inicial" });
  const [historial, setHistorial] = useState<Turno[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const preguntar = async (pregunta: string) => {
    const limpia = pregunta.trim();
    if (!limpia || estado.fase === "pensando") return;

    setTexto("");
    setEstado({ fase: "pensando", pregunta: limpia });

    const res = await preguntarALaGuia(slug, limpia, historial);

    if (!res.ok) {
      setEstado({ fase: "error", mensaje: res.error });
      return;
    }
    setEstado({
      fase: "respuesta",
      pregunta: limpia,
      texto: res.data.respuesta,
      temas: res.data.temas,
    });
    // El historial deja repreguntar («¿y si es más de eso?») sin repetir el
    // contexto. Se recorta en el server, acá sólo se acumula.
    setHistorial((h) => [
      ...h,
      { rol: "usuario", texto: limpia },
      { rol: "asistente", texto: res.data.respuesta },
    ]);
  };

  return (
    <section className="mt-8 rounded-2xl bg-white p-5 ring-1 ring-zinc-200/70 sm:p-6">
      <h2 className="flex items-center gap-2 text-[15px] font-semibold uppercase tracking-[0.12em] text-zinc-500">
        <Sparkles className="size-4" strokeWidth={2} style={{ color: "var(--brand)" }} />
        Preguntale a la guía
      </h2>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void preguntar(texto);
        }}
        className="mt-4 flex flex-col gap-2 sm:flex-row"
      >
        <input
          ref={inputRef}
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder="¿Qué necesitás hacer?"
          aria-label="Escribí tu pregunta"
          className="min-h-[52px] flex-1 rounded-xl bg-zinc-50 px-4 text-[18px] text-zinc-900 ring-1 ring-zinc-200 outline-none transition placeholder:text-zinc-500 focus:ring-2 focus:ring-zinc-400"
        />
        <button
          type="submit"
          disabled={!texto.trim() || estado.fase === "pensando"}
          className="inline-flex min-h-[52px] items-center justify-center gap-2 rounded-xl px-5 text-[17px] font-medium transition disabled:opacity-40"
          style={{ background: "var(--brand)", color: "var(--brand-foreground)" }}
        >
          {estado.fase === "pensando" ? (
            <Loader2 className="size-5 animate-spin" strokeWidth={2} />
          ) : (
            <CornerDownLeft className="size-5" strokeWidth={2} />
          )}
          Preguntar
        </button>
      </form>

      {estado.fase === "inicial" && (
        <div className="mt-3 flex flex-wrap gap-2">
          {EJEMPLOS.map((ej) => (
            <button
              key={ej}
              type="button"
              data-ayuda="ejemplo"
              onClick={() => void preguntar(ej)}
              className="min-h-[44px] rounded-full bg-zinc-100 px-4 text-[16px] text-zinc-700 transition hover:bg-zinc-200"
            >
              {ej}
            </button>
          ))}
        </div>
      )}

      {estado.fase === "pensando" && (
        <p className={`mt-4 ${SECUNDARIO}`}>Buscando en la guía…</p>
      )}

      {estado.fase === "error" && (
        <p className={`mt-4 ${PROSA} ${TEXTO}`}>{estado.mensaje}</p>
      )}

      {estado.fase === "respuesta" && (
        <div className="mt-5 border-t border-zinc-200 pt-5">
          <p className={`${SECUNDARIO} ${TEXTO}`}>{estado.pregunta}</p>
          <p className={`mt-2 ${PROSA} ${TEXTO}`}>{estado.texto}</p>

          {estado.temas.length > 0 && (
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <span className="text-[16px] text-zinc-500">Leerlo completo:</span>
              {estado.temas.map((slugTema) => {
                const tema = temaPorSlug(slugTema);
                if (!tema) return null;
                return (
                  <Link
                    key={slugTema}
                    href={`/${slug}/admin/ayuda/${slugTema}`}
                    className="inline-flex min-h-[44px] items-center rounded-full bg-zinc-100 px-4 text-[16px] font-medium text-zinc-900 transition hover:bg-zinc-200"
                  >
                    {tema.titulo}
                  </Link>
                );
              })}
            </div>
          )}

          <p className={`mt-4 text-[15px] leading-[1.5] text-zinc-500 ${TEXTO}`}>
            Contesta sólo con lo que dice esta guía. Si algo no está acá, te lo va a
            decir en vez de inventarlo — pero igual conviene chequear lo que toca plata.
          </p>
        </div>
      )}
    </section>
  );
}
