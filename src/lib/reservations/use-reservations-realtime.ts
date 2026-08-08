"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

/**
 * Reservas en vivo (spec 059). Suscripción realtime a `reservations` de un
 * negocio: cualquier alta/cambio (reserva nueva desde la web, el chatbot u otro
 * encargado; sentar, cancelar, asignar mesa) avisa al caller.
 *
 * Igual que `useTablesRealtime`: con `onChange` el caller decide qué recargar
 * (un refetch de su tab); sin `onChange` cae al `router.refresh()` histórico,
 * que en `/admin/operacion` re-ejecuta las 7 promesas de tab. Acá sí filtramos
 * server-side por `business_id` (la tabla lo tiene). Migración `0023` sumó
 * `reservations` a la publicación `supabase_realtime`.
 */
export function useReservationsRealtime({
  businessId,
  onChange,
}: {
  businessId: string;
  /** Sin esto se refresca la ruta entera (comportamiento histórico). */
  onChange?: () => void;
}) {
  const router = useRouter();
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

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
        if (!cancelled) {
          if (onChangeRef.current) onChangeRef.current();
          else router.refresh();
        }
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
