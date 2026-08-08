"use client";

import {
  Suspense,
  use,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronDown, MapPin } from "lucide-react";

import { CajaAdminBoard } from "@/components/admin/local/caja-admin-board";
import { ComandasKanban } from "@/components/admin/local/comandas-kanban";
import { FichajeTab } from "@/components/admin/local/fichaje-tab";
import { RendicionMozosTab } from "@/components/admin/local/rendicion-mozos-tab";
import { SalonDesktop } from "@/components/admin/local/salon-desktop";
import { OrdersRealtimeBoard } from "@/components/admin/orders-realtime-board";
import { AdminDayList } from "@/components/reservations/admin-day-list";
import { ErrorBoundary } from "@/components/shared/error-boundary";
import {
  SalonBoardSkeleton,
  TabContentSkeleton,
} from "@/components/skeletons/operacion-skeleton";
import {
  countCajas,
  countPedidosNuevos,
  countPresentes,
  countRendicionesPendientes,
  countReservasPorSentar,
  countSalonOcupadas,
} from "@/app/[business_slug]/admin/(authed)/operacion/counts";
import type {
  CajaData,
  ComandasData,
  FichajeData,
  PedidosData,
  RendicionData,
  ReservasData,
  SalonData,
} from "@/app/[business_slug]/admin/(authed)/operacion/data";
import type { BusinessRole } from "@/lib/admin/context";
import type { SalonOption } from "@/lib/admin/floor-plan/queries";
import { salonFilterStorageKey } from "@/lib/admin/salon-filter";
import { useStickyMultiFilter } from "@/lib/ui/use-sticky-filter";
import { useOnActivate, useTabParam } from "@/lib/ui/use-tab-param";
import { cn } from "@/lib/utils";

const TABS = [
  "salon",
  "reservas",
  "comandas",
  "pedidos",
  "caja",
  "rendicion",
  "fichaje",
] as const;

type Tab = (typeof TABS)[number];

/**
 * Tabs a las que aplica el filtro por salón (spec 065, FR-002).
 *
 * En Caja / Rendición / Fichaje / Pedidos online el selector se **oculta**: no
 * tienen dimensión salón y dejarlo a la vista invitaría a leer un total de caja
 * como si estuviera recortado por salón.
 */
const SALON_FILTERABLE: Tab[] = ["salon", "comandas", "reservas"];

type ShellProps = {
  slug: string;
  businessId: string;
  timezone: string;
  currentUserId: string;
  role: BusinessRole;
  /** Salones del negocio (id + nombre) para el selector de la barra de tabs. */
  salones: SalonOption[];
  salon: Promise<SalonData>;
  comandas: Promise<ComandasData>;
  pedidos: Promise<PedidosData>;
  caja: Promise<CajaData>;
  rendicion: Promise<RendicionData>;
  fichaje: Promise<FichajeData>;
  reservas: Promise<ReservasData>;
};

// ─── Pills: nunca un "0" provisional (FR-006) ────────────────────────────────
// Mientras la promesa del grupo está pendiente, el <Suspense> muestra "—"; el
// número se calcula recién con el dato resuelto, con el mismo predicado que usa
// la tab (FR-012). Un rechazo cae al ErrorBoundary → "—" (no tumba el shell).

function CountFallback() {
  return <span className="opacity-40">—</span>;
}

function CountValue<T>({
  promise,
  compute,
}: {
  promise: Promise<T>;
  compute: (d: T) => number;
}) {
  return <>{compute(use(promise))}</>;
}

function Pill<T>({
  promise,
  compute,
  override,
}: {
  promise: Promise<T>;
  compute: (d: T) => number;
  /**
   * Dato ya resuelto que le gana a la promesa. Lo usa Mesas desde la spec 102:
   * el plano se actualiza por refetch de tab, y sin esto el badge se quedaría
   * con el conteo del page-load — contradiciendo, en la misma barra, a lo que
   * muestra el panel de al lado.
   */
  override?: T | null;
}) {
  if (override != null) return <>{compute(override)}</>;
  return (
    <ErrorBoundary fallback={<CountFallback />}>
      <Suspense fallback={<CountFallback />}>
        <CountValue promise={promise} compute={compute} />
      </Suspense>
    </ErrorBoundary>
  );
}

