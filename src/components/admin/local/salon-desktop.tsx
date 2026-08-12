"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import Link from "next/link";
import {
  ArrowLeftRight,
  Ban,
  ClipboardList,
  Clock,
  Keyboard,
  MapPin,
  MoreVertical,
  MoveRight,
  Pencil,
  Receipt,
  Store,
  UserCheck,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import { toast } from "sonner";

import {
  AtajosHelp,
  type ModoPanel,
} from "@/components/admin/local/atajos-help";
import { NuevaReservaPanel } from "@/components/admin/local/nueva-reserva-panel";
import { ReservationsPanel } from "@/components/admin/local/reservations-panel";
import { SegmentedSelector } from "@/components/admin/local/segmented-selector";
import { VentaRapidaPanel } from "@/components/admin/local/venta-rapida-panel";
import { AsignarMozosPanel } from "@/components/mozo/asignar-mozos-panel";
import {
  FloorPlanViewer,
  type TableExtra,
} from "@/components/mozo/floor-plan-viewer";
import { OrderSummaryCard } from "@/components/mozo/order-summary-card";
import { TransferTableModal } from "@/components/mozo/transfer-table-modal";
import { TrasladarMesaModal } from "@/components/mozo/trasladar-mesa-modal";
import { WalkInPanel } from "@/components/mozo/walk-in-modal";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { BusinessRole } from "@/lib/admin/context";
import type { FloorPlanWithTables } from "@/lib/admin/floor-plan/queries";
import { planReservationsByTable } from "@/lib/mozo/plan-reservation";
import { tableDisplayName } from "@/lib/mozo/table-display-name";
import { MozoPedirClient } from "@/app/[business_slug]/mozo/mesa/[id]/pedir/pedir-client";
import { CobrarDesktopClient } from "@/app/[business_slug]/admin/(authed)/mesa/[id]/cobrar/cobrar-desktop-client";
import { CuentaClient } from "@/app/[business_slug]/mozo/mesa/[id]/cuenta/cuenta-client";
import {
  loadCobroForTable,
  loadCuentaForTable,
  type CobroPanelData,
  type CuentaPanelData,
} from "@/lib/billing/cobro-panel-data";
import type { TableOrderState } from "@/lib/mozo/pedir-panel-data";
import {
  DELAY_COLORS,
  tableDelay,
  type TableDelay,
} from "@/lib/comandas/mesa-demora";
import {
  anularMesa,
  assignMozoToTable,
  clearMozoAssignments,
} from "@/lib/mozo/actions";
import { tieneConsumo } from "@/lib/mozo/consumo";
import {
  groupTablesForSidebar,
  type SalonTableGroup,
} from "@/lib/mozo/salon-table-order";
import { useArrowFocus } from "@/lib/ui/use-arrow-focus";
import { useRovingList } from "@/lib/ui/use-roving-list";
import {
  loadPedirCatalog,
  loadTableComandas,
  type PedirCatalogBundle,
} from "@/lib/mozo/pedir-panel-data";
import {
  sentarReserva,
  updateReservationDetails,
} from "@/lib/reservations/booking-actions";
import { useReservationsRealtime } from "@/lib/reservations/use-reservations-realtime";
import { initialsFromName, mozoColor, mozoPalette } from "@/lib/mozo/colors";
import type { MozoMember } from "@/lib/mozo/queries";
import { type OperationalStatus } from "@/lib/mozo/state-machine";
import { useTablesRealtime } from "@/lib/mozo/use-tables-realtime";
import {
  canAssignMozo,
  canCancelItem,
  canCargarPedido,
  canMoveTable,
  canTransitionMesa,
} from "@/lib/permissions/can";
import type { FloorTable } from "@/lib/reservations/types";
import { useOnActivate } from "@/lib/ui/use-tab-param";
import { cn } from "@/lib/utils";
import { getSalonTabData } from "@/app/[business_slug]/admin/(authed)/operacion/actions";

// ─── Types compartidos con la page (server) ────────────────────────────────

export type SalonOrderRef = {
  id: string;
  order_number: number;
  table_id: string | null;
  total_cents: number;
  created_at: string;
  status: string;
  customer_name: string | null;
  items: {
    product_name: string;
    quantity: number;
    cancelled_at: string | null;
  }[];
  comandas: {
    id: string;
    batch: number;
    status: "pendiente" | "en_preparacion" | "entregado";
    station_name: string;
    emitted_at: string;
    delivered_at: string | null;
    /** Anulada (spec 049): la fila se pinta «Anulada» y pierde sus acciones. */
    cancelled_at: string | null;
    items: {
      product_name: string;
      quantity: number;
      prep_time_minutes: number | null;
    }[];
  }[];
};

export type SalonReservationRef = {
  id: string;
  table_id: string | null;
  customer_name: string;
  customer_phone: string;
  party_size: number;
  starts_at: string;
  status: string;
  notes: string | null;
};

// ─── Helpers de estado ──────────────────────────────────────────────────────

const STATUS_LABEL: Record<OperationalStatus, string> = {
  libre: "Libre",
  ocupada: "Ocupada",
  pidio_cuenta: "Pidió la cuenta",
};

const STATUS_COLORS: Record<
  OperationalStatus,
  { dot: string; bg: string; text: string }
> = {
  libre: { dot: "bg-zinc-300", bg: "bg-zinc-50", text: "text-zinc-600" },
  ocupada: {
    dot: "bg-emerald-500",
    bg: "bg-emerald-50",
    text: "text-emerald-800",
  },
  pidio_cuenta: {
    dot: "bg-amber-500",
    bg: "bg-amber-50",
    text: "text-amber-800",
  },
};

const STATS_ORDER: OperationalStatus[] = ["libre", "ocupada", "pidio_cuenta"];

function minutesSince(
  iso: string | null | undefined,
  now: number | null,
): number | null {
  // `now == null` en SSR / primer render de cliente → no mostramos tiempo,
  // para que el HTML del server y el del cliente coincidan (sin hydration
  // mismatch por Date.now()). El cliente lo completa al montar.
  if (!iso || now == null) return null;
  return Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60_000));
}

/**
 * Tiempo legible en jerga AR: "ahora", "5 min", "1h 20", "2h", "3 d".
 * Pensado para mostrar "hace cuánto que la mesa está abierta".
 *
 * Por encima de 24h pasamos a días — una mesa abierta hace 197h muestra
 * "8 d", no "197h 21".
 */
function formatRelativeTime(minutes: number | null): string | null {
  if (minutes === null) return null;
  if (minutes < 1) return "ahora";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    const rest = minutes % 60;
    return rest === 0 ? `${hours} h` : `${hours}h ${rest}`;
  }
  const days = Math.floor(hours / 24);
  return `${days} d`;
}

