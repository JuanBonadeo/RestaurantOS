"use client";

import { useEffect, useState } from "react";

import {
  loadPedirCatalog,
  type PedirCatalogBundle,
} from "@/lib/mozo/pedir-panel-data";

/**
 * El catálogo del negocio, cacheado en el dispositivo (spec 105).
 *
 * La pantalla de "pedir" recibía el bundle entero en el payload RSC de **cada
 * apertura de mesa**: ~195 kB de JSON (414 productos + 301 modifiers con sus
 * grupos anidados, más menús del día y top) viajando desde Virginia al teléfono
 * del mozo, con el wifi del club, treinta veces por turno. Y es data
 * business-level: no cambia entre mesa y mesa.
 *
 * Dos niveles de cache:
 * - **Módulo** (`enMemoria`): sobrevive a las navegaciones SPA, que es el caso
 *   normal —el mozo va y viene entre el plano y las mesas sin recargar—.
 * - **`localStorage`**: sobrevive a un reload de la tablet. Se guarda con
 *   `guardadoEn` para no servir algo de ayer.
 *
 * Se pinta al instante con lo cacheado y, si pasó la ventana de revalidación,
 * se re-pide en background y se re-hidrata solo. Dentro de la ventana no sale
 * ni un byte: abrir la mesa 12 del turno no vuelve a descargar el catálogo.
 *
 * **Por qué es seguro para la plata:** un catálogo viejo puede *mostrar* un
 * precio desactualizado, nunca cobrarlo. `enviarComanda` resuelve el precio en
 * el server leyendo `products.price_cents`; el cliente sólo manda
 * `product_id` / `quantity` / `modifier_ids`. Y si el producto se apagó, la
 * action lo rechaza con un mensaje explícito en vez de dejar pasar la venta.
 */

/** Más viejo que esto, lo cacheado no se usa: un turno entero, y no más. */
const TTL_MS = 12 * 60 * 60 * 1000;

/**
 * Cada cuánto se revalida. Con lo cacheado más fresco que esto no se pide nada:
 * es lo que hace que abrir la mesa 12 del turno no descargue el catálogo de
 * nuevo, que es el punto de la spec. La ventana la banca el server: si un
 * producto se apagó en el medio, `enviarComanda` lo rechaza igual.
 */
const REVALIDAR_CADA_MS = 5 * 60 * 1000;

type Guardado = { guardadoEn: number; bundle: PedirCatalogBundle };

/** Cache a nivel módulo, por slug. Vive lo que vive la pestaña. */
const enMemoria = new Map<string, Guardado>();

const claveStorage = (slug: string) => `pedir-catalog:${slug}`;

function leerDelStorage(slug: string): Guardado | null {
  try {
    const raw = localStorage.getItem(claveStorage(slug));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Guardado;
    if (!parsed?.bundle || typeof parsed.guardadoEn !== "number") return null;
    if (Date.now() - parsed.guardadoEn > TTL_MS) return null;
    return parsed;
  } catch {
    // Storage lleno, incógnito, o un JSON de una versión vieja del bundle.
    return null;
  }
}

function guardar(slug: string, bundle: PedirCatalogBundle) {
  const payload: Guardado = { guardadoEn: Date.now(), bundle };
  enMemoria.set(slug, payload);
  try {
    localStorage.setItem(claveStorage(slug), JSON.stringify(payload));
  } catch {
    // El catálogo son ~195 kB y el límite ronda los 5 MB, pero si el storage
    // está lleno igual queda el cache de memoria: la sesión funciona.
  }
}

/** El bundle del negocio y, si no hay nada que pintar todavía, el error. */
export function useCatalogBundle(slug: string): {
  bundle: PedirCatalogBundle | null;
  error: string | null;
} {
  // El estado inicial NO mira `localStorage`: el render del server y el primer
  // render del cliente tienen que coincidir. Lo cacheado se aplica en el effect
  // (misma política que `useStickyFilter`).
  const [bundle, setBundle] = useState<PedirCatalogBundle | null>(
    enMemoria.get(slug)?.bundle ?? null,
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelado = false;

    // 1) Pintar ya con lo que haya (memoria primero, storage después).
    const cacheado = enMemoria.get(slug) ?? leerDelStorage(slug);
    if (cacheado) {
      enMemoria.set(slug, cacheado);
      setBundle(cacheado.bundle);
      // 2) Y si es reciente, no se pide nada: abrir la mesa 12 del turno no
      // vuelve a descargar el catálogo.
      if (Date.now() - cacheado.guardadoEn < REVALIDAR_CADA_MS) return;
    }

    // 3) Revalidación en background (o carga inicial si no había nada).
    void loadPedirCatalog(slug)
      .then((res) => {
        if (cancelado) return;
        if (res.ok) {
          guardar(slug, res.data);
          setBundle(res.data);
          setError(null);
        } else if (!cacheado) {
          // Sólo se muestra el error si no hay nada que pintar: con cache, un
          // fallo de red es un refresh de fondo que no molesta a nadie.
          setError(res.error);
        }
      })
      .catch(() => {
        if (!cancelado && !cacheado) {
          setError("No pudimos cargar el menú. Revisá la conexión.");
        }
      });

    return () => {
      cancelado = true;
    };
  }, [slug]);

  return { bundle, error };
}