// ─── Error de carga de una tab (FR-007) ──────────────────────────────────────
// Para tabs de plata (Caja / Rendición): mensaje explícito y accionable, jamás
// un estado vacío que se lea como "no hay nada".

function TabLoadError({ money }: { money?: boolean }) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center justify-center gap-3 rounded-2xl border border-red-200 bg-red-50 p-8 text-center">
      <p className="text-sm font-semibold text-red-800">
        {money
          ? "No se pudieron cargar los datos de esta sección."
          : "No se pudo cargar esta sección."}
      </p>
      <p className="max-w-sm text-xs text-red-700">
        {money
          ? "Esto NO significa que no haya nada: hay datos, pero fallaron al cargar. Reintentá antes de tomar decisiones de cierre."
          : "Reintentá para volver a cargarla."}
      </p>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="rounded-full bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700"
      >
        Reintentar
      </button>
    </div>
  );
}

// ─── Paneles: cada uno lee su promesa con use() ──────────────────────────────

function SalonPanel({
  promise,
  slug,
  businessId,
  currentUserId,
  role,
  visiblePlanIds,
  distribuirOpen,
  onDistribuirOpen,
  onDistribuirClose,
  active,
  onServerData,
  onReservationsChanged,
}: {
  promise: Promise<SalonData>;
  slug: string;
  businessId: string;
  currentUserId: string;
  role: BusinessRole;
  visiblePlanIds: string[];
  distribuirOpen: boolean;
  onDistribuirOpen: () => void;
  onDistribuirClose: () => void;
  active: boolean;
  onServerData: (d: SalonData) => void;
  onReservationsChanged: () => void;
}) {
  const { floorPlans, dineInOrders, reservations, mozos } = use(promise);
  return (
    <SalonDesktop
      slug={slug}
      businessId={businessId}
      visiblePlanIds={visiblePlanIds}
      floorPlans={floorPlans}
      dineInOrders={dineInOrders}
      reservations={reservations}
      mozos={mozos}
      currentUserId={currentUserId}
      role={role}
      distribuirOpen={distribuirOpen}
      onDistribuirOpen={onDistribuirOpen}
      onDistribuirClose={onDistribuirClose}
      tabActive={active}
      onServerData={onServerData}
      onReservationsChanged={onReservationsChanged}
    />
  );
}

function PedidosPanel({
  promise,
  slug,
  businessId,
  timezone,
}: {
  promise: Promise<PedidosData>;
  slug: string;
  businessId: string;
  timezone: string;
}) {
  const {
    initialOrders,
    scheduledSlots,
    marchLeadPickupMin,
    marchLeadDeliveryMin,
  } = use(promise);
  return (
    <OrdersRealtimeBoard
      businessId={businessId}
      slug={slug}
      timezone={timezone}
      initialOrders={initialOrders}
      scheduledSlots={scheduledSlots}
      marchLeadPickupMin={marchLeadPickupMin}
      marchLeadDeliveryMin={marchLeadDeliveryMin}
    />
  );
}

function ComandasPanel({
  promise,
  slug,
  businessId,
  salonIds,
  salonLabel,
  active,
}: {
  promise: Promise<ComandasData>;
  slug: string;
  businessId: string;
  salonIds: string[];
  salonLabel: string | null;
  active: boolean;
}) {
  const { initialComandas, stations, mozos, printAgentLastSeenAt } =
    use(promise);
  return (
    <ComandasKanban
      slug={slug}
      businessId={businessId}
      initialComandas={initialComandas}
      stations={stations}
      mozos={mozos}
      printAgentLastSeenAt={printAgentLastSeenAt}
      salonIds={salonIds}
      salonLabel={salonLabel}
      active={active}
    />
  );
}

function CajaPanel({
  promise,
  slug,
  active,
}: {
  promise: Promise<CajaData>;
  slug: string;
  active: boolean;
}) {
  const { cajas } = use(promise);
  return <CajaAdminBoard slug={slug} cajas={cajas} active={active} />;
}