function formatMoney(cents: number): string {
  return `$${(cents / 100).toLocaleString("es-AR", { minimumFractionDigits: 0 })}`;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("es-AR", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

// ─── Componente principal ───────────────────────────────────────────────────

export function SalonDesktop({
  slug,
  businessId,
  floorPlans: initialFloorPlans,
  dineInOrders: initialDineInOrders,
  reservations: initialReservations,
  mozos: initialMozos,
  currentUserId,
  role,
  visiblePlanIds = [],
  distribuirOpen = false,
  onDistribuirOpen,
  onDistribuirClose,
  tabActive = true,
  refetchAlMontar = false,
  onServerData,
  onReservationsChanged,
}: {
  slug: string;
  businessId: string;
  floorPlans: FloorPlanWithTables[];
  dineInOrders: SalonOrderRef[];
  reservations: SalonReservationRef[];
  mozos: MozoMember[];
  currentUserId: string;
  role: BusinessRole;
  /** Spec 101: `false` mientras la tab Mesas está oculta (sigue montada). */
  tabActive?: boolean;
  /** `true` si el panel montó lazy (spec 103): entonces revalida al montar. */
  refetchAlMontar?: boolean;
  /**
   * Spec 102: aviso de que cambió una reserva (realtime o acción propia). El
   * salón se re-sincroniza solo; esto es para el shell, porque la tab Reservas
   * no tiene suscripción propia — la única de la app vive acá.
   */
  onReservationsChanged?: () => void;
  /** Spec 102: cada snapshot nuevo del refetch, para el badge de la tab. */
  onServerData?: (d: {
    floorPlans: FloorPlanWithTables[];
    dineInOrders: SalonOrderRef[];
    reservations: SalonReservationRef[];
    mozos: MozoMember[];
  }) => void;
  /** Spec 065: salones elegidos en el filtro del operativo. Con uno solo, el
   *  plano queda fijado ahí y el selector propio se esconde (un solo control
   *  para lo mismo). Con dos o más, el selector queda pero sólo con esos.
   *  Vacío = «Todos» → el componente se comporta como siempre. */
  visiblePlanIds?: string[];
  /** Modo "Distribuir mozos" (paint mode). El sidebar derecho muestra la
   *  paleta de mozos y el plano grande tiñe mesas por mozo + tap asigna. */
  distribuirOpen?: boolean;
  onDistribuirOpen?: () => void;
  onDistribuirClose?: () => void;
}) {
  const [pending, startTransition] = useTransition();

  // Snapshot del server de TODA la tab Mesas, seedeado una vez de los props y
  // actualizado SÓLO por `refetchSalon` (spec 102). Antes cada acción del plano
  // y cada evento de realtime hacían `router.refresh()`, que re-ejecutaba
  // `operacion/page.tsx` entera —las 7 promesas de tab, ~30 queries— y
  // remandaba el árbol RSC completo para mover una mesa. Un solo escritor → sin
  // carrera contra un re-sync de los props.
  const [serverData, setServerData] = useState({
    floorPlans: initialFloorPlans,
    dineInOrders: initialDineInOrders,
    reservations: initialReservations,
    mozos: initialMozos,
  });
  const { floorPlans, dineInOrders, reservations, mozos } = serverData;

  // Refetch de la tab. Guard de carrera por secuencia: ante ráfagas (o
  // respuestas fuera de orden) sólo se aplica la más nueva. Nunca lanza: en
  // error mantiene lo que hay — es un refresh de fondo, y un plano vacío en
  // medio del servicio es peor que uno de hace dos segundos.
  const refetchSeq = useRef(0);
  const onServerDataRef = useRef(onServerData);
  onServerDataRef.current = onServerData;
  const refetchSalon = useCallback(async () => {
    const seq = ++refetchSeq.current;
    try {
      const res = await getSalonTabData(slug);
      if (seq !== refetchSeq.current) return;
      if (res.ok) {
        setServerData(res.data);
        onServerDataRef.current?.(res.data);
      }
    } catch {
      // swallow: refresh de fondo, sin toast ni rollback.
    }
  }, [slug]);

  // Realtime via Supabase publication (DT-011 cerrada, migración 0040).
  // Cualquier UPDATE/INSERT en tables visibles refetchea la tab (ya no la ruta).
  useTablesRealtime({
    businessId,
    floorPlanIds: floorPlans.map((fp) => fp.plan.id),
    onChange: refetchSalon,
  });

  // Reservas en vivo (spec 059, migración 0023): una reserva nueva (web,
  // chatbot u otro encargado) aparece sola, sin recargar. Ésta es la ÚNICA
  // suscripción a `reservations` de la app, así que además de re-sincronizar el
  // plano hay que avisarle al shell: la tab Reservas no tiene realtime propio y
  // antes se enteraba de rebote, por el `router.refresh()` que este cambio
  // saca. Ver `onReservationsChanged`.
  const onReservationsChangedRef = useRef(onReservationsChanged);
  onReservationsChangedRef.current = onReservationsChanged;
  useReservationsRealtime({
    businessId,
    onChange: useCallback(() => {
      void refetchSalon();
      onReservationsChangedRef.current?.();
    }, [refetchSalon]),
  });

  // Volver a la tab Mesas re-sincroniza. Hace falta porque `dineInOrders` no
  // tiene realtime propio —los ítems y totales de una cuenta abierta cambian
  // desde el teléfono del mozo, sin tocar `tables`— y desde la spec 101 el
  // panel ya no se remonta al cambiar de tab.
  useOnActivate(tabActive, refetchSalon, { onMount: refetchAlMontar });

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [walkInTableId, setWalkInTableId] = useState<string | null>(null);
  // Aviso previo al walk-in sobre una mesa reservada (bloqueo blando, spec 059).
  const [walkInWarning, setWalkInWarning] = useState<{
    tableId: string;
    label: string;
    reservation: SalonReservationRef;
  } | null>(null);
  // Modo "elegir mesa para una reserva" (spec 059): el plano principal queda a
  // la espera de un tap, como el modo Distribuir mozos. Nada de modal aparte.
  const [asignarReservaFor, setAsignarReservaFor] = useState<{
    reservation: SalonReservationRef;
    /** "seat" = elegir la mesa Y sentar en un solo gesto (reserva genérica). */
    intent: "assign" | "seat";
  } | null>(null);
  const [transferTableId, setTransferTableId] = useState<string | null>(null);
  const [trasladarTableId, setTrasladarTableId] = useState<string | null>(null);
  const [anularPrompt, setAnularPrompt] = useState<{
    tableId: string;
    label: string;
  } | null>(null);
  const [anularReason, setAnularReason] = useState("");
  const [showNewReservation, setShowNewReservation] = useState(false);
  // Mesa elegida en el plano para la reserva que se está creando (spec 059).
  const [nuevaReservaTable, setNuevaReservaTable] = useState<FloorTable | null>(
    null,
  );
  const [pickingForNueva, setPickingForNueva] = useState(false);
  // Venta rápida de mostrador (spec 058): modo del sidebar, no de una mesa.
  const [ventaRapidaOpen, setVentaRapidaOpen] = useState(false);
  // Overlay optimista por mesa: patch parcial (estado / opened_at / mozo).
  // Da feedback inmediato a TODAS las acciones de mesa (abrir, walk-in, sentar
  // reserva, anular, transferir) sin esperar el refetch. Se reconcilia abajo
  // cuando el server ya refleja el cambio (o se revierte en error).
  const [optimisticStatus, setOptimisticStatus] = useState<
    Record<
      string,
      {
        operational_status?: OperationalStatus;
        opened_at?: string | null;
        mozo_id?: string | null;
      }
    >
  >({});

  // Reloj de cliente para "hace cuánto" (mesa abierta / reserva próxima).
  // Arranca en null → SSR y primer render de cliente coinciden (sin hydration
  // mismatch por Date.now()); al montar se setea y tickea cada 30s, dando
  // además un timer vivo que ya no queda congelado entre eventos realtime.
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  // ── "Cargar pedido" embebido en el panel derecho (no navega) ──
  // El catálogo (pesado, business-level) se PREFETCHEA al montar y se cachea;
  // al abrir una mesa solo se piden sus comandas (chico). Así la apertura se
  // siente instantánea en vez de esperar un fetch grande cada vez.
  const [catalogBundle, setCatalogBundle] = useState<PedirCatalogBundle | null>(
    null,
  );
  const catalogBundleRef = useRef<PedirCatalogBundle | null>(null);
  catalogBundleRef.current = catalogBundle;
  const [pedirTable, setPedirTable] = useState<FloorTable | null>(null);
  const [pedirState, setPedirState] = useState<TableOrderState | null>(null);
  const [pedirLoading, setPedirLoading] = useState(false);

  // ── "Cobrar mesa" embebido en el panel derecho (no navega) ──
  // Espejo de "pedir": al tocar Cobrar se carga la cuenta + iniciarCobro de la
  // mesa (loader cliente) y el panel muestra el flujo de cobro completo. El
  // cuerpo es el mismo `CobrarDesktopClient` de la página, en modo `embedded`.
  const [cobroTable, setCobroTable] = useState<FloorTable | null>(null);
  const [cobroData, setCobroData] = useState<CobroPanelData | null>(null);
  const [cobroLoading, setCobroLoading] = useState(false);

  // ── "Pedir cuenta" embebido (propina/descuento/dividir) previo al cobro ──
  // Mismo flujo que el mozo: cuenta → "Pasar a cobro" → cobro. Embebido en el
  // panel del salón (espejo de cobro/pedir).
  const [cuentaTable, setCuentaTable] = useState<FloorTable | null>(null);
  const [cuentaData, setCuentaData] = useState<CuentaPanelData | null>(null);
  const [cuentaLoading, setCuentaLoading] = useState(false);

  // Prefetch del catálogo al montar (no bloquea; si falla se reintenta al abrir).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await loadPedirCatalog(slug);
        if (!cancelled && r.ok) setCatalogBundle(r.data);
      } catch {
        // ignore — se reintenta on-demand al abrir el panel
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [slug]);

  const closePedir = useCallback(() => {
    setPedirTable(null);
    setPedirState(null);
  }, []);

  const closeCobro = useCallback(() => {
    setCobroTable(null);
    setCobroData(null);
  }, []);

  const openCobro = useCallback(
    (table: FloorTable) => {
      // Cobro, cuenta y pedir son excluyentes por mesa: abrir uno cierra los otros.
      setPedirTable(null);
      setPedirState(null);
      setCuentaTable(null);
      setCuentaData(null);
      setCobroTable(table);
      setCobroData(null);
      setCobroLoading(true);
      (async () => {
        try {
          const r = await loadCobroForTable(slug, table.id);
          if (!r.ok) {
            toast.error(r.error);
            setCobroTable(null);
            return;
          }
          setCobroData(r.data);
        } catch (e) {
          toast.error(
            e instanceof Error ? e.message : "No pudimos abrir el cobro.",
          );
          setCobroTable(null);
        } finally {
          setCobroLoading(false);
        }
      })();
    },
    [slug],
  );

  // Re-fetch de los datos del cobro sin cerrar el panel (tras dividir / limpiar
  // / pago parcial). El panel sigue mostrando lo anterior hasta que llega lo
  // nuevo (sin spinner de takeover).
  const reloadCobro = useCallback(() => {
    const table = cobroTable;
    if (!table) return;
    (async () => {
      try {
        const r = await loadCobroForTable(slug, table.id);
        if (!r.ok) {
          toast.error(r.error);
          return;
        }
        setCobroData(r.data);
      } catch (e) {
        toast.error(
          e instanceof Error ? e.message : "No pudimos recargar el cobro.",
        );
      }
    })();
  }, [slug, cobroTable]);

  // ── Cuenta embebida ──
  const closeCuenta = useCallback(() => {
    setCuentaTable(null);
    setCuentaData(null);
  }, []);

  const openCuenta = useCallback(
    (table: FloorTable) => {
      // Excluyente con cobro y pedir.
      setPedirTable(null);
      setPedirState(null);
      setCobroTable(null);
      setCobroData(null);
      setCuentaTable(table);
      setCuentaData(null);
      setCuentaLoading(true);
      (async () => {
        try {
          const r = await loadCuentaForTable(slug, table.id);
          if (!r.ok) {
            toast.error(r.error);
            setCuentaTable(null);
            return;
          }
          setCuentaData(r.data);
        } catch (e) {
          toast.error(
            e instanceof Error ? e.message : "No pudimos abrir la cuenta.",
          );
          setCuentaTable(null);
        } finally {
          setCuentaLoading(false);
        }
      })();
    },
    [slug],
  );

  const reloadCuenta = useCallback(() => {
    const table = cuentaTable;
    if (!table) return;
    (async () => {
      try {
        const r = await loadCuentaForTable(slug, table.id);
        if (!r.ok) {
          toast.error(r.error);
          return;
        }
        setCuentaData(r.data);
      } catch (e) {
        toast.error(
          e instanceof Error ? e.message : "No pudimos recargar la cuenta.",
        );
      }
    })();
  }, [slug, cuentaTable]);

  const openPedir = useCallback(
    (table: FloorTable) => {
      // Cerramos cobro y cuenta si estaban abiertos (excluyentes por mesa).
      setCobroTable(null);
      setCobroData(null);
      setCuentaTable(null);
      setCuentaData(null);
      setPedirTable(table);
      setPedirState(null);
      setPedirLoading(true);
      (async () => {
        try {
          // Catálogo: cache primero; si todavía no llegó el prefetch, lo traemos.
          let bundle = catalogBundleRef.current;
          if (!bundle) {
            const cr = await loadPedirCatalog(slug);
            if (!cr.ok) throw new Error(cr.error);
            bundle = cr.data;
            setCatalogBundle(bundle);
          }
          // Estado de la mesa puntual: comandas + «Lo pedido» (rápido).
          const tr = await loadTableComandas(slug, table.id);
          setPedirState(tr.ok ? tr.data : { comandas: [], loPedido: null });
        } catch (e) {
          toast.error(
            e instanceof Error ? e.message : "No pudimos abrir el pedido.",
          );
          setPedirTable(null);
        } finally {
          setPedirLoading(false);
        }
      })();
    },
    [slug],
  );

  // ── Multi-salón ──
  // Selección persistida por business. Si el id guardado ya no existe (plano
  // borrado), caemos al primero.
  const storageKey = `salon_active_plan_${businessId}`;
  const [activePlanId, setActivePlanId] = useState<string>(
    () => floorPlans[0]?.plan.id ?? "",
  );
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const stored = localStorage.getItem(storageKey);
      if (stored && floorPlans.some((p) => p.plan.id === stored)) {
        setActivePlanId(stored);
      } else if (floorPlans[0]) {
        setActivePlanId(floorPlans[0].plan.id);
      }
    } catch {
      // ignore
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);
  // Cuando floorPlans cambia (refresh), validar que activePlanId siga vivo.
  useEffect(() => {
    if (!floorPlans.some((p) => p.plan.id === activePlanId) && floorPlans[0]) {
      setActivePlanId(floorPlans[0].plan.id);
    }
  }, [floorPlans, activePlanId]);

  const setActivePlan = (id: string) => {
    setActivePlanId(id);
    setSelectedId(null); // limpiar selección al cambiar de salón
    try {
      localStorage.setItem(storageKey, id);
    } catch {
      // ignore
    }
  };

  // Spec 065: los salones elegidos en el filtro del operativo acotan lo que
  // este panel puede mostrar. Con la lista vacía —o si ninguno de los elegidos
  // existe acá— se ve todo, en vez de romper con un plano fantasma.
  const shownPlans = useMemo(() => {
    if (visiblePlanIds.length === 0) return floorPlans;
    const only = floorPlans.filter((p) => visiblePlanIds.includes(p.plan.id));
    return only.length > 0 ? only : floorPlans;
  }, [floorPlans, visiblePlanIds]);

  // Con un solo salón elegido el plano queda fijado ahí (y el selector propio
  // desaparece: sería un segundo control para lo mismo). Con dos, el selector
  // queda pero sólo con esos dos — que es justo el caso de la encargada que
  // cubre dos salones.
  const effectivePlanId = shownPlans.some((p) => p.plan.id === activePlanId)
    ? activePlanId
    : (shownPlans[0]?.plan.id ?? activePlanId);

  // Cambiar de salón desde el filtro del operativo también limpia la selección
  // (igual que `setActivePlan`): una mesa seleccionada de otro salón dejaría el
  // sidebar mostrando algo que ya no está en el plano.
  const visibleSig = visiblePlanIds.join(",");
  useEffect(() => {
    setSelectedId(null);
  }, [visibleSig]);

  // Plano + mesas del salón activo.
  const active =
    shownPlans.find((p) => p.plan.id === effectivePlanId) ?? shownPlans[0];
  const plan = active?.plan;

  // Aplica el overlay optimista (patch parcial) sobre una mesa. Solo pisa las
  // claves presentes en el patch (no muta el server).
  const withOverlay = (t: FloorTable): FloorTable => {
    const ov = optimisticStatus[t.id];
    return ov ? { ...t, ...ov } : t;
  };

  const tables = useMemo(
    () => (active?.tables ?? []).map(withOverlay),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [active, optimisticStatus],
  );
  const activeTables = useMemo(
    () => tables.filter((t) => t.status === "active"),
    [tables],
  );

  // Todas las tables (de todos los salones) para stats globales — con el
  // mismo overlay para que el contador "Ocupada" salte al instante.
  const allActiveTables = useMemo(
    () =>
      floorPlans
        .flatMap((fp) => fp.tables.filter((t) => t.status === "active"))
        .map(withOverlay),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [floorPlans, optimisticStatus],
  );

  // Reconciliación: soltamos el override cuando el server ya refleja TODOS los
  // campos del patch (estado y/o mozo). Sirve para abrir (→ocupada), anular
  // (→libre) y transferir (mozo), no solo para aperturas.
  useEffect(() => {
    setOptimisticStatus((prev) => {
      if (Object.keys(prev).length === 0) return prev;
      let changed = false;
      const next = { ...prev };
      for (const fp of floorPlans) {
        for (const t of fp.tables) {
          const ov = next[t.id];
          if (!ov) continue;
          const statusMatches =
            ov.operational_status === undefined ||
            (t.operational_status ?? "libre") === ov.operational_status;
          const mozoMatches =
            ov.mozo_id === undefined || (t.mozo_id ?? null) === ov.mozo_id;
          if (statusMatches && mozoMatches) {
            delete next[t.id];
            changed = true;
          }
        }
      }
      return changed ? next : prev;
    });
  }, [floorPlans]);

  // Stats globales (todos los salones del local). Da panorámica completa
  // independiente del salón que esté mirando el encargado.
  const stats = useMemo(() => {
    const out: Record<OperationalStatus, number> = {
      libre: 0,
      ocupada: 0,
      pidio_cuenta: 0,
    };
    for (const t of allActiveTables) {
      const s = (t.operational_status ?? "libre") as OperationalStatus;
      out[s] = (out[s] ?? 0) + 1;
    }
    return out;
  }, [allActiveTables]);

  // Estado operacional por mesa (con overlay optimista ya aplicado). Sirve de
  // guard defensivo: una orden/reserva-seated sobre una mesa libre es data
  // inconsistente (seed viejo / liberación incompleta) y no debe renderizarse
  // como "mesa con orden" — fue el bug "mesa Libre con orden #N".
  const tableStatusById = useMemo(() => {
    const m: Record<string, OperationalStatus> = {};
    for (const t of allActiveTables) {
      m[t.id] = (t.operational_status ?? "libre") as OperationalStatus;
    }
    return m;
  }, [allActiveTables]);

  const reservationByTable = useMemo(() => {
    const m: Record<string, SalonReservationRef> = {};
    for (const r of reservations) {
      if (!r.table_id) continue;
      // Una reserva `seated` sobre una mesa libre quedó huérfana → no la pegamos.
      // Las `confirmed` (próximas) sí pueden mostrarse sobre una mesa libre.
      if (r.status === "seated" && tableStatusById[r.table_id] === "libre")
        continue;
      m[r.table_id] = r;
    }
    return m;
  }, [reservations, tableStatusById]);

  // Lo que ve el PLANO es más angosto que lo de arriba: una reserva se dibuja
  // sobre la mesa recién 3 h antes de su hora (issue #117 — a las 12 no queremos
  // ver la de las 21), y con dos reservas del día sobre la misma mesa gana la
  // próxima. El sidebar y el panel de reservas siguen con el día completo.
  const planReservationByTable = useMemo(
    () =>
      planReservationsByTable(
        reservations.filter(
          (r) =>
            !(
              r.status === "seated" &&
              r.table_id &&
              tableStatusById[r.table_id] === "libre"
            ),
        ),
        now,
      ),
    [reservations, tableStatusById, now],
  );

  const orderByTable = useMemo(() => {
    const m: Record<string, SalonOrderRef> = {};
    for (const o of dineInOrders) {
      if (!o.table_id) continue;
      // Solo descartamos cuando SABEMOS que la mesa está libre (no cuando falta
      // en el mapa), para no ocultar órdenes de mesas en estados no-activos.
      if (tableStatusById[o.table_id] === "libre") continue;
      m[o.table_id] = o;
    }
    return m;
  }, [dineInOrders, tableStatusById]);

  // Demora de cocina por mesa (spec 30): la comanda pendiente más demorada de
  // cada mesa con orden. Recalcula con el `now` del ticker → el punto avanza
  // solo. En SSR/primer render (now == null) queda vacío para que server y
  // cliente coincidan (mismo criterio que `minutesOpen`).
  const delayByTable = useMemo(() => {
    const m: Record<string, TableDelay> = {};
    if (now == null) return m;
    for (const t of activeTables) {
      const order = orderByTable[t.id];
      if (!order) continue;
      const d = tableDelay(order.comandas, now);
      if (d) m[t.id] = d;
    }
    return m;
  }, [activeTables, orderByTable, now]);

  // Lista accionable de demoras: mesas con nivel ≥ 1, ordenadas por exceso
  // descendente (la más demorada arriba). Es "lo que de verdad se mira".
  const demoras = useMemo(() => {
    return activeTables
      .map((t) => {
        const d = delayByTable[t.id];
        if (!d || d.level < 1) return null;
        return {
          tableId: t.id,
          label: t.label,
          station: d.station,
          excessMin: Math.round(d.excessMinutes),
          level: d.level,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)
      .sort((a, b) => b.excessMin - a.excessMin);
  }, [activeTables, delayByTable]);

  const mozoNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const x of mozos) {
      if (x.full_name) m.set(x.user_id, x.full_name);
    }
    return m;
  }, [mozos]);

  const tableLabelById = useMemo(() => {
    const m: Record<string, string> = {};
    for (const fp of floorPlans) {
      for (const t of fp.tables) {
        m[t.id] = t.label;
      }
    }
    return m;
  }, [floorPlans]);

  // ── Acciones server ──
  /**
   * Anula la mesa. `reason` vacío sólo vale para una mesa sin consumo: el
   * server re-deriva eso contra la DB y rechaza el vacío si hay ítems (spec
   * 071), así que acá no hay riesgo de saltearse el motivo con datos viejos.
   */
  const anular = useCallback(
    (tableId: string, reason: string) => {
      // Optimista: la mesa se libera al instante. Cerramos el prompt y la
      // selección; el server reconcilia (o revertimos si falla).
      setOptimisticStatus((prev) => ({
        ...prev,
        [tableId]: { operational_status: "libre" },
      }));
      setAnularPrompt(null);
      setAnularReason("");
      setSelectedId(null);
      startTransition(async () => {
        const r = await anularMesa(tableId, reason, slug);
        if (!r.ok) {
          toast.error(r.error);
          setOptimisticStatus((prev) => {
            if (!prev[tableId]) return prev;
            const next = { ...prev };
            delete next[tableId];
            return next;
          });
          return;
        }
        toast.success("Mesa anulada.");
        void refetchSalon();
      });
    },
    [slug, refetchSalon],
  );

  const handleAnular = useCallback(() => {
    if (!anularPrompt) return;
    const reason = anularReason.trim();
    if (!reason) {
      toast.error("Indicá el motivo.");
      return;
    }
    anular(anularPrompt.tableId, reason);
  }, [anularPrompt, anularReason, anular]);

  /**
   * Punto de entrada del botón «Anular» (spec 071). Sin nada cargado se cierra
   * directo; recién con consumo se pide el motivo.
   */
  const pedirAnular = useCallback(
    (tableId: string, label: string) => {
      if (!tieneConsumo(orderByTable[tableId]?.items)) {
        anular(tableId, "");
        return;
      }
      setAnularPrompt({ tableId, label });
    },
    [orderByTable, anular],
  );

  const handleSentarReserva = useCallback(
    (reservationId: string, tableId: string) => {
      // Optimista: marcamos ocupada YA; el server reconcilia en el refresh.
      setOptimisticStatus((prev) => ({
        ...prev,
        [tableId]: {
          operational_status: "ocupada",
          opened_at: new Date().toISOString(),
        },
      }));
      startTransition(async () => {
        const r = await sentarReserva({
          business_slug: slug,
          reservation_id: reservationId,
        });
        if (!r.ok) {
          toast.error(r.error);
          // Rollback del overlay si el server rechazó la apertura.
          setOptimisticStatus((prev) => {
            const next = { ...prev };
            delete next[tableId];
            return next;
          });
          return;
        }
        toast.success("Mesa abierta con reserva.");
        setSelectedId(null);
        void refetchSalon();
      });
    },
    [slug, refetchSalon],
  );

  // ── Selección ──
  const selected = selectedId
    ? (activeTables.find((t) => t.id === selectedId) ?? null)
    : null;

  // ── Paint mode (Distribuir mozos) ──
  // Mozo activo en la paleta. Default: primer mozo del listado.
  const [paintMozoId, setPaintMozoId] = useState<string | null>(null);
  useEffect(() => {
    if (distribuirOpen && paintMozoId === null) {
      const firstMozo =
        mozos.find((m) => m.role === "mozo")?.user_id ??
        mozos[0]?.user_id ??
        null;
      setPaintMozoId(firstMozo);
    }
    // Al cerrar, mantenemos el último mozo activo (es probable que el
    // encargado vuelva a abrir y siga en el mismo).
  }, [distribuirOpen, mozos, paintMozoId]);

  // Espejo local de mozo_id por tableId para optimistic update en paint
  // mode. Se sincroniza con las tables del server al refresh.
  const [localAssign, setLocalAssign] = useState<Record<string, string | null>>(
    {},
  );
  useEffect(() => {
    const m: Record<string, string | null> = {};
    for (const t of activeTables) m[t.id] = t.mozo_id ?? null;
    setLocalAssign(m);
  }, [activeTables]);

  // En paint mode el selected debe limpiarse (no abrimos TableDetail).
  useEffect(() => {
    if (distribuirOpen && selectedId !== null) setSelectedId(null);
  }, [distribuirOpen, selectedId]);

  const handlePaintTable = useCallback(
    (table: FloorTable) => {
      const currentAssigned = localAssign[table.id] ?? null;
      // Toggle: si la mesa ya está asignada al mozo activo → desasignar.
      const next = currentAssigned === paintMozoId ? null : paintMozoId;
      setLocalAssign((prev) => ({ ...prev, [table.id]: next }));
      startTransition(async () => {
        const r = await assignMozoToTable(table.id, next, slug);
        if (!r.ok) {
          toast.error(r.error);
          setLocalAssign((prev) => ({ ...prev, [table.id]: currentAssigned }));
        }
      });
    },
    [localAssign, paintMozoId, slug],
  );

  /**
   * Reset de la distribución entera (arranque de turno). Optimista como el
   * pintado: si el server rechaza, vuelve el mapa anterior.
   */
  const handleClearDistribucion = useCallback(() => {
    const prev = localAssign;
    setLocalAssign((cur) =>
      Object.fromEntries(Object.keys(cur).map((id) => [id, null])),
    );
    startTransition(async () => {
      const r = await clearMozoAssignments(slug);
      if (!r.ok) {
        toast.error(r.error);
        setLocalAssign(prev);
        return;
      }
      toast.success(
        r.data.cleared > 0
          ? `Distribución limpia — ${r.data.cleared} mesas liberadas.`
          : "No había mesas asignadas.",
      );
      void refetchSalon();
    });
  }, [localAssign, slug, refetchSalon]);

  const closeNuevaReserva = useCallback(() => {
    setShowNewReservation(false);
    setPickingForNueva(false);
    setNuevaReservaTable(null);
  }, []);

  /**
   * Mesa tocada mientras una reserva espera (spec 059). Con intent "seat" la
   * sienta directo en esa mesa — es el caso de las reservas genéricas del modo
   * flexible, donde la mesa se decide recién al llegar: obligarlo a asignar y
   * después sentar eran dos pasos para el mismo gesto.
   */
  const handleAsignarMesaReserva = useCallback(
    (table: FloorTable) => {
      if (!asignarReservaFor) return;
      const { reservation: res, intent } = asignarReservaFor;
      if (table.seats < res.party_size) {
        toast.error(
          `Mesa ${table.label} tiene ${table.seats} lugares para ${res.party_size} personas.`,
        );
        return;
      }
      startTransition(async () => {
        const r =
          intent === "seat"
            ? await sentarReserva({
                business_slug: slug,
                reservation_id: res.id,
                table_id: table.id,
              })
            : await updateReservationDetails({
                business_slug: slug,
                reservation_id: res.id,
                table_id: table.id,
                party_size: res.party_size,
              });
        if (!r.ok) {
          toast.error(r.error);
          return;
        }
        toast.success(
          intent === "seat"
            ? `${res.customer_name} sentado en ${table.label}.`
            : `Mesa ${table.label} asignada a ${res.customer_name}.`,
        );
        setAsignarReservaFor(null);
        void refetchSalon();
      });
    },
    [asignarReservaFor, slug, refetchSalon],
  );

  const countByMozo = useMemo(() => {
    const c: Record<string, number> = {};
    for (const id of Object.values(localAssign)) {
      if (id) c[id] = (c[id] ?? 0) + 1;
    }
    return c;
  }, [localAssign]);

  const totalSinAsignar = useMemo(
    () => activeTables.filter((t) => !localAssign[t.id]).length,
    [activeTables, localAssign],
  );

  const closeDistribuir = useCallback(() => {
    onDistribuirClose?.();
    void refetchSalon();
  }, [onDistribuirClose, refetchSalon]);

  // ── Teclado del panel lateral (spec 075) ──────────────────────────────────
  //
  // La lista de entrada del panel (demoras + reservas + mesas) se recorre con
  // ↑/↓ como **un solo camino** de arriba a abajo: las tres secciones son una
  // sola zona con foco real, así el encargado elige mesa sin ir al mouse.
  //
  // El orden de las mesas sale de `groupTablesForSidebar` y se comparte con
  // quien las pinta: desde que la lista se navega con flechas, el orden visual
  // y el del teclado tienen que ser el mismo o Enter abre otra mesa.
  const mesaGroups = useMemo(
    () => groupTablesForSidebar(activeTables, reservationByTable, now),
    [activeTables, reservationByTable, now],
  );
  const reservasConfirmadas = useMemo(
    () => reservations.filter((r) => r.status === "confirmed"),
    [reservations],
  );
  const listaRowIndex = useMemo(() => {
    const index = new Map<string, number>();
    const push = (key: string) => index.set(key, index.size);
    for (const d of demoras) push(`demora:${d.tableId}`);
    for (const r of reservasConfirmadas) push(`reserva:${r.id}`);
    for (const g of mesaGroups) for (const t of g.tables) push(`mesa:${t.id}`);
    return index;
  }, [demoras, reservasConfirmadas, mesaGroups]);

  const lista = useRovingList<HTMLElement>({ length: listaRowIndex.size });
  const { itemProps: listaItemProps, focusIndex: listaFocusIndex } = lista;
  /** Props de teclado de una fila de la lista, por su clave estable. */
  const listaRowProps = useCallback(
    (key: string) => {
      const i = listaRowIndex.get(key);
      return i === undefined ? {} : listaItemProps(i);
    },
    [listaRowIndex, listaItemProps],
  );

  // Volver de un modo a la lista deja el foco en la fila de donde se salió, no
  // al principio (FR-003/009). Se recuerda **la clave de la fila** y no el
  // elemento: al abrir un modo la lista entera se desmonta, así que para cuando
  // hay que devolver el foco el botón original ya no existe — lo que sobrevive
  // es la mesa.
  const [volverAFila, setVolverAFila] = useState<string | null>(null);
  useEffect(() => {
    if (!volverAFila) return;
    const i = listaRowIndex.get(volverAFila);
    if (i !== undefined) listaFocusIndex(i);
    setVolverAFila(null);
  }, [volverAFila, listaRowIndex, listaFocusIndex]);

  const seleccionarMesa = useCallback((id: string) => {
    setVentaRapidaOpen(false);
    setSelectedId(id);
  }, []);

  /**
   * Esc / Backspace suben **un** nivel de la cadena de modos, en el mismo orden
   * de prioridad con el que el panel decide qué mostrar.
   */
  const cerrarModoActual = useCallback(() => {
    if (asignarReservaFor || pickingForNueva) {
      setAsignarReservaFor(null);
      setPickingForNueva(false);
      return true;
    }
    if (showNewReservation) {
      closeNuevaReserva();
      return true;
    }
    if (distribuirOpen) {
      closeDistribuir();
      return true;
    }
    if (cobroTable) {
      closeCobro();
      return true;
    }
    if (cuentaTable) {
      closeCuenta();
      return true;
    }
    if (pedirTable) {
      closePedir();
      return true;
    }
    if (walkInTableId) {
      setWalkInTableId(null);
      return true;
    }
    if (ventaRapidaOpen) {
      setVentaRapidaOpen(false);
      listaFocusIndex(0);
      return true;
    }
    if (selectedId) {
      setVolverAFila(`mesa:${selectedId}`);
      setSelectedId(null);
      return true;
    }
    return false;
  }, [
    asignarReservaFor,
    pickingForNueva,
    showNewReservation,
    closeNuevaReserva,
    distribuirOpen,
    closeDistribuir,
    cobroTable,
    closeCobro,
    cuentaTable,
    closeCuenta,
    pedirTable,
    closePedir,
    walkInTableId,
    ventaRapidaOpen,
    listaFocusIndex,
    selectedId,
  ]);

  /**
   * Mesa que hoy tiene tomado el panel con un modo propio (cobro, cuenta,
   * pedido, abrir mesa). Sirve para distinguir, en el plano, "tocar la mesa en
   * la que ya estoy" de "tocar otra".
   */
  const mesaEnModo =
    cobroTable?.id ??
    cuentaTable?.id ??
    pedirTable?.id ??
    walkInTableId ??
    null;

  /**
   * Tap en el plano fuera de una mesa = salir de lo que estás haciendo, un
   * nivel por tap (el mismo camino que Esc). Dos modos quedan afuera:
   * - distribuir mozos / elegir mesa para una reserva: ahí el plano ES la
   *   herramienta y un toque al aire no puede cancelar el flujo (para eso
   *   están el "Cancelar" del banner y Esc);
   * - venta rápida: no es de ninguna mesa y su carrito no sobrevive al cierre,
   *   así que un tap perdido no puede llevarse la venta cargada.
   */
  const cerrarDesdePlano = useCallback(() => {
    if (distribuirOpen || asignarReservaFor || pickingForNueva) return;
    if (ventaRapidaOpen) return;
    cerrarModoActual();
  }, [
    distribuirOpen,
    asignarReservaFor,
    pickingForNueva,
    ventaRapidaOpen,
    cerrarModoActual,
  ]);

  // ── Panel de atajos (`?`) ──
  const [atajosOpen, setAtajosOpen] = useState(false);
  /** Qué modo está mostrando el panel: se listan sus atajos, no todos. */
  const modoPanel: ModoPanel = showNewReservation
    ? "reserva"
    : cobroTable
      ? "cobro"
      : cuentaTable
        ? "cuenta"
        : pedirTable
          ? "pedir"
          : walkInTableId
            ? "walkin"
            : ventaRapidaOpen
              ? "venta"
              : selectedId
                ? "detalle"
                : "lista";

  // Cambiar de modo desmonta un panel y monta otro. Si el que entra no enfoca
  // nada suyo (la cuenta y el cobro tardan en traer sus datos), el foco queda
  // en el `<body>` y ni las flechas ni Esc llegan al panel. El `<aside>` es
  // focusable de último recurso: se queda con el foco hasta que el panel nuevo
  // lo reclame, y así Esc siempre funciona.
  const asideRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const t = setTimeout(() => {
      if (document.activeElement !== document.body) return;
      asideRef.current?.focus({ preventScroll: true });
    }, 0);
    return () => clearTimeout(t);
  }, [modoPanel]);

  const handleAsideKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // Una zona de adentro ya la consumió. Sin esto, el Backspace que el
      // carrito frena igual subía y cerraba el panel —llevándose la venta
      // rápida cargada—, y el `?` se escribía en el buscador **además** de
      // abrir la ayuda.
      if (e.defaultPrevented) return;
      const el = e.target as HTMLElement;
      const escribiendo =
        el.tagName === "INPUT" ||
        el.tagName === "TEXTAREA" ||
        el.isContentEditable;
      // Con un modal abierto adentro del panel (alta de producto, asistente del
      // menú) las teclas son suyas: las maneja él y el panel no se mueve.
      const enDialog = !!el.closest?.("[role='dialog']");

      if (e.key === "?" && !escribiendo && !enDialog) {
        e.preventDefault();
        setAtajosOpen(true);
        return;
      }
      if (atajosOpen && e.key === "Escape") {
        e.preventDefault();
        setAtajosOpen(false);
        return;
      }

      if (e.key !== "Escape" && e.key !== "Backspace") return;
      if (enDialog) return;
      if (e.key === "Backspace" && escribiendo) return;
      if (cerrarModoActual()) e.preventDefault();
    },
    [cerrarModoActual, atajosOpen],
  );

  // Extras para el FloorPlanViewer.
  const extras = useMemo(() => {
    const out: Record<string, TableExtra> = {};
    for (const t of activeTables) {
      const order = orderByTable[t.id];
      // La del plano (ventana de 3 h), no la del día — issue #117.
      const reservation = planReservationByTable[t.id];
      const delay = delayByTable[t.id];
      // En paint mode usamos `localAssign` (optimistic) para que el tap
      // pinte la mesa de inmediato sin esperar al server.
      const effectiveMozoId = distribuirOpen
        ? (localAssign[t.id] ?? null)
        : t.mozo_id;
      const mozoName = effectiveMozoId
        ? mozoNameById.get(effectiveMozoId)
        : null;
      out[t.id] = {
        reservation: reservation
          ? {
              customer_name: reservation.customer_name,
              party_size: reservation.party_size,
              starts_at: reservation.starts_at,
            }
          : undefined,
        order: order
          ? {
              order_number: order.order_number,
              total_cents: order.total_cents,
              delivery_type: "dine_in",
            }
          : undefined,
        minutesOpen: t.opened_at
          ? (minutesSince(t.opened_at, now) ?? undefined)
          : undefined,
        // Spec 067: sólo lo consume el plano si el salón tiene activado
        // «mostrar el nombre del cliente».
        customerName: tableDisplayName(reservation, order) ?? undefined,
        mozoInitial: mozoName ? initialsFromName(mozoName) : undefined,
        mozoColor: effectiveMozoId ? mozoColor(effectiveMozoId) : undefined,
        delay:
          delay && delay.level >= 1
            ? {
                level: delay.level,
                excessMinutes: delay.excessMinutes,
                station: delay.station,
              }
            : undefined,
      };
    }
    return out;
  }, [
    activeTables,
    orderByTable,
    planReservationByTable,
    delayByTable,
    mozoNameById,
    distribuirOpen,
    localAssign,
    now,
  ]);

  // Mozos visibles en este salón (con su conteo de mesas asignadas). Usado
  // por la leyenda debajo del plano para que el encargado mapee color → mozo
  // de un vistazo sin necesidad de las iniciales.
  const mozosEnSalon = useMemo(() => {
    const counts = new Map<string, number>();
    for (const t of activeTables) {
      if (t.mozo_id) counts.set(t.mozo_id, (counts.get(t.mozo_id) ?? 0) + 1);
    }
    const sinAsignar = activeTables.filter((t) => !t.mozo_id).length;
    const entries = Array.from(counts.entries())
      .map(([id, count]) => ({
        id,
        name: mozoNameById.get(id) ?? "Mozo",
        color: mozoColor(id),
        count,
      }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
    return { entries, sinAsignar };
  }, [activeTables, mozoNameById]);

  return (
    <div className="flex h-full flex-col gap-4">
      {/* ── Selector de salón (solo si queda más de uno para elegir) ── */}
      {shownPlans.length > 1 && (
        <SegmentedSelector
          ariaLabel="Seleccionar salón"
          activeId={effectivePlanId}
          onSelect={setActivePlan}
          items={shownPlans.map(({ plan, tables }) => ({
            id: plan.id,
            label: plan.name,
            count: tables.filter((t) => t.status === "active").length,
          }))}
        />
      )}

      {/* ── Layout split: plano + sidebar ── */}
      <div
        className={cn(
          "grid min-h-0 flex-1 grid-cols-1 gap-4",
          // Ancho **único para todos los modos** (invariante desde que la base
          // era 360 y crecía por modo: el sidebar "saltaba" al entrar a cobrar).
          // Lo que cambia con la spec 111 es cuánto: el panel es donde se
          // trabaja el turno entero, y 480px fijos eran el 25% de un monitor de
          // 1920 para la tarea y el 75% para un plano que no cambia.
          //
          // De 1024 a 1279 se conserva 480: con el piso de 560 el plano
          // quedaría en ~450px y en una notebook eso es peor negocio.
          "lg:grid-cols-[minmax(0,1fr)_480px]",
          // De 1280 para arriba, 44% del split con piso 560 y techo 900 — el
          // techo es para que en un ultrawide el plano no termine en una franja.
          "xl:grid-cols-[minmax(0,1fr)_minmax(560px,min(44%,900px))]",
        )}
      >
        {/* Columna del plano: viewer arriba + stats al pie */}
        <div className="flex min-h-0 flex-col gap-2">
          {/* Modo "elegir mesa": el plano queda esperando un tap (spec 059). */}
          {asignarReservaFor || pickingForNueva ? (
            <div className="flex items-center gap-2 rounded-xl bg-indigo-600 px-3 py-2 text-white shadow-sm">
              <MapPin className="h-4 w-4 shrink-0 animate-pulse" />
              <span className="min-w-0 flex-1 text-sm font-semibold">
                {asignarReservaFor
                  ? `${asignarReservaFor.intent === "seat" ? "Tocá dónde sentar a" : "Tocá una mesa para"} ${asignarReservaFor.reservation.customer_name} · ${asignarReservaFor.reservation.party_size}p`
                  : "Tocá una mesa para la reserva nueva"}
              </span>
              <button
                type="button"
                onClick={() => {
                  setAsignarReservaFor(null);
                  setPickingForNueva(false);
                }}
                className="shrink-0 rounded-lg bg-white/15 px-2.5 py-1 text-xs font-bold transition hover:bg-white/25"
              >
                Cancelar
              </button>
            </div>
          ) : null}
          <div
            className={cn(
              "bg-card min-h-0 flex-1 overflow-hidden rounded-2xl ring-1",
              asignarReservaFor || pickingForNueva
                ? "ring-2 ring-indigo-500"
                : "ring-border/60",
            )}
          >
            {plan ? (
              <FloorPlanViewer
                plan={plan}
                tables={tables}
                extras={extras}
                paintMode={distribuirOpen}
                onTableClick={(t) => {
                  if (distribuirOpen) {
                    handlePaintTable(t);
                    return;
                  }
                  // Modo "elegir mesa para la reserva": el tap asigna, no abre
                  // el detalle de la mesa.
                  if (asignarReservaFor) {
                    handleAsignarMesaReserva(t);
                    return;
                  }
                  // Elegir mesa para la reserva que se está creando en el panel.
                  if (pickingForNueva) {
                    if (t.seats < 1) return;
                    setNuevaReservaTable(t);
                    setPickingForNueva(false);
                    return;
                  }
                  // Tocar la mesa que YA está abierta en un modo (pedido,
                  // cuenta, cobro, abrir mesa) no hace nada: un tap de más
                  // sobre el plano no puede tirar abajo lo que estás cargando.
                  if (mesaEnModo === t.id) return;
                  // Tocar OTRA mesa cambia de mesa: el modo abierto cede y
                  // entra el detalle de la nueva. Antes el tap no hacía nada
                  // visible —cobro/cuenta/pedido le ganan al detalle en el
                  // panel— y el plano parecía muerto mientras cargabas un
                  // pedido. El borrador del pedido se guarda por mesa, así que
                  // saltar de una a otra no pierde lo cargado.
                  closeCobro();
                  closeCuenta();
                  closePedir();
                  setWalkInTableId(null);
                  // Tocar una mesa manda al detalle: la venta de mostrador no
                  // es de ninguna mesa, así que cede el panel.
                  setVentaRapidaOpen(false);
                  setSelectedId(t.id);
                }}
                onBackgroundClick={cerrarDesdePlano}
              />
            ) : (
              <div className="flex h-full items-center justify-center p-12 text-center">
                <p className="text-muted-foreground text-sm">
                  No hay salones cargados.
                </p>
              </div>
            )}
          </div>
          <MozosLegend
            entries={mozosEnSalon.entries}
            sinAsignar={mozosEnSalon.sinAsignar}
          />
          <SalonStats stats={stats} total={allActiveTables.length} />
        </div>

        {/* Panel lateral — modos por prioridad: paint (Distribuir mozos) >
            cobro > pedir > detalle de mesa > lista. Paint gana porque mientras
            el encargado pinta no queremos que un tap accidental abra el
            detalle. Cobro y pedir son terminales por mesa (excluyentes). */}
        <aside
          ref={asideRef}
          tabIndex={-1}
          onKeyDown={handleAsideKeyDown}
          // `@container`: los modos de adentro se adaptan al ancho **del panel**,
          // no al del viewport (spec 111). No es lo mismo: el panel es el 44% de
          // la pantalla, así que un `xl:` acá mentiría por más de 700px.
          className="bg-card ring-border/60 @container relative flex min-h-0 flex-col overflow-hidden rounded-2xl ring-1 outline-none"
        >
          {atajosOpen && (
            <AtajosHelp modo={modoPanel} onClose={() => setAtajosOpen(false)} />
          )}
          {showNewReservation ? (
            <NuevaReservaPanel
              slug={slug}
              tables={activeTables}
              floorPlanId={plan?.id ?? null}
              tablePicker={{
                pickedTableId: nuevaReservaTable?.id ?? null,
                pickedLabel: nuevaReservaTable?.label ?? null,
                picking: pickingForNueva,
                onRequest: () => setPickingForNueva(true),
                onClear: () => setNuevaReservaTable(null),
              }}
              onClose={closeNuevaReserva}
            />
          ) : distribuirOpen ? (
            <AsignarMozosPanel
              mozos={mozos}
              activeMozoId={paintMozoId}
              onActiveMozoChange={setPaintMozoId}
              countByMozo={countByMozo}
              totalSinAsignar={totalSinAsignar}
              onDone={closeDistribuir}
              onClearAll={handleClearDistribucion}
            />
          ) : cobroTable ? (
            cobroData?.kind === "ok" ? (
              <CobrarDesktopClient
                slug={slug}
                tableId={cobroTable.id}
                tableLabel={cobroData.tableLabel}
                role={role}
                cuenta={cobroData.cuenta}
                init={cobroData.init}
                afipConfigured={cobroData.afipConfigured}
                existingInvoice={cobroData.existingInvoice}
                embedded
                onClose={closeCobro}
                onClosed={() => {
                  closeCobro();
                  setSelectedId(null);
                  void refetchSalon();
                }}
                onReload={reloadCobro}
              />
            ) : cobroData ? (
              <CobroPanelEmptyState
                tableLabel={cobroData.tableLabel}
                kind={cobroData.kind}
                error={cobroData.kind === "no_caja" ? cobroData.error : null}
                slug={slug}
                tableId={cobroTable.id}
                onClose={closeCobro}
              />
            ) : (
              <div className="text-muted-foreground flex h-full items-center justify-center p-8 text-center text-sm">
                {cobroLoading ? "Abriendo cobro…" : "…"}
              </div>
            )
          ) : cuentaTable ? (
            cuentaData?.kind === "ok" ? (
              <CuentaClient
                slug={slug}
                tableId={cuentaTable.id}
                tableLabel={cuentaData.tableLabel}
                role={role}
                cuenta={cuentaData.cuenta}
                embedded
                onClose={closeCuenta}
                onReload={reloadCuenta}
                onCobrar={() => openCobro(cuentaTable)}
              />
            ) : cuentaData ? (
              <CobroPanelEmptyState
                tableLabel={cuentaData.tableLabel}
                kind="no_cuenta"
                error={null}
                slug={slug}
                tableId={cuentaTable.id}
                onClose={closeCuenta}
              />
            ) : (
              <div className="text-muted-foreground flex h-full items-center justify-center p-8 text-center text-sm">
                {cuentaLoading ? "Abriendo cuenta…" : "…"}
              </div>
            )
          ) : pedirTable ? (
            catalogBundle && pedirState ? (
              <MozoPedirClient
                slug={slug}
                businessName={catalogBundle.businessName}
                table={{
                  id: pedirTable.id,
                  label: pedirTable.label,
                  operational_status: pedirTable.operational_status ?? "libre",
                  opened_at: pedirTable.opened_at ?? null,
                }}
                catalog={catalogBundle.catalog}
                stationNameById={catalogBundle.stationNameById}
                existingComandas={pedirState.comandas}
                loPedido={pedirState.loPedido}
                topProductIds={catalogBundle.topProductIds}
                dailyMenus={catalogBundle.dailyMenus}
                role={role}
                embedded
                onClose={closePedir}
                onSent={() => {
                  // Optimista: al enviar la primera comanda la mesa pasa a
                  // ocupada en el acto (la comanda en sí no es optimista).
                  const id = pedirTable.id;
                  setOptimisticStatus((prev) => ({
                    ...prev,
                    [id]: {
                      operational_status: "ocupada",
                      opened_at: new Date().toISOString(),
                    },
                  }));
                  closePedir();
                  void refetchSalon();
                }}
              />
            ) : (
              <div className="text-muted-foreground flex h-full items-center justify-center p-8 text-center text-sm">
                {pedirLoading ? "Cargando catálogo…" : "…"}
              </div>
            )
          ) : walkInTableId ? (
            /* Abrir mesa (spec 066): panel, no overlay — el plano queda a la
               vista y el foco arranca en «Abrir mesa», así el recorrido
               mesa → Enter → Enter no toca el mouse. */
            <WalkInPanel
              tableId={walkInTableId}
              tableLabel={
                tables.find((t) => t.id === walkInTableId)?.label ?? "?"
              }
              businessSlug={slug}
              onClose={() => setWalkInTableId(null)}
              onSuccess={() => {
                // Optimista: la mesa que abrimos pasa a ocupada en el acto.
                setOptimisticStatus((prev) => ({
                  ...prev,
                  [walkInTableId]: {
                    operational_status: "ocupada",
                    opened_at: new Date().toISOString(),
                  },
                }));
                setWalkInTableId(null);
                void refetchSalon();
                // Abrir mesa y cargar pedido son el mismo movimiento: encadenamos
                // directo al pedido en vez de volver al plano y pedir otro click.
                const opened = tables.find((t) => t.id === walkInTableId);
                if (opened) {
                  openPedir({
                    ...opened,
                    operational_status: "ocupada",
                    opened_at: new Date().toISOString(),
                  });
                }
              }}
            />
          ) : ventaRapidaOpen ? (
            <VentaRapidaPanel
              slug={slug}
              onClose={() => {
                setVentaRapidaOpen(false);
                listaFocusIndex(0);
              }}
            />
          ) : selected ? (
            <TableDetail
              table={selected}
              order={orderByTable[selected.id]}
              reservation={reservationByTable[selected.id]}
              mozoName={
                selected.mozo_id
                  ? (mozoNameById.get(selected.mozo_id) ?? null)
                  : null
              }
              now={now}
              role={role}
              currentUserId={currentUserId}
              slug={slug}
              pending={pending}
              onChanged={() => void refetchSalon()}
              onCargarPedido={() => openPedir(selected)}
              onPedirCuenta={() => openCuenta(selected)}
              onClose={() => {
                // Mismo camino que Esc: el botón y la tecla no pueden divergir
                // (con la X el foco se perdía y el panel dejaba de responder).
                setVolverAFila(`mesa:${selected.id}`);
                setSelectedId(null);
              }}
              onWalkIn={() => {
                // Bloqueo blando (spec 059): si la mesa tiene una reserva, no
                // se impide el walk-in, pero se avisa antes (el encargado
                // decide: sentar la reserva o abrir igual).
                const res = reservationByTable[selected.id];
                if (res) {
                  setWalkInWarning({
                    tableId: selected.id,
                    label: selected.label,
                    reservation: res,
                  });
                } else {
                  setWalkInTableId(selected.id);
                }
              }}
              onSentarReserva={() => {
                const res = reservationByTable[selected.id];
                if (res) handleSentarReserva(res.id, selected.id);
              }}
              onTransfer={() => setTransferTableId(selected.id)}
              onTrasladar={() => setTrasladarTableId(selected.id)}
              onAnular={() => pedirAnular(selected.id, selected.label)}
            />
          ) : (
            /* Lista de entrada del panel: demoras + reservas + mesas son UNA
               sola zona de teclado (spec 075, FR-006) — ↑/↓ la recorren entera
               de arriba a abajo y Enter abre. El `onKeyDown` va acá, en el
               contenedor de las tres secciones. */
            <div
              onKeyDown={lista.handleKeyDown}
              className="flex min-h-0 flex-1 flex-col"
            >
              <DemorasPanel
                demoras={demoras}
                onSelect={seleccionarMesa}
                rowProps={listaRowProps}
              />
              <ReservationsPanel
                reservations={reservations}
                slug={slug}
                tableLabelById={tableLabelById}
                rowProps={listaRowProps}
                onChanged={() => void refetchSalon()}
                pickingForId={asignarReservaFor?.reservation.id ?? null}
                onAsignarMesa={(r, intent) => {
                  setSelectedId(null);
                  setShowNewReservation(false);
                  setAsignarReservaFor({ reservation: r, intent });
                }}
                onNewReservation={() => {
                  setSelectedId(null);
                  setVentaRapidaOpen(false);
                  setAsignarReservaFor(null);
                  setNuevaReservaTable(null);
                  setPickingForNueva(false);
                  setShowNewReservation(true);
                }}
              />
              <ActiveTablesList
                groups={mesaGroups}
                total={activeTables.length}
                orderByTable={orderByTable}
                reservationByTable={reservationByTable}
                mozoNameById={mozoNameById}
                now={now}
                onSelect={seleccionarMesa}
                rowProps={listaRowProps}
                canDistribuir={canAssignMozo(role) && !!onDistribuirOpen}
                onDistribuir={() => onDistribuirOpen?.()}
                canVentaRapida={canCargarPedido(role)}
                onVentaRapida={() => {
                  setSelectedId(null);
                  setVentaRapidaOpen(true);
                }}
                onAtajos={() => setAtajosOpen(true)}
                editPlanHref={
                  canAssignMozo(role) && active?.plan.id
                    ? `/${slug}/admin/salones/${active.plan.id}`
                    : null
                }
              />
            </div>
          )}
        </aside>
      </div>

      {/* ── Modales ── */}
      {transferTableId && (
        <TransferTableModal
          tableId={transferTableId}
          tableLabel={
            tables.find((t) => t.id === transferTableId)?.label ?? "?"
          }
          currentMozoId={
            tables.find((t) => t.id === transferTableId)?.mozo_id ?? null
          }
          mozos={mozos}
          businessSlug={slug}
          onClose={() => setTransferTableId(null)}
          onSuccess={(toMozoId) => {
            // Optimista: la mesa cambia de mozo al instante.
            if (transferTableId) {
              setOptimisticStatus((prev) => ({
                ...prev,
                [transferTableId]: { mozo_id: toMozoId },
              }));
            }
            setTransferTableId(null);
            void refetchSalon();
          }}
        />
      )}
      {trasladarTableId && (
        <TrasladarMesaModal
          fromTableId={trasladarTableId}
          fromLabel={
            tables.find((t) => t.id === trasladarTableId)?.label ?? "?"
          }
          tables={tables
            .filter(
              (t) =>
                t.id !== trasladarTableId &&
                (withOverlay(t).operational_status ?? "libre") === "libre",
            )
            .map((t) => ({
              id: t.id,
              label: t.label,
              seats: t.seats,
              is_bar: t.is_bar,
            }))}
          businessSlug={slug}
          onClose={() => setTrasladarTableId(null)}
          onSuccess={() => {
            setTrasladarTableId(null);
            setSelectedId(null);
            void refetchSalon();
          }}
        />
      )}

      {/* ── Anular mesa prompt ── */}
      {anularPrompt && (
        <Dialog
          open
          onOpenChange={(o) => {
            if (!o) {
              setAnularPrompt(null);
              setAnularReason("");
            }
          }}
        >
          <DialogContent className="max-w-md p-5">
            <DialogHeader>
              <DialogTitle className="text-base font-bold text-zinc-900">
                Anular {anularPrompt.label}
              </DialogTitle>
              <DialogDescription className="text-xs text-zinc-500">
                Cancela la orden activa con motivo. La mesa queda libre.
              </DialogDescription>
            </DialogHeader>
            {/* Acción destructiva: Enter en el textarea inserta salto de línea
                (no envía); anular requiere click explícito. Esc cancela. */}
            <textarea
              value={anularReason}
              onChange={(e) => setAnularReason(e.target.value.slice(0, 200))}
              placeholder="ej: cliente se fue, error de carga, ..."
              className="block w-full rounded-2xl border border-zinc-200 px-3 py-2 text-sm focus:border-red-400 focus:ring-2 focus:ring-red-100 focus:outline-none"
              rows={3}
              autoFocus
            />
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setAnularPrompt(null);
                  setAnularReason("");
                }}
                disabled={pending}
              >
                Volver
              </Button>
              <Button
                type="button"
                variant="destructive"
                onClick={handleAnular}
                disabled={pending || !anularReason.trim()}
                className="flex-1"
              >
                Anular
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Aviso: walk-in sobre una mesa reservada (bloqueo blando, spec 059).
          No impide abrirla —el encargado manda—, pero avisa y ofrece el
          camino correcto: sentar la reserva. */}
      {walkInWarning && (
        <Dialog open onOpenChange={(o) => !o && setWalkInWarning(null)}>
          <DialogContent className="max-w-md p-5">
            <DialogHeader>
              <DialogTitle className="text-base font-bold text-zinc-900">
                {walkInWarning.label} está reservada
              </DialogTitle>
              <DialogDescription className="text-xs text-zinc-500">
                {formatTime(walkInWarning.reservation.starts_at)} ·{" "}
                {walkInWarning.reservation.customer_name} ·{" "}
                {walkInWarning.reservation.party_size}p
                {walkInWarning.reservation.notes
                  ? ` · ${walkInWarning.reservation.notes}`
                  : ""}
              </DialogDescription>
            </DialogHeader>
            <p className="text-sm text-zinc-600">
              Podés abrirla igual para un walk-in, pero después vas a necesitar
              la mesa para esta reserva.
            </p>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setWalkInWarning(null)}
                disabled={pending}
              >
                Volver
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setWalkInTableId(walkInWarning.tableId);
                  setWalkInWarning(null);
                }}
                disabled={pending}
              >
                Abrir igual
              </Button>
              <Button
                type="button"
                onClick={() => {
                  handleSentarReserva(
                    walkInWarning.reservation.id,
                    walkInWarning.tableId,
                  );
                  setWalkInWarning(null);
                }}
                disabled={pending}
                className="flex-1"
              >
                Sentar la reserva
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* El overlay "Distribuir mozos" vive en LocalShell para alinear el
          trigger con las tabs del header. No se monta acá. */}
    </div>
  );
}

