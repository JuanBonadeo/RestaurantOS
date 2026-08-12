"use client";

import { useCallback, useEffect, useState } from "react";

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

/**
 * Vacía el cache de módulo. **Sólo para tests.**
 *
 * Vive lo que vive la pestaña, que en producción es exactamente lo que se
 * busca, pero en un archivo de tests significa que un caso que cargó el
 * catálogo se lo deja puesto al siguiente: el que quería probar "el catálogo
 * nunca llega" se encontraba con el panel montado, y el orden de los casos
 * pasaba a ser load-bearing.
 */
export function limpiarCacheDeCatalogo() {
  enMemoria.clear();
}

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

/**
 * El bundle del negocio, el error si no hay nada que pintar, y un reintento.
 *
 * `recargar` existe porque el effect corre **una vez por montaje** y hay
 * pantallas que viven un turno entero sin remontarse —el panel del salón, desde
 * el keep-alive de la spec 101—. Sin él, un solo fallo de red al abrir la
 * pantalla dejaba al encargado sin poder cargar pedidos hasta que recargara la
 * página, y nada se lo decía (spec 114).
 */
export function useCatalogBundle(slug: string): {
  bundle: PedirCatalogBundle | null;
  error: string | null;
  recargar: () => void;
} {
  // El estado inicial NO mira `localStorage`: el render del server y el primer
  // render del cliente tienen que coincidir. Lo cacheado se aplica en el effect
  // (misma política que `useStickyFilter`).
  const [bundle, setBundle] = useState<PedirCatalogBundle | null>(
    enMemoria.get(slug)?.bundle ?? null,
  );
  const [error, setError] = useState<string | null>(null);
  const [intento, setIntento] = useState(0);

  useEffect(() => {
    let cancelado = false;
    // En un reintento no se respeta la ventana de revalidación: si lo cacheado
    // es reciente pero está roto, saltearla dejaría el reintento sin efecto.
    const forzado = intento > 0;

    // 1) Pintar ya con lo que haya (memoria primero, storage después).
    const cacheado = enMemoria.get(slug) ?? leerDelStorage(slug);
    if (cacheado) {
      enMemoria.set(slug, cacheado);
      setBundle(cacheado.bundle);
      // 2) Y si es reciente, no se pide nada: abrir la mesa 12 del turno no
      // vuelve a descargar el catálogo.
      if (!forzado && Date.now() - cacheado.guardadoEn < REVALIDAR_CADA_MS) return;
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
  }, [slug, intento]);

  // Limpia el error antes de volar: mientras se re-pide se ve el skeleton, no
  // el mensaje viejo.
  const recargar = useCallback(() => {
    setError(null);
    setIntento((n) => n + 1);
  }, []);

  return { bundle, error, recargar };
}