function RendicionPanel({
  rendicionPromise,
  cajaPromise,
  slug,
  role,
}: {
  rendicionPromise: Promise<RendicionData>;
  cajaPromise: Promise<CajaData>;
  slug: string;
  role: BusinessRole;
}) {
  const {
    rendicionPendientes,
    rendicionHistorial,
    cajaAssignments,
    businessMembers,
  } = use(rendicionPromise);
  // La tab de rendición también necesita las cajas: se lee de la MISMA promesa
  // que alimenta la tab Caja y su pill (fuente única, sin duplicar la query).
  const { cajas } = use(cajaPromise);
  return (
    <RendicionMozosTab
      slug={slug}
      initialPendientes={rendicionPendientes}
      initialHistorial={rendicionHistorial}
      cajas={cajas}
      cajaAssignments={cajaAssignments}
      members={businessMembers}
      showAssignments={role === "admin"}
    />
  );
}

function ReservasPanel({
  promise,
  slug,
  timezone,
  salonIds,
}: {
  promise: Promise<ReservasData>;
  slug: string;
  timezone: string;
  salonIds: string[];
}) {
  const { date, rows, floorPlans, activeTables, mode, services } = use(promise);
  return (
    <AdminDayList
      slug={slug}
      date={date}
      rows={rows}
      timezone={timezone}
      floorPlans={floorPlans}
      activeTables={activeTables}
      mode={mode}
      services={services}
      salonIds={salonIds}
      // Embebida en el operativo: el navegador de fechas se queda acá
      // (`?tab=reservas&date=…`) en vez de saltar a /admin/reservas.
      datePath={`/${slug}/admin/operacion`}
    />
  );
}

function FichajePanel({
  promise,
  slug,
  active,
}: {
  promise: Promise<FichajeData>;
  slug: string;
  active: boolean;
}) {
  const { initialPresent, todaySummary } = use(promise);
  return (
    <FichajeTab
      slug={slug}
      initialPresent={initialPresent}
      todaySummary={todaySummary}
      active={active}
    />
  );
}

/**
 * Selector de salón del operativo (spec 065, FR-001).
 *
 * Un solo control para las tres tabs que tienen salón. La elección se recuerda
 * por máquina: la tablet de la terraza mira la terraza.
 *
 * **Multi-selección** (fast-follow 2026-07-30): un encargado puede cubrir dos
 * salones a la vez, así que son checkboxes y no un `<select>`. Ninguno marcado
 * = todos; no hay opción "Todos" que se pueda combinar con las otras y quedar
 * en un estado contradictorio — el botón «Ver todos» simplemente vacía.
 *
 * Vive **pegado a las tabs** (izquierda) a propósito: en la esquina superior
 * derecha flota la campana de notificaciones del panel admin y se chocaban.
 */