// ─── Stats ──────────────────────────────────────────────────────────────────

// Tira compacta de estado (una sola línea) — antes era un card con header +
// grid que comía ~70px de alto del plano. Ahora resume lo mismo (total +
// libre/ocupada/pidió cuenta) en un renglón fino, para dejarle el máximo de
// espacio vertical al plano en cualquier monitor.
function SalonStats({
  stats,
  total,
}: {
  stats: Record<OperationalStatus, number>;
  total: number;
}) {
  return (
    <div className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-xs">
      <span className="inline-flex items-center gap-1.5 font-semibold">
        <Users className="size-3.5" />
        <span className="tabular-nums">{total}</span> mesa
        {total === 1 ? "" : "s"}
      </span>
      {STATS_ORDER.map((s) => {
        const c = STATUS_COLORS[s];
        const count = stats[s] ?? 0;
        return (
          <span key={s} className="inline-flex items-center gap-1.5">
            <span className={cn("h-2 w-2 shrink-0 rounded-full", c.dot)} />
            <span className={cn("font-medium", c.text)}>{STATUS_LABEL[s]}</span>
            <span className={cn("font-bold tabular-nums", c.text)}>
              {count}
            </span>
          </span>
        );
      })}
    </div>
  );
}

// ─── Leyenda de mozos (color → nombre), compacta ────────────────────────────

