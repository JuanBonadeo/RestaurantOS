"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";

/**
 * Tab activa en la URL **sin pegarle al servidor** (spec 101).
 *
 * El shell de `/admin/operacion` conmutaba de tab con `router.replace('?tab=…')`.
 * Eso es una navegación soft de Next: con la ruta en `force-dynamic` y sin
 * `staleTimes`, cada click re-ejecutaba el Server Component completo —
 * `getBusiness` + `ensureAdminAccess` (hop de red a Auth) + las 7 promesas de
 * tab, ~29-35 queries— y, por correr dentro de una transición, React mantenía
 * la pantalla vieja sin skeleton: el click "no hacía nada" hasta que volvía el
 * servidor.
 *
 * Acá la tab es **estado de cliente** y la URL se escribe con la History API
 * nativa, que Next parchea para que `useSearchParams` / `usePathname` se
 * enteren **sin request RSC**.
 *
 * Contrato:
 * - El valor inicial sale de la URL (deep-links tipo `?tab=caja` siguen
 *   funcionando) y se lee **una sola vez**, en el initializer del `useState`:
 *   corre igual en el render del server y en la hidratación → sin mismatch.
 * - Se usa `replaceState` y no `pushState` a propósito: es lo que hacía
 *   `router.replace`, así que el botón "atrás" se comporta igual que antes
 *   (sale del operativo, no recorre tabs).
 * - El fallback **borra** el parámetro en vez de escribirlo, para que la URL
 *   canónica de la tab default quede limpia.
 * - Los params se releen de `window.location.search` en cada cambio, así no se
 *   pisan otros parámetros de la misma ruta (ej. el `?date=` de Reservas).
 *
 * @param param nombre del search param (ej. `"tab"`).
 * @param fallback tab default, la que no escribe parámetro.
 * @param options valores válidos; cualquier otra cosa cae al fallback.
 */
export function useTabParam<T extends string>(
  param: string,
  fallback: T,
  options: readonly T[],
): [T, (next: T) => void] {
  const searchParams = useSearchParams();

  const raw = searchParams.get(param);
  const fromUrl: T =
    raw && (options as readonly string[]).includes(raw) ? (raw as T) : fallback;

  const [active, setActive] = useState<T>(fromUrl);

  // Reconciliar con la URL cuando cambia **desde afuera**: `/admin/cajas`
  // redirige a `?tab=caja`, la campana de notificaciones linkea a `?tab=…` y el
  // cobro vuelve al operativo igual. Con el shell ya montado esas navegaciones
  // no re-crean el estado, así que sin este effect el link no cambiaría de tab
  // (era gratis antes, cuando `active` se derivaba de la URL en cada render).
  // No pelea con nuestro propio `replaceState`: Next lo parchea para actualizar
  // `useSearchParams`, así que el effect ve el valor que acabamos de escribir y
  // no hace nada.
  useEffect(() => {
    setActive(fromUrl);
  }, [fromUrl]);

  const choose = useCallback(
    (next: T) => {
      setActive(next);
      if (typeof window === "undefined") return;
      const params = new URLSearchParams(window.location.search);
      if (next === fallback) params.delete(param);
      else params.set(param, next);
      const qs = params.toString();
      window.history.replaceState(
        null,
        "",
        qs ? `?${qs}` : window.location.pathname,
      );
    },
    [param, fallback],
  );

  return [active, choose];
}

/**
 * Corre `fn` cuando un panel pasa de **oculto a visible**.
 *
 * Con las tabs en keep-alive (spec 101) el panel ya no se remonta al volver a
 * él, así que la promesa RSC con la que se seedeó queda **congelada al
 * page-load**. Esta es la guarda de frescura: cada tab revalida lo suyo al
 * activarse, sin re-correr la página entera.
 *
 * Por default el montaje queda excluido, porque ahí el panel recién pintó datos
 * del server. Pero **ojo con dónde se llama**, que es lo que decide si cubre la
 * primera entrada a una tab:
 *
 * - Desde el shell (siempre montado): `active` transiciona false→true también la
 *   primera vez, así que el default alcanza.
 * - Desde un panel de **montaje lazy**: el panel monta ya visible, así que el
 *   default se come justo la entrada que más importa. Ahí va `onMount: true`, y
 *   sólo cuando el panel montó lazy — si es la tab con la que abrió la página,
 *   el server la acaba de renderizar y refetchear sería tirar plata.
 */
export function useOnActivate(
  active: boolean,
  fn: () => void,
  { onMount = false }: { onMount?: boolean } = {},
) {
  const wasActive = useRef(onMount ? false : active);
  // Ref para no re-correr el effect cuando el caller pasa una lambda nueva en
  // cada render (el disparador es el cambio de `active`, nada más).
  const fnRef = useRef(fn);
  fnRef.current = fn;

  useEffect(() => {
    if (active && !wasActive.current) fnRef.current();
    wasActive.current = active;
  }, [active]);
}
