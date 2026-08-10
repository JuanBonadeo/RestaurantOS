"use client";

import dynamic from "next/dynamic";

import { Skeleton } from "@/components/ui/skeleton";

/**
 * Los tres gráficos del dashboard, fuera del bundle inicial (spec 108).
 *
 * recharts es lo más pesado del panel y sólo lo usan estas tres piezas, en la
 * pantalla a la que cae **todo el mundo** al entrar. Hacer el `dynamic` desde la
 * page no alcanza: es un Server Component, donde `ssr: false` no está permitido
 * y el chunk termina igual en la carga inicial. Por eso el wrapper es cliente.
 *
 * `ssr: false` a propósito: un gráfico no aporta nada al primer pintado —no es
 * contenido que se lea, y recharts mide el contenedor para dibujar—, así que se
 * reserva su alto con un skeleton y aparece al hidratar. Los números que
 * importan (los `StatTile`) siguen llegando pintados del server.
 *
 * Las alturas están medidas contra el render real, no estimadas: los dos donuts
 * son hermanos de una grilla `lg:grid-cols-2`, donde `align-items: stretch` los
 * lleva a ~377 px. Un `h-64` "razonable" dejaba la fila entera saltando 122 px
 * cuando llegaban.
 */

export const RevenueChart = dynamic(
  () =>
    import("@/components/admin/dashboard/revenue-chart").then(
      (m) => m.RevenueChart,
    ),
  {
    // Next exige que las opciones sean un objeto literal (no se puede factorizar).
    loading: () => <Skeleton className="h-72 w-full rounded-2xl" />,
    ssr: false,
  },
);

export const ChannelDonut = dynamic(
  () =>
    import("@/components/admin/dashboard/channel-donut").then(
      (m) => m.ChannelDonut,
    ),
  { loading: () => <Skeleton className="h-full min-h-[377px] w-full rounded-2xl" />, ssr: false },
);

export const PaymentMixDonut = dynamic(
  () =>
    import("@/components/admin/dashboard/payment-mix-donut").then(
      (m) => m.PaymentMixDonut,
    ),
  { loading: () => <Skeleton className="h-full min-h-[377px] w-full rounded-2xl" />, ssr: false },
);