function MozosLegend({
  entries,
  sinAsignar,
}: {
  entries: { id: string; name: string; color: string; count: number }[];
  sinAsignar: number;
}) {
  if (entries.length === 0 && sinAsignar === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5 px-1">
      {entries.map((m) => (
        <span
          key={m.id}
          className="inline-flex items-center gap-1.5 text-[11px] font-medium text-zinc-700"
          title={`${m.name} · ${m.count} mesa${m.count === 1 ? "" : "s"}`}
        >
          <span
            aria-hidden
            className="size-2.5 shrink-0 rounded-full"
            style={{ background: m.color }}
          />
          <span className="max-w-[10rem] truncate">{m.name}</span>
          <span className="text-zinc-400 tabular-nums">{m.count}</span>
        </span>
      ))}
      {sinAsignar > 0 && (
        <span
          className="inline-flex items-center gap-1.5 text-[11px] font-medium text-zinc-500"
          title={`${sinAsignar} mesa${sinAsignar === 1 ? "" : "s"} sin mozo`}
        >
          <span
            aria-hidden
            className="size-2.5 shrink-0 rounded-full bg-zinc-300"
          />
          Sin asignar
          <span className="text-zinc-400 tabular-nums">{sinAsignar}</span>
        </span>
      )}
    </div>
  );
}

