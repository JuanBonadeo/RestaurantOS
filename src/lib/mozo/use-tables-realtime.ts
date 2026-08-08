"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

/**
 * Suscripción realtime a cambios en `tables` para un business.
 *
 * `tables` no tiene business_id directo (viaja via floor_plans), así que el
 * filter del canal es por floor_plan_id si lo pasás; sino traemos todos los
 * cambios y filtramos client-side por la lista de floor_plans visibles.
 *
 * **Qué hace ante un evento** (spec 102): si el caller pasa `onChange`, se le
 * avisa y él decide — típicamente un refetch acotado de su tab. Sin `onChange`
 * cae al comportamiento histórico, `router.refresh()`, que re-ejecuta la ruta
 * entera: en `/admin/operacion` eso son las 7 promesas de tab (~30 queries)
 * para actualizar el plano, y encima en **cada** evento de cualquier mozo. La
 * app del mozo sigue con el default hasta que le toque su propia tanda.
 *
 * Cierra DT-011. Migración 0040 sumó `tables` a supabase_realtime.
 */
export function useTablesRealtime({
  businessId,
  floorPlanIds,
  onChange,
}: {
  businessId: string;
  floorPlanIds: string[];
  /** Sin esto se refresca la ruta entera (comportamiento histórico). */
  onChange?: () => void;
}) {
  const router = useRouter();
  const floorPlanIdsRef = useRef(floorPlanIds);
  floorPlanIdsRef.current = floorPlanIds;
  // Ref para no re-suscribir el canal cuando el caller pasa una lambda nueva
  // en cada render (el effect sólo depende del negocio).
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let cancelled = false;
    let pendingRefresh: ReturnType<typeof setTimeout> | null = null;

    const scheduleRefresh = () => {
      // Debounce: si llegan varios eventos seguidos (ej. un walk-in
      // dispara UPDATE en tables y INSERT en tables_audit_log), un solo
      // refresh los cubre. 200 ms es imperceptible.
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
        .channel(`tables:${businessId}`)
        .on(
          "postgres_changes",
          {
            event: "UPDATE",
            schema: "public",
            table: "tables",
          },
          (payload) => {
            const row = payload.new as { floor_plan_id?: string };
            if (!row.floor_plan_id) return;
            if (!floorPlanIdsRef.current.includes(row.floor_plan_id)) return;
            scheduleRefresh();
          },
        )
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "tables",
          },
          (payload) => {
            const row = payload.new as { floor_plan_id?: string };
            if (!row.floor_plan_id) return;
            if (!floorPlanIdsRef.current.includes(row.floor_plan_id)) return;
            scheduleRefresh();
          },
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