function SalonSelector({
  salones,
  selected,
  onToggle,
  onClear,
}: {
  salones: SalonOption[];
  selected: string[];
  onToggle: (id: string) => void;
  onClear: () => void;
}) {
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const filtrando = selected.length > 0;

  // Cerrar al tocar afuera / con Escape. Sin librería: es un menú de 3 líneas.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const label = !filtrando
    ? "Todos los salones"
    : selected.length === 1
      ? (salones.find((s) => s.id === selected[0])?.name ?? "1 salón")
      : `${selected.length} salones`;

  return (
    <div ref={boxRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label="Filtrar por salón"
        className={cn(
          "inline-flex items-center gap-1.5 rounded-xl px-2.5 py-2 text-sm font-semibold ring-1 transition",
          // Filtrando = estado "no estás viendo todo": tiene que cantar.
          filtrando
            ? "bg-amber-50 text-amber-900 ring-amber-300"
            : "bg-white text-zinc-500 ring-zinc-200/70 hover:text-zinc-900",
        )}
      >
        <MapPin className="size-4 shrink-0" strokeWidth={2.5} />
        <span className="whitespace-nowrap">{label}</span>
        <ChevronDown className="size-3.5 shrink-0 opacity-60" strokeWidth={3} />
      </button>

      {open && (
        <div className="absolute left-0 top-full z-50 mt-1.5 min-w-52 rounded-xl bg-white p-1 shadow-lg ring-1 ring-zinc-200">
          <button
            type="button"
            onClick={onClear}
            className={cn(
              "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm font-semibold transition",
              filtrando
                ? "text-zinc-500 hover:bg-zinc-50"
                : "bg-zinc-100 text-zinc-900",
            )}
          >
            Todos los salones
          </button>
          <div className="my-1 h-px bg-zinc-100" />
          {salones.map((s) => {
            const on = selected.includes(s.id);
            return (
              <button
                key={s.id}
                type="button"
                role="checkbox"
                aria-checked={on}
                onClick={() => onToggle(s.id)}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm font-semibold text-zinc-700 transition hover:bg-zinc-50"
              >
                <span
                  className={cn(
                    "flex size-4 shrink-0 items-center justify-center rounded border transition",
                    on
                      ? "border-amber-500 bg-amber-500 text-white"
                      : "border-zinc-300",
                  )}
                >
                  {on && <Check className="size-3" strokeWidth={4} />}
                </span>
                {s.name}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function TabsInner({
  slug,
  businessId,
  timezone,
  currentUserId,
  role,
  salones,
  salon,
  comandas,
  pedidos,
  caja,
  rendicion,
  fichaje,
  reservas,
}: ShellProps) {
  // Default = "salon" porque es la pantalla principal del operativo en local.
  // La tab es estado de CLIENTE y la URL se escribe con la History API: cambiar
  // de tab no dispara ningún request (spec 101). Antes era `router.replace`, o
  // sea una navegación soft que re-ejecutaba la page entera — las 7 promesas,
  // ~30 queries — para pintar una sola tab.
  const [active, setTab] = useTabParam<Tab>("tab", "salon", TABS);

  // Keep-alive: una tab se monta la PRIMERA vez que se entra y de ahí en más se
  // esconde con CSS en vez de desmontarse (es lo que ya hacía Pedidos para no
  // tirar su realtime, generalizado a todas). Sin esto, cortar la navegación
  // haría que cada vuelta a una tab remonte `SalonDesktop` / `ComandasKanban`,
  // re-suscriba sus channels (`getSession()` + `setAuth()` cada vez) y pierda
  // scroll y filtros. Se monta lazy —no las 7 de una— para que el primer
  // pintado siga siendo el de Mesas.
  const visited = useRef<Set<Tab>>(new Set<Tab>([active]));
  visited.current.add(active);
  const mounted = (t: Tab) => visited.current.has(t);
  // `h-full` en la activa: los paneles que lo usan (Mesas, Fichaje) colgaban de
  // un contenedor con altura definida y este wrapper queda en el medio.
  const paneClass = (t: Tab) => (active === t ? "h-full" : "hidden");

  // ── Guarda de frescura de las tabs SIN refetch propio ──────────────────────
  // Cortar la navegación deja la promesa RSC congelada al page-load, así que
  // una tab que no sabe recargarse sola mostraría el estado de hace horas.
  // Reservas, Rendición y Fichaje están en ese caso: no tienen action de tab ni
  // realtime propio (el de reservas vive DENTRO de SalonDesktop, que puede no
  // haber montado nunca si la sesión arrancó en otra tab).
  //
  // El puente es `router.refresh()`: cuesta lo mismo que costaba ANTES cada
  // click de tab, pero ahora sólo al entrar a estas tres — y jamás muestra
  // plata vieja. Las specs 102/103 lo reemplazan por un refetch por tab.
  //
  // Van acá y no en cada panel a propósito: el shell NO monta lazy (lo lazy es
  // el panel), así que `active === "x"` transiciona false→true también en la
  // PRIMERA entrada. Y al abrir directo en una de estas tabs (`?tab=rendicion`)
  // no dispara nada, que es lo correcto: el server acaba de renderizarla.
  const router = useRouter();
  const refrescarRuta = () => router.refresh();

  // La única suscripción a `reservations` de la app vive en SalonDesktop
  // (spec 102). Si el encargado está justo mirando el libro del día, una
  // reserva nueva de la web o del chatbot tiene que aparecerle sin tocar nada:
  // sólo ahí vale re-correr la ruta. Si está en otra tab no hace falta — al
  // entrar a Reservas ya se revalida por el puente de abajo.
  const activeRef = useRef(active);
  activeRef.current = active;
  const onReservasCambiaron = () => {
    if (activeRef.current === "reservas") router.refresh();
  };
  useOnActivate(active === "reservas", refrescarRuta);
  useOnActivate(active === "rendicion", refrescarRuta);
  useOnActivate(active === "fichaje", refrescarRuta);

  // Como todo /admin/operacion es fullscreen, colapsamos el sidebar al entrar.
  useEffect(() => {
    window.dispatchEvent(new CustomEvent("admin-sidebar-collapse"));
  }, []);

  // Modo "Distribuir mozos": vive en el shell para que el botón quede alineado
  // con las tabs en el header (en vez de dentro del SalonDesktop).
  const [distribuirOpen, setDistribuirOpen] = useState(false);

  // Último snapshot que trajo el refetch de la tab Mesas (spec 102), para que
  // su badge no quede contando lo del page-load.
  const [salonData, setSalonData] = useState<SalonData | null>(null);

  // ── Filtro por salón (spec 065) ──
  // Preferencia por máquina + negocio, multi-selección (vacío = todos).
  // Gobierna Mesas, Comandas y Reservas; las pills cuentan sobre el mismo dato
  // filtrado (FR-006).
  const salonIds = useMemo(() => salones.map((s) => s.id), [salones]);
  const [salonFilter, toggleSalon, clearSalones] = useStickyMultiFilter(
    salonFilterStorageKey(businessId),
    salonIds,
  );
  const salonLabel =
    salonFilter.length === 1
      ? (salones.find((s) => s.id === salonFilter[0])?.name ?? null)
      : salonFilter.length > 1
        ? `${salonFilter.length} salones`
        : null;
  // Con un solo salón no hay nada que elegir.
  const showSalonFilter =
    salones.length > 1 && SALON_FILTERABLE.includes(active);

  const tabsBar = (
    <nav
      aria-label="Secciones del operativo"
      className="inline-flex rounded-2xl bg-white p-1 ring-1 ring-zinc-200/70"
    >
      <TabButton
        active={active === "salon"}
        onClick={() => setTab("salon")}
        count={
          <Pill
            promise={salon}
            override={salonData}
            compute={(d) => countSalonOcupadas(d.floorPlans, salonFilter)}
          />
        }
      >
        Mesas
      </TabButton>
      <TabButton
        active={active === "reservas"}
        onClick={() => setTab("reservas")}
        count={<Pill promise={reservas} compute={(d) => countReservasPorSentar(d.rows, salonFilter)} />}
      >
        Reservas
      </TabButton>
      {/* Comandas va SIN pill: el contador de "activas" no coincidía con lo que
          se ve en el kanban de la tab, así que un número mal es peor que
          ninguno. La tab muestra el estado real. */}
      <TabButton active={active === "comandas"} onClick={() => setTab("comandas")}>
        Comandas
      </TabButton>
      <TabButton
        active={active === "pedidos"}
        onClick={() => setTab("pedidos")}
        count={<Pill promise={pedidos} compute={(d) => countPedidosNuevos(d.initialOrders)} />}
      >
        Pedidos online
      </TabButton>
      <TabButton
        active={active === "caja"}
        onClick={() => setTab("caja")}
        count={<Pill promise={caja} compute={(d) => countCajas(d.cajas)} />}
      >
        Caja
      </TabButton>
      <TabButton
        active={active === "rendicion"}
        onClick={() => setTab("rendicion")}
        count={<Pill promise={rendicion} compute={(d) => countRendicionesPendientes(d.rendicionPendientes)} />}
      >
        Rendición
      </TabButton>
      <TabButton
        active={active === "fichaje"}
        onClick={() => setTab("fichaje")}
        count={<Pill promise={fichaje} compute={(d) => countPresentes(d.initialPresent)} />}
      >
        Fichaje
      </TabButton>
    </nav>
  );

  return (
    <div className="fixed inset-x-0 bottom-0 top-14 z-30 flex flex-col bg-zinc-50 transition-[left] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] md:left-[var(--admin-sidebar-width,60px)] md:top-0">
      {/* El selector va pegado a las tabs, NO en la esquina derecha: ahí flota
          la campana de notificaciones del panel admin y se chocaban.

          El `overflow-x-auto` va SOLO en las tabs, no en la barra entera: un
          contenedor que scrollea en X establece un contexto de recorte también
          en Y, y con la barra entera scrolleando el desplegable del selector
          quedaba cortado (no tapado — por eso subirle el z-index no servía). */}
      <div className="border-border/60 flex items-center gap-3 border-b bg-white/95 px-3 py-3 pr-16 backdrop-blur sm:px-4 sm:pr-20">
        <div className="min-w-0 overflow-x-auto">{tabsBar}</div>
        {showSalonFilter && (
          <SalonSelector
            salones={salones}
            selected={salonFilter}
            onToggle={toggleSalon}
            onClear={clearSalones}
          />
        )}
      </div>
      <div className="flex-1 overflow-auto p-4">
        {mounted("salon") && (
          <div className={paneClass("salon")}>
            <ErrorBoundary fallback={<TabLoadError />}>
              <Suspense fallback={<SalonBoardSkeleton />}>
                <SalonPanel
                  promise={salon}
                  slug={slug}
                  businessId={businessId}
                  currentUserId={currentUserId}
                  role={role}
                  visiblePlanIds={salonFilter}
                  distribuirOpen={distribuirOpen}
                  onDistribuirOpen={() => setDistribuirOpen(true)}
                  onDistribuirClose={() => setDistribuirOpen(false)}
                  active={active === "salon"}
                  onServerData={setSalonData}
                  onReservationsChanged={onReservasCambiaron}
                />
              </Suspense>
            </ErrorBoundary>
          </div>
        )}
        {/* Pedidos online: SIEMPRE montado (oculto con CSS) para que su
            suscripción realtime no se caiga al cambiar de tab. */}
        <div className={paneClass("pedidos")}>
          <ErrorBoundary fallback={<TabLoadError />}>
            <Suspense fallback={<TabContentSkeleton />}>
              <PedidosPanel
                promise={pedidos}
                slug={slug}
                businessId={businessId}
                timezone={timezone}
              />
            </Suspense>
          </ErrorBoundary>
        </div>
        {mounted("reservas") && (
          <div className={paneClass("reservas")}>
            <ErrorBoundary fallback={<TabLoadError />}>
              <Suspense fallback={<TabContentSkeleton />}>
                <ReservasPanel
                  promise={reservas}
                  slug={slug}
                  timezone={timezone}
                  salonIds={salonFilter}
                />
              </Suspense>
            </ErrorBoundary>
          </div>
        )}
        {mounted("comandas") && (
          <div className={paneClass("comandas")}>
            <ErrorBoundary fallback={<TabLoadError />}>
              <Suspense fallback={<TabContentSkeleton />}>
                <ComandasPanel
                  promise={comandas}
                  slug={slug}
                  businessId={businessId}
                  salonIds={salonFilter}
                  salonLabel={salonLabel}
                  active={active === "comandas"}
                />
              </Suspense>
            </ErrorBoundary>
          </div>
        )}
        {mounted("caja") && (
          <div className={paneClass("caja")}>
            <ErrorBoundary fallback={<TabLoadError money />}>
              <Suspense fallback={<TabContentSkeleton />}>
                <CajaPanel
                  promise={caja}
                  slug={slug}
                  active={active === "caja"}
                />
              </Suspense>
            </ErrorBoundary>
          </div>
        )}
        {mounted("rendicion") && (
          <div className={paneClass("rendicion")}>
            <ErrorBoundary fallback={<TabLoadError money />}>
              <Suspense fallback={<TabContentSkeleton />}>
                <RendicionPanel
                  rendicionPromise={rendicion}
                  cajaPromise={caja}
                  slug={slug}
                  role={role}
                />
              </Suspense>
            </ErrorBoundary>
          </div>
        )}
        {mounted("fichaje") && (
          <div className={paneClass("fichaje")}>
            <ErrorBoundary fallback={<TabLoadError />}>
              <Suspense fallback={<TabContentSkeleton />}>
                <FichajePanel
                  promise={fichaje}
                  slug={slug}
                  active={active === "fichaje"}
                />
              </Suspense>
            </ErrorBoundary>
          </div>
        )}
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  count,
  children,
}: {
  active: boolean;
  onClick: () => void;
  /** Sin `count` la tab se dibuja sin badge (no un badge vacío). */
  count?: ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "relative inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-xl px-3 py-2 text-sm font-semibold transition sm:px-4",
        active ? "bg-zinc-100 text-zinc-900" : "text-zinc-500 hover:text-zinc-900",
      )}
    >
      {children}
      {count !== undefined && (
        <span
          className={cn(
            "rounded-full px-1.5 py-0.5 text-[0.65rem] font-semibold tabular-nums",
            active
              ? "bg-white text-zinc-900 ring-1 ring-zinc-200"
              : "bg-zinc-100 text-zinc-500",
          )}
        >
          {count}
        </span>
      )}
    </button>
  );
}

export function LocalShell(props: ShellProps) {
  return (
    <Suspense fallback={null}>
      <TabsInner {...props} />
    </Suspense>
  );
}