// ─── Lista de demoras (cocina pasada de su tiempo esperado) ─────────────────

/**
 * Props de teclado de una fila de la lista lateral, por su clave estable
 * (`demora:<id>`, `reserva:<id>`, `mesa:<id>`) — spec 075.
 *
 * Las tres secciones del panel son **una sola** zona navegable, así que el
 * índice de teclado lo lleva el padre y cada fila lo pide por clave en vez de
 * por posición: cuando una sección aparece o desaparece, ninguna cuenta.
 */
export type SalonRowProps = (key: string) => {
  ref?: (el: HTMLElement | null) => void;
  tabIndex?: number;
  "aria-current"?: "true";
  onFocus?: () => void;
};

function DemorasPanel({
  demoras,
  onSelect,
  rowProps,
}: {
  demoras: {
    tableId: string;
    label: string;
    station: string;
    excessMin: number;
    level: number;
  }[];
  onSelect: (id: string) => void;
  /** Props de teclado de la fila (spec 075): el panel entero es una zona. */
  rowProps: SalonRowProps;
}) {
  // Sin demoras → no ocupa lugar (en hora normal el panel no se ensucia).
  if (demoras.length === 0) return null;
  return (
    <section className="border-border/60 border-b">
      <header className="flex items-center gap-2 px-4 pt-3 pb-1.5">
        <Clock className="size-3.5 text-red-600" />
        <h3 className="text-[0.65rem] font-semibold tracking-[0.14em] text-red-700 uppercase">
          Cocina demorada · {demoras.length}
        </h3>
      </header>
      <ul className="pb-2">
        {demoras.map((d) => (
          <li key={d.tableId}>
            <button
              type="button"
              onClick={() => onSelect(d.tableId)}
              {...rowProps(`demora:${d.tableId}`)}
              className="flex w-full items-center gap-2.5 px-4 py-1.5 text-left transition outline-none hover:bg-zinc-50 focus-visible:bg-zinc-50 focus-visible:ring-2 focus-visible:ring-zinc-900/20 focus-visible:ring-inset"
            >
              <span
                aria-hidden
                className="size-2.5 shrink-0 rounded-full"
                style={{ background: DELAY_COLORS[d.level] }}
              />
              <span className="font-heading min-w-0 flex-1 truncate text-sm font-bold text-zinc-900">
                {d.label}
              </span>
              <span className="max-w-[7rem] truncate text-[11px] text-zinc-500 @lg:max-w-[14rem]">
                {d.station}
              </span>
              <span className="shrink-0 text-[11px] font-semibold text-red-700 tabular-nums">
                +{d.excessMin} min
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ─── Lista lateral cuando no hay mesa seleccionada ──────────────────────────

function ActiveTablesList({
  groups,
  total,
  orderByTable,
  reservationByTable,
  mozoNameById,
  now,
  onSelect,
  rowProps,
  canDistribuir,
  onDistribuir,
  canVentaRapida,
  onVentaRapida,
  onAtajos,
  editPlanHref,
}: {
  /** Mesas ya agrupadas y ordenadas por `groupTablesForSidebar`. El orden lo
   *  arma el padre porque desde la spec 075 es también el orden del teclado. */
  groups: SalonTableGroup[];
  total: number;
  orderByTable: Record<string, SalonOrderRef>;
  reservationByTable: Record<string, SalonReservationRef>;
  mozoNameById: Map<string, string>;
  now: number | null;
  onSelect: (id: string) => void;
  rowProps: SalonRowProps;
  /** Mostrar el CTA "Distribuir mozos" en el header de la lista. Solo
   *  encargado / admin lo ven (el flag es del parent). */
  canDistribuir: boolean;
  onDistribuir: () => void;
  /** Venta de kiosko/barra sin mesa (spec 058). Encargado / admin. */
  canVentaRapida: boolean;
  onVentaRapida: () => void;
  /** Abre el panel de atajos — el mismo que `?` (spec 075, FR-022). */
  onAtajos: () => void;
  /** Link al editor del plano del salón activo. Si null, no se muestra. */
  editPlanHref: string | null;
}) {
  const renderGroup = (group: SalonTableGroup) => {
    if (group.tables.length === 0) return null;
    return (
      <section key={group.tone} className="space-y-1.5">
        <h4 className="px-4 pt-3 text-[0.65rem] font-semibold tracking-[0.14em] text-zinc-500 uppercase">
          {group.title} · {group.tables.length}
        </h4>
        <ul>
          {group.tables.map((t) => (
            <ActiveTableRow
              key={t.id}
              table={t}
              order={orderByTable[t.id]}
              reservation={reservationByTable[t.id]}
              mozoName={t.mozo_id ? mozoNameById.get(t.mozo_id) : null}
              minutes={minutesSince(t.opened_at, now)}
              now={now}
              tone={group.tone}
              onSelect={onSelect}
              rowProps={rowProps}
            />
          ))}
        </ul>
      </section>
    );
  };

  const totalActivas = groups
    .filter((g) => g.tone !== "libre")
    .reduce((a, g) => a + g.tables.length, 0);

  return (
    <>
      {/* Título y acciones van en filas separadas: en 360px de sidebar los tres
          CTAs no entran al lado del título sin machacarlo (spec 058 sumó el
          tercero). El `flex-wrap` cubre labels más largos o zoom del navegador. */}
      {/* Con el panel ancho (spec 111) el título y los CTAs sí entran en un
          renglón: `@xl` mide el panel, así que a 480px queda apilado igual. */}
      <header className="border-border/60 space-y-2 border-b px-4 py-3 @xl:flex @xl:items-center @xl:justify-between @xl:gap-3 @xl:space-y-0">
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="text-foreground text-sm font-bold tracking-tight">
            Mesas
          </h3>
          <p className="text-muted-foreground shrink-0 text-[11px]">
            {totalActivas} {totalActivas === 1 ? "activa" : "activas"} · {total}{" "}
            totales
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {canVentaRapida && (
            <button
              type="button"
              onClick={onVentaRapida}
              className="inline-flex items-center gap-1.5 rounded-full bg-emerald-600 px-3 py-1.5 text-[11px] font-semibold text-white transition hover:brightness-110 active:scale-[0.97]"
            >
              <Store className="size-3" />
              Venta rápida
            </button>
          )}
          {canDistribuir && (
            <button
              type="button"
              onClick={onDistribuir}
              className="inline-flex items-center gap-1.5 rounded-full bg-zinc-900 px-3 py-1.5 text-[11px] font-semibold text-white transition hover:brightness-110 active:scale-[0.97]"
            >
              <Users className="size-3" />
              Distribuir mozos
            </button>
          )}
          {/* El teclado es el camino rápido de este panel; el botón es para
                descubrirlo con el mouse. Mismo panel que abre `?`. */}
          <button
            type="button"
            onClick={onAtajos}
            aria-label="Ver atajos de teclado"
            title="Atajos de teclado (?)"
            className="inline-flex items-center gap-1 rounded-full bg-zinc-100 px-2.5 py-1.5 text-[11px] font-semibold text-zinc-600 ring-1 ring-zinc-200 transition hover:bg-zinc-200"
          >
            <Keyboard className="size-3" />?
          </button>
          {editPlanHref && (
            // Icon-only: es la acción menos frecuente de las tres y así las
            // otras dos entran en un solo renglón.
            <Link
              href={editPlanHref}
              className="inline-flex items-center justify-center rounded-full bg-zinc-100 p-2 text-zinc-700 ring-1 ring-zinc-200 transition hover:bg-zinc-200 active:scale-[0.97]"
              aria-label="Editar mesas del salón"
              title="Editar mesas del salón"
            >
              <Pencil className="size-3" />
            </Link>
          )}
        </div>
      </header>
      <div className="flex-1 overflow-y-auto pb-3">
        {total === 0 ? (
          <p className="text-muted-foreground p-6 text-center text-sm">
            Sin mesas en el plano
          </p>
        ) : (
          groups.map(renderGroup)
        )}
      </div>
    </>
  );
}

// ─── Una fila de la lista lateral ──────────────────────────────────────────

function ActiveTableRow({
  table,
  order,
  reservation,
  mozoName,
  minutes,
  now,
  tone,
  onSelect,
  rowProps,
}: {
  table: FloorTable;
  order: SalonOrderRef | undefined;
  reservation: SalonReservationRef | undefined;
  mozoName: string | null | undefined;
  minutes: number | null;
  now: number | null;
  tone: OperationalStatus;
  onSelect: (id: string) => void;
  rowProps: SalonRowProps;
}) {
  // Color del border-left según estado.
  const borderClass: Record<OperationalStatus, string> = {
    libre: "border-l-zinc-200",
    ocupada: "border-l-emerald-500",
    pidio_cuenta: "border-l-amber-500",
  };
  const tiempo = formatRelativeTime(minutes);
  // Spec 067: mismo criterio que el plano — una sola definición de "quién está
  // sentado acá", así la mesa y su detalle no dicen cosas distintas.
  const partyName = tableDisplayName(reservation, order);
  const activeItemsCount = order
    ? order.items
        .filter((it) => it.cancelled_at === null)
        .reduce((a, it) => a + it.quantity, 0)
    : 0;

  // Reserva próxima sobre mesa libre. En SSR (now == null) no la marcamos,
  // para coincidir con el primer render de cliente.
  const reservaProxima =
    now != null &&
    tone === "libre" &&
    reservation &&
    new Date(reservation.starts_at).getTime() - now < 2 * 60 * 60 * 1000;

  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect(table.id)}
        {...rowProps(`mesa:${table.id}`)}
        className={cn(
          "block w-full border-l-[3px] px-4 py-3 text-left transition outline-none hover:bg-zinc-50",
          "focus-visible:bg-zinc-50 focus-visible:ring-2 focus-visible:ring-zinc-900/20 focus-visible:ring-inset",
          borderClass[tone],
        )}
      >
        {/* Línea 1: label + tiempo a la derecha */}
        <div className="flex items-baseline justify-between gap-2">
          <span className="font-heading truncate text-base font-bold tracking-tight text-zinc-900">
            {table.label}
          </span>
          {tiempo && (
            <span
              className={cn(
                "shrink-0 text-[11px] tabular-nums",
                tone === "pidio_cuenta"
                  ? "font-semibold text-amber-700"
                  : "text-zinc-500",
              )}
            >
              {tiempo}
            </span>
          )}
        </div>

        {/* Línea 2: nombre del comensal (si hay) */}
        {partyName && (
          <p className="mt-0.5 truncate text-xs font-medium text-zinc-700">
            {partyName}
            {reservation && (
              <span className="ml-1 text-[11px] font-normal text-zinc-500 tabular-nums">
                · {reservation.party_size}p
              </span>
            )}
          </p>
        )}

        {/* Línea 3: order info (si hay) */}
        {order && (
          <p className="mt-0.5 text-[11px] text-zinc-500">
            <span className="font-semibold text-zinc-700 tabular-nums">
              {formatMoney(order.total_cents)}
            </span>
            {activeItemsCount > 0 && (
              <span className="text-zinc-400">
                {" · "}
                {activeItemsCount} {activeItemsCount === 1 ? "item" : "items"}
              </span>
            )}
          </p>
        )}

        {/* Línea 4: reserva próxima sobre mesa libre */}
        {reservaProxima && reservation && (
          <p className="mt-0.5 inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-semibold text-indigo-700">
            <Clock className="size-2.5" />
            {formatTime(reservation.starts_at)} · {reservation.party_size}p
          </p>
        )}

        {/* Línea 5: mozo asignado — chip con color del palette del mozo
            (distinto de los colores de estado, ver lib/mozo/colors.ts). */}
        {mozoName &&
          table.mozo_id &&
          (() => {
            const p = mozoPalette(table.mozo_id);
            return (
              <p
                className={cn(
                  "mt-1 inline-flex max-w-full items-center gap-1 truncate rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1",
                  p.bg,
                  p.text,
                  p.ring,
                )}
              >
                <span
                  aria-hidden
                  className={cn("size-1.5 shrink-0 rounded-full", p.dot)}
                />
                <span className="truncate">{mozoName}</span>
              </p>
            );
          })()}
      </button>
    </li>
  );
}

// ─── Estados borde del cobro embebido (sin cuenta / sin caja) ───────────────

function CobroPanelEmptyState({
  tableLabel,
  kind,
  error,
  slug,
  tableId,
  onClose,
}: {
  tableLabel: string;
  kind: "no_cuenta" | "no_caja";
  error: string | null;
  slug: string;
  tableId: string;
  onClose: () => void;
}) {
  const isNoCuenta = kind === "no_cuenta";
  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="border-border/60 flex items-center gap-3 border-b px-4 py-3">
        <div className="min-w-0 flex-1">
          <h3 className="text-foreground text-2xl leading-none font-extrabold tracking-tight">
            {tableLabel}
          </h3>
          <p className="text-muted-foreground mt-1 text-[11px] font-semibold tracking-wider uppercase">
            Cobrar mesa
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="hover:bg-muted/60 flex-shrink-0 rounded-full p-1.5 text-zinc-500"
          aria-label="Cerrar cobro"
        >
          <X className="h-4 w-4" />
        </button>
      </header>
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
        <div className="flex size-12 items-center justify-center rounded-full bg-zinc-100 text-zinc-500">
          {isNoCuenta ? (
            <ClipboardList className="size-5" />
          ) : (
            <Receipt className="size-5" />
          )}
        </div>
        <p className="text-sm font-semibold text-zinc-900">
          {isNoCuenta ? "No hay cuenta para cobrar" : "No se puede cobrar"}
        </p>
        <p className="max-w-xs text-xs text-zinc-500">
          {isNoCuenta
            ? "Esta mesa no tiene un pedido activo. Cargá items primero."
            : (error ?? "No se pudo iniciar el cobro.")}
        </p>
        <div className="mt-1 flex flex-wrap items-center justify-center gap-2">
          {isNoCuenta ? (
            <Link
              href={`/${slug}/admin/mesa/${tableId}/pedir`}
              className="inline-flex items-center gap-1.5 rounded-full bg-zinc-900 px-4 py-2 text-xs font-semibold text-white transition hover:brightness-110"
            >
              <ClipboardList className="size-3.5" />
              Cargar pedido
            </Link>
          ) : (
            <Link
              href={`/${slug}/admin/operacion?tab=caja`}
              className="inline-flex items-center gap-1.5 rounded-full bg-zinc-900 px-4 py-2 text-xs font-semibold text-white transition hover:brightness-110"
            >
              <Receipt className="size-3.5" />
              Ir a caja
            </Link>
          )}
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center gap-1.5 rounded-full bg-zinc-100 px-4 py-2 text-xs font-semibold text-zinc-700 ring-1 ring-zinc-200 transition hover:bg-zinc-200"
          >
            Volver
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Detalle de mesa seleccionada ───────────────────────────────────────────

/** Ítem del menú de opciones (⋯) del detalle de mesa. */
type MesaMenuItem = {
  key: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  onClick: () => void;
};

/**
 * Menú de tres puntos del detalle de mesa (spec 049 · mismo patrón que las
 * cards de comandas): agrupa las acciones secundarias (walk-in alternativo,
 * volver a pedir, cargar más, transferir, trasladar) + Anular (destructiva),
 * dejando el botón primario grande afuera, a la vista.
 */
function MesaOptionsMenu({
  items,
  onAnular,
  disabled,
}: {
  items: MesaMenuItem[];
  onAnular: (() => void) | null;
  disabled: boolean;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Más acciones de la mesa"
        disabled={disabled}
        className="text-muted-foreground ring-border/70 hover:bg-muted/60 data-[popup-open]:bg-muted/60 flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl ring-1 transition disabled:opacity-50"
      >
        <MoreVertical className="size-5" strokeWidth={2.5} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        {items.map((it) => {
          const Icon = it.icon;
          return (
            <DropdownMenuItem
              key={it.key}
              onClick={it.onClick}
              disabled={disabled}
            >
              <Icon />
              {it.label}
            </DropdownMenuItem>
          );
        })}
        {onAnular && (
          <>
            {items.length > 0 && <DropdownMenuSeparator />}
            <DropdownMenuItem
              variant="destructive"
              onClick={onAnular}
              disabled={disabled}
            >
              <Ban />
              Anular mesa
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function TableDetail({
  table,
  order,
  reservation,
  mozoName,
  now,
  role,
  currentUserId,
  slug,
  pending,
  onCargarPedido,
  onPedirCuenta,
  onClose,
  onWalkIn,
  onSentarReserva,
  onTransfer,
  onTrasladar,
  onAnular,
  onChanged,
}: {
  table: FloorTable;
  order: SalonOrderRef | undefined;
  reservation: SalonReservationRef | undefined;
  mozoName: string | null;
  now: number | null;
  role: BusinessRole;
  currentUserId: string;
  slug: string;
  pending: boolean;
  /** Re-sincroniza el salón tras entregar o anular una comanda (spec 102). */
  onChanged: () => void;
  /** Abre "Cargar pedido" embebido en el panel (no navega a otra ruta). */
  onCargarPedido: () => void;
  /** Abre "Pedir cuenta" (propina/descuento/dividir → cobro) embebido. */
  onPedirCuenta: () => void;
  onClose: () => void;
  onWalkIn: () => void;
  onSentarReserva: () => void;
  onTransfer: () => void;
  onTrasladar: () => void;
  onAnular: () => void;
}) {
  const status = (table.operational_status ?? "libre") as OperationalStatus;
  const c = STATUS_COLORS[status];
  const minutes = minutesSince(table.opened_at, now);

  // Foco en la acción primaria al cambiar de mesa (spec 066, FR-007). Va sobre
  // el contenedor del footer y no sobre el botón porque cuál es el primario
  // depende del estado; `preventScroll` para que el sidebar no salte.
  const primaryRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const t = setTimeout(() => {
      primaryRef.current
        ?.querySelector<HTMLButtonElement>("button:not([disabled])")
        ?.focus({ preventScroll: true });
    }, 0);
    return () => clearTimeout(t);
  }, [table.id]);

  // ↑/↓ recorren los controles del detalle — primaria, ⋯ y cerrar (spec 075,
  // FR-008). El menú ⋯ se abre con Enter y trae sus propias flechas: no hace
  // falta aplanarlo acá.
  const detalleRef = useRef<HTMLDivElement>(null);
  const { handleKeyDown: handleDetalleKeyDown } = useArrowFocus(detalleRef);

  const canWalkIn = status === "libre";
  const canTransfer =
    status !== "libre" && (role !== "mozo" || table.mozo_id === currentUserId);
  const canAnular =
    status === "ocupada" && canTransitionMesa(role, status, "libre");
  // Trasladar la mesa entera a otra libre (spec 048): mesa con order abierta,
  // solo encargado/admin.
  const canTrasladar =
    canMoveTable(role) &&
    !!order &&
    (status === "ocupada" || status === "pidio_cuenta");
  const canPedir = status === "ocupada" || status === "pidio_cuenta";
  // "Pedir cuenta" / "Cobrar mesa" requiere order activa: sin items
  // cargados no hay nada que cobrar.
  const canShowCuenta =
    !!order && (status === "ocupada" || status === "pidio_cuenta");
  // ¿La mesa ya tiene items cargados? Decide si el botón primario es
  // "Cargar pedido" (vacía) o "Pedir cuenta" (con items, flujo natural).
  const hasItems =
    !!order && order.items.some((it) => it.cancelled_at === null);

  const tiempoLabel = formatRelativeTime(minutes);
  // Placeholders que enviarComanda usaba antes de que walk-in creara la
  // order con nombre real. Si vienen así los tratamos como "sin nombre".
  const PLACEHOLDER_CUSTOMER_NAMES = new Set(["Mesa", "Walk-in", "-"]);
  const orderName = order?.customer_name?.trim();
  const partyName =
    reservation?.customer_name ??
    (orderName && !PLACEHOLDER_CUSTOMER_NAMES.has(orderName)
      ? orderName
      : null);
  const partySize = reservation?.party_size ?? null;

  return (
    <div
      ref={detalleRef}
      onKeyDown={handleDetalleKeyDown}
      className="flex min-h-0 flex-1 flex-col"
    >
      {/* Header limpio: Mesa N · estado · tiempo · avatar mozo · close. */}
      <header className="border-border/60 flex items-center gap-3 border-b px-4 py-3">
        <div className="min-w-0 flex-1">
          <h3 className="text-foreground text-2xl leading-none font-extrabold tracking-tight">
            {table.label}
          </h3>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <span
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold",
                c.bg,
                c.text,
              )}
            >
              <span className={cn("h-1.5 w-1.5 rounded-full", c.dot)} />
              {STATUS_LABEL[status]}
            </span>
            {tiempoLabel && (
              <span className="text-muted-foreground inline-flex items-center gap-1 text-[11px] tabular-nums">
                <Clock className="h-3 w-3" />
                {tiempoLabel}
              </span>
            )}
            {mozoName &&
              table.mozo_id &&
              (() => {
                const p = mozoPalette(table.mozo_id);
                return (
                  <span
                    className={cn(
                      "inline-flex max-w-[180px] items-center gap-1 truncate rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 @lg:max-w-[300px]",
                      p.bg,
                      p.text,
                      p.ring,
                    )}
                  >
                    <span
                      aria-hidden
                      className={cn("h-1.5 w-1.5 shrink-0 rounded-full", p.dot)}
                    />
                    <span className="truncate">{mozoName}</span>
                  </span>
                );
              })()}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="hover:bg-muted/60 flex-shrink-0 rounded-full p-1.5 text-zinc-500"
          aria-label="Cerrar detalle"
        >
          <X className="h-4 w-4" />
        </button>
      </header>

      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        {/* Comensal: solo se muestra si hay reserva o nombre real cargado.
            Si es walk-in sin nombre, no agregamos un bloque vacío. */}
        {(partyName || reservation) && (
          <div
            className={cn(
              "flex items-center gap-2 rounded-xl p-3 text-sm",
              reservation
                ? "border border-indigo-100 bg-indigo-50/60"
                : "bg-zinc-50",
            )}
          >
            <Users
              className={cn(
                "h-4 w-4 flex-shrink-0",
                reservation ? "text-indigo-600" : "text-zinc-500",
              )}
            />
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold text-zinc-900">
                {partyName}
                {partySize != null && (
                  <span className="ml-1.5 text-xs font-normal text-zinc-500 tabular-nums">
                    · {partySize}p
                  </span>
                )}
              </p>
              {reservation && (
                <p className="text-[11px] text-indigo-700 tabular-nums">
                  Reserva · {formatTime(reservation.starts_at)}
                </p>
              )}
            </div>
          </div>
        )}
        {reservation?.notes && (
          <p className="-mt-1 max-w-prose px-1 text-xs text-zinc-600 italic">
            “{reservation.notes}”
          </p>
        )}

        {/* Orden + comandas con estado. Si pidió cuenta y cocina ya
            entregó todo, el bloque comandas no aporta — se oculta. */}
        {order && (
          <OrderSummaryCard
            order={order}
            slug={slug}
            hideComandasIfAllDelivered={status === "pidio_cuenta"}
            canAnular={canCancelItem(role)}
            tableLabel={table.label}
            onChanged={onChanged}
          />
        )}

        {/* Empty state: mesa libre sin reserva. En vez de dejar un hueco
            grande entre header y footer, ponemos info útil + hint a la
            acción primaria. */}
        {status === "libre" && !order && !reservation && (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-zinc-200 bg-zinc-50/60 px-6 py-10 text-center">
            <div className="flex size-12 items-center justify-center rounded-full bg-white ring-1 ring-zinc-200">
              <Users className="size-5 text-zinc-400" />
            </div>
            <p className="mt-3 text-sm font-semibold text-zinc-900">
              Mesa disponible
            </p>
            <p className="mt-1 text-xs text-zinc-500">
              {table.seats} {table.seats === 1 ? "silla" : "sillas"}
            </p>
            <p className="mt-3 max-w-[18rem] text-xs text-zinc-500">
              Tocá{" "}
              <span className="font-semibold text-zinc-700">
                Sentar walk-in
              </span>{" "}
              para abrir la mesa con un comensal que llegó sin reserva.
            </p>
          </div>
        )}
      </div>

      {/* Footer: la acción PRIMARIA grande queda a la vista; el resto
          (secundarias + Anular) va a un menú de tres puntos (⋯), mismo patrón
          que las cards de comandas para que el panel ocupe poco.

          El botón primario se enfoca al seleccionar la mesa (spec 066, FR-007):
          click en el plano → Enter → sigue el flujo (walk-in / pedido / cobro)
          sin volver al mouse. */}
      <div ref={primaryRef} className="border-border/60 border-t p-3">
        {(() => {
          // Mismo estilo que el drawer del mozo: h-14 rounded-2xl con shadow.
          const primaryClass =
            "flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-emerald-600 text-base font-semibold text-white shadow-sm transition active:scale-[0.98] disabled:opacity-60";
          // El primario se enfoca solo al abrir el detalle: el chip cuenta que
          // con Enter alcanza (spec 075, FR-021).
          const enterHint = (
            <kbd className="rounded bg-white/20 px-1.5 py-0.5 text-[10px] font-semibold">
              ↵
            </kbd>
          );
          // Cobrar pasa por el flujo de cuenta (propina/descuento/dividir →
          // cobro), igual que el mozo. Un solo botón primario, naranja.
          const primaryAmberClass =
            "flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-amber-500 text-base font-semibold text-white shadow-sm transition active:scale-[0.98] disabled:opacity-60";

          // ── Acción primaria: depende del estado Y de si hay items cargados.
          //    libre → Sentar walk-in/reserva · pidio_cuenta u ocupada c/items
          //    → Cobrar · ocupada s/items → Cargar pedido. Una sola, a la vista.
          let primary: React.ReactNode = null;
          if (canWalkIn && reservation) {
            primary = (
              <button
                type="button"
                onClick={onSentarReserva}
                disabled={pending}
                className={primaryClass}
              >
                <UserCheck className="h-5 w-5" />
                Sentar reserva
                {enterHint}
              </button>
            );
          } else if (canWalkIn) {
            primary = (
              <button
                type="button"
                onClick={onWalkIn}
                disabled={pending}
                className={primaryClass}
              >
                <UserPlus className="h-5 w-5" />
                Sentar walk-in
                {enterHint}
              </button>
            );
          } else if (canShowCuenta && (status === "pidio_cuenta" || hasItems)) {
            primary = (
              <button
                type="button"
                onClick={onPedirCuenta}
                disabled={pending}
                className={primaryAmberClass}
              >
                <Receipt className="h-5 w-5" />
                Cobrar
                {enterHint}
              </button>
            );
          } else if (canPedir) {
            primary = (
              <button
                type="button"
                onClick={() => onCargarPedido()}
                disabled={pending}
                className={primaryClass}
              >
                <ClipboardList className="h-5 w-5" />
                Cargar pedido
                {enterHint}
              </button>
            );
          }

          // ── Secundarias → ítems del menú (⋯). Anular va aparte (destructiva).
          const showWalkInSec = canWalkIn && !!reservation;
          const showVolverAPedir = status === "pidio_cuenta" && canPedir;
          const showCargarMas = status === "ocupada" && hasItems && canPedir;
          const menuItems: MesaMenuItem[] = [];
          if (showWalkInSec)
            menuItems.push({
              key: "walkin",
              icon: UserPlus,
              label: "Sentar walk-in",
              onClick: onWalkIn,
            });
          if (showVolverAPedir)
            menuItems.push({
              key: "volver",
              icon: ClipboardList,
              label: "Volver a pedir",
              onClick: onCargarPedido,
            });
          if (showCargarMas)
            menuItems.push({
              key: "cargar-mas",
              icon: ClipboardList,
              label: "Cargar más",
              onClick: onCargarPedido,
            });
          if (canTransfer)
            menuItems.push({
              key: "transferir",
              icon: ArrowLeftRight,
              label: "Transferir mozo",
              onClick: onTransfer,
            });
          if (canTrasladar)
            menuItems.push({
              key: "trasladar",
              icon: MoveRight,
              label: "Trasladar mesa",
              onClick: onTrasladar,
            });

          const hasMenu = menuItems.length > 0 || canAnular;
          if (!primary && !hasMenu) return null;

          return (
            /* Tope de ancho: el primario es `w-full` y con el panel ancho
               quedaba una losa de 810px con el label flotando en el medio. */
            <div className="mx-auto flex w-full max-w-2xl items-stretch gap-2">
              {primary && <div className="min-w-0 flex-1">{primary}</div>}
              {hasMenu && (
                <MesaOptionsMenu
                  items={menuItems}
                  onAnular={canAnular ? onAnular : null}
                  disabled={pending}
                />
              )}
            </div>
          );
        })()}
      </div>
    </div>
  );
}
