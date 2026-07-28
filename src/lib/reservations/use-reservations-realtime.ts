"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

/**
 * Reservas en vivo (spec 059). Suscripción realtime a `reservations` de un
 * negocio: cualquier alta/cambio (reserva nueva desde la web, el chatbot u otro
 * encargado; sentar, cancelar, asignar mesa) invalida la página vía
 * `router.refresh()`.
 *
 * Mismo patrón que `useTablesRealtime`, pero acá sí filtramos server-side por
 * `business_id` (la tabla lo tiene). Migración `0023` sumó `reservations` a la
 * publicación `supabase_realtime`.
 */
export function useReservationsRealtime({ businessId }: { businessId: string }) {
  const router = useRouter();

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let cancelled = false;
    let pendingRefresh: ReturnType<typeof setTimeout> | null = null;

    // Debounce: una carga puede disparar varios eventos seguidos (INSERT de la
    // reserva + UPDATE al sentarla). Un solo refresh los cubre.
    const scheduleRefresh = () => {
      if (pendingRefresh) clearTimeout(pendingRefresh);
      pendingRefresh = setTimeout(() => {
        if (!cancelled) router.refresh();
        pendingRefresh = null;
      }, 200);
    };

    (async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (cancelled) return;
      if (session?.access_token) {
        await supabase.realtime.setAuth(session.access_token);
      }
      if (cancelled) return;

      channel = supabase
        .channel(`reservations:${businessId}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "reservations",
            filter: `business_id=eq.${businessId}`,
          },
          () => scheduleRefresh(),
        )
        .subscribe();
    })();

    return () => {
      cancelled = true;
      if (pendingRefresh) clearTimeout(pendingRefresh);
      if (channel) supabase.removeChannel(channel);
    };
  }, [businessId, router]);
}
