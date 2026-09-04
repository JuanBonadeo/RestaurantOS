"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import {
  Banknote,
  Check,
  CreditCard,
  Link as LinkIcon,
  BookUser,
  MoreHorizontal,
  QrCode,
  Wallet,
} from "lucide-react";
import { toast } from "sonner";

import type { ActionResult } from "@/lib/actions";
import { calculateAdjustment } from "@/lib/billing/adjustment";
import { cashCharge, isCashShortPayment } from "@/lib/billing/totals";
import type {
  Caja,
  PaymentMethod,
  PaymentMethodConfig,
} from "@/lib/caja/types";
import { formatCurrency } from "@/lib/currency";
import {
  FiarAQuien,
  type ClienteParaFiar,
} from "@/components/billing/fiar-a-quien";
import { indexFromDigit } from "@/lib/ui/roving";
import { useRovingList } from "@/lib/ui/use-roving-list";
import { cn } from "@/lib/utils";

// ============================================================================
// El formulario de cobro, una sola vez (spec 062).
//
// No sabe qué está cobrando: recibe **cuánto falta** y **qué hacer al
// confirmar**. Por eso sirve igual para una mesa abierta, para un pedido del
// board y para la venta de mostrador — donde la orden nace recién al cobrar.
//
// Adentro viven las reglas de dinero, una sola vez: ajuste por método, la
// guarda de efectivo, el vuelto, los últimos 4 dígitos, la nota obligatoria, el
// bloqueo mientras el pago está en vuelo y la idempotencia por `requestId`.
//
// Afuera queda todo lo que depende del contexto: qué orden/split se cobra,
// cerrar la orden, liberar la mesa, facturar, refrescar.
// ============================================================================

export type CobroSubmit = {
  method: PaymentMethod;
  /** Con el ajuste del método ya aplicado — es lo que paga el cliente. */
  amountCents: number;
  tipCents: number;
  cajaId: string;
  lastFour?: string;
  cardBrand?: "visa" | "mastercard" | "amex" | "otro";
  notes?: string;
  adjustmentPercent: number;
  adjustmentCents: number;
  /** Estable entre taps del mismo intento; nuevo después de un cobro OK. */
  requestId: string;
  /** A quién se le fía (spec 141). Sólo con `method = 'cuenta_corriente'`. */
  creditCustomerId?: string | null;
};

/**
 * La propina no es un booleano (hallazgo T002-2): el mozo la trae de la orden
 * —se carga en el paso Cuenta y no se toca al cobrar— y el encargado la edita
 * acá mismo.
 */
export type CobroTip =
  | { mode: "none" }
  | { mode: "fixed"; cents: number }
  | { mode: "editable"; initialCents?: number };

export type CobroFormProps<T = unknown> = {
  /** Lo que falta cobrar, SIN ajuste de método. */
  amountDueCents: number;
  cajas: Caja[];
  cajaId: string;
  onCajaChange?: (cajaId: string) => void;
  methodConfigs: PaymentMethodConfig[];
  /** Mostrador no ofrece MP; el pedido sí. */
  allowedMethods?: PaymentMethod[];
  /**
   * Fiar (spec 141). Sin esta prop el método **no se ofrece**: el server igual
   * lo rechaza (`canFiar`), pero un botón que siempre falla es peor que no
   * tenerlo. La lista son los clientes con `credit_enabled`; el buscador no
   * ofrece a nadie más, que es la regla D2.
   */
  cuentaCorriente?: {
    /** Para buscar y dar de alta desde el propio cobro (D2 revisada). */
    slug: string;
    /** Los que ya tienen cuenta: la lista de apertura, sin tipear nada. */
    clientes: ClienteParaFiar[];
  };
  tip?: CobroTip;
  /** Ergonomía. `touch` = mozo en el celular; `compact` = paneles del admin. */
  size?: "touch" | "compact";
  /**
   * El camino del formulario (spec 157 · D2).
   *
   * `estandar` (default) — dos pasos: elegir método y después cargar los datos.
   * Es lo que quieren la mesa y el pedido, donde cobrar es un momento con su
   * propia pantalla.
   *
   * `rapido` — una sola pantalla, con el método ya elegido. Es la ergonomía del
   * mostrador (spec 058): «tipear, Enter, Enter, cobrar». Ahí un paso de más no
   * es un paso de más — es una venta más lenta en la barra en hora pico, que es
   * exactamente lo que hizo que esa pantalla se escribiera aparte. Ahora la
   * ergonomía entra acá y el código deja de estar dos veces.
   */
  flujo?: "estandar" | "rapido";
  /**
   * Para encadenar el foco desde afuera: en el mostrador el ↓ del carrito
   * aterriza en Confirmar, que es la acción del panel (spec 075).
   */
  confirmRef?: React.RefObject<HTMLButtonElement | null>;
  /** Se llama al confirmar. El caller elige el action — el form no importa
   *  server actions. Devuelve el resultado completo: el mozo lo usa para
   *  mergear la fila ya persistida sin refrescar (spec 41). */
  onSubmit: (input: CobroSubmit) => Promise<ActionResult<T>>;
  /** Corre después de un cobro OK, con **lo que devolvió el server**. El mozo
   *  lo usa para mergear la fila ya persistida sin refrescar la pantalla, y el
   *  encargado para saber si la orden quedó cerrada. Hallazgo T002-1. */
  onPaid?: (data: T) => void;
  /** Volver atrás (deseleccionar el método). */
  onCancel?: () => void;
  /** MP: preference + link/QR + polling. Sin esto, no se ofrece MP. */
  mp?: {
    start: (input: {
      method: "mp_link" | "mp_qr";
      amountCents: number;
      tipCents: number;
      cajaId: string;
    }) => Promise<ActionResult<{ paymentId: string; initPoint: string }>>;
    onConfirmed: () => void;
  };
};

const METHODS: Array<{
  value: PaymentMethod;
  label: string;
  /**
   * Etiqueta del flujo rápido. El cobro del mostrador comparte columna con el
   * carrito y el catálogo: ahí «Transferencia» entra truncada, que es peor que
   * abreviada. Son las mismas palabras que usaba la grilla propia de la venta
   * rápida antes de la spec 157.
   */
  corto?: string;
  icon: typeof Banknote;
}> = [
  { value: "cash", label: "Efectivo", icon: Banknote },
  { value: "card_manual", label: "Tarjeta", icon: CreditCard },
  {
    value: "mp_link",
    label: "Link Mercado Pago",
    corto: "Link MP",
    icon: LinkIcon,
  },
  { value: "mp_qr", label: "QR Mercado Pago", corto: "QR MP", icon: QrCode },
  {
    value: "transfer",
    label: "Transferencia",
    corto: "Transfer.",
    icon: Wallet,
  },
  { value: "other", label: "Otro", icon: MoreHorizontal },
  // spec 141 — el fiado. Va último a propósito: cierra el ticket sin que entre
  // plata, así que no compite con los métodos que sí cobran.
  {
    value: "cuenta_corriente",
    label: "Cuenta corriente",
    corto: "Cuenta cte.",
    icon: BookUser,
  },
];

const CARD_BRANDS: Array<{
  value: "visa" | "mastercard" | "amex" | "otro";
  label: string;
}> = [
  { value: "visa", label: "Visa" },
  { value: "mastercard", label: "Mastercard" },
  { value: "amex", label: "Amex" },
  { value: "otro", label: "Otro" },
];

function isMpMethod(m: PaymentMethod | null): m is "mp_link" | "mp_qr" {
  return m === "mp_link" || m === "mp_qr";
}

/**
 * Los métodos que esta pantalla ofrece.
 *
 * Vive afuera del componente porque el flujo rápido necesita el primero **en el
 * `useState` inicial**, antes de que haya render. Es también lo que hace que
 * agregar un método sea un renglón acá y no tres archivos (spec 157, esc. 4).
 */
function metodosOfrecidos(opts: {
  allowedMethods?: PaymentMethod[];
  mp: boolean;
  cuentaCorriente: boolean;
}) {
  return METHODS.filter((m) => {
    if (opts.allowedMethods && !opts.allowedMethods.includes(m.value))
      return false;
    if (isMpMethod(m.value) && !opts.mp) return false;
    // Sin la prop no hay fiado: el rol no puede, o el negocio no lo usa.
    if (m.value === "cuenta_corriente" && !opts.cuentaCorriente) return false;
    return true;
  });
}

export function CobroForm<T = unknown>({
  amountDueCents,
  cajas,
  cajaId,
  onCajaChange,
  methodConfigs,
  allowedMethods,
  cuentaCorriente,
  tip: tipConfig = { mode: "none" },
  size = "compact",
  flujo = "estandar",
  confirmRef: confirmRefProp,
  onSubmit,
  onPaid,
  onCancel,
  mp,
}: CobroFormProps<T>) {
  // Bloquea el botón mientras el pago está en vuelo: sin esto, tocar
  // "Confirmar" varias veces registra N pagos e infla la caja (bug crítico
  // cobro-doble-submit, reproducido en datos reales — spec 41 / #58).
  const [isRegistering, startTransition] = useTransition();
  // Idempotency key por intento (spec 42): estable entre taps, se regenera tras
  // un cobro OK. El server dedup por (business_id, request_id).
  const requestIdRef = useRef<string | null>(null);

  const rapido = flujo === "rapido";
  const methods = metodosOfrecidos({
    allowedMethods,
    mp: !!mp,
    cuentaCorriente: !!cuentaCorriente,
  });

  // En el flujo rápido el formulario abre **con método**: el mostrador cobra en
  // efectivo salvo aviso, y hacerlo elegir cada vez es el tap que la spec 058
  // no puede pagar.
  const [method, setMethod] = useState<PaymentMethod | null>(
    rapido ? (methods[0]?.value ?? null) : null,
  );
  /** A quién se le fía. Se limpia al cambiar de método (efecto más abajo). */
  const [creditCustomerId, setCreditCustomerId] = useState<string | null>(null);
  const [cliente, setCliente] = useState<ClienteParaFiar | null>(null);
  const adjustmentPercent =
    methodConfigs.find((c) => c.method === method)?.adjustment_percent ?? 0;
  const { adjustmentCents, finalCents } = calculateAdjustment(
    amountDueCents,
    adjustmentPercent,
  );

  const [amount, setAmount] = useState(amountDueCents);
  const [hasSetAmount, setHasSetAmount] = useState(false);
  const [tip, setTip] = useState(
    tipConfig.mode === "editable" ? (tipConfig.initialCents ?? 0) : 0,
  );
  const [lastFour, setLastFour] = useState("");
  const [cardBrand, setCardBrand] = useState<
    "visa" | "mastercard" | "amex" | "otro"
  >("visa");
  const [notes, setNotes] = useState("");
  const [mpInitPoint, setMpInitPoint] = useState<string | null>(null);
  const [mpPaymentId, setMpPaymentId] = useState<string | null>(null);

  const effectiveTip = tipConfig.mode === "fixed" ? tipConfig.cents : tip;

  // En efectivo no se cobra de menos (de más es vuelto). La misma regla que el
  // server aplica en `registrarPago`; acá sólo para no dejar tocar Confirmar.
  const cashShort = isCashShortPayment({
    method: method ?? "",
    amount_cents: amount,
    adjustment_cents: adjustmentCents,
    remaining_cents: amountDueCents,
  });

  // De más es vuelto, y el vuelto no se cobra: lo que se registra —y lo que
  // dice el botón— es `chargeCents`, no el billete que entró (issue #188). El
  // server vuelve a acotarlo; acá es para que el cajero vea lo mismo que la
  // caja va a contar.
  const { chargeCents, changeCents } = cashCharge({
    method: method ?? "",
    amount_cents: amount,
    adjustment_cents: adjustmentCents,
    remaining_cents: amountDueCents,
  });

  // Selector de método navegable con flechas (grilla de 2 columnas) — spec 075.
  const metodoZona = useRovingList<HTMLButtonElement>({
    length: methods.length,
    columns: 2,
  });

  // Elegir método desmonta el selector: sin esto el foco se cae al `<body>` y
  // el Esc y el ⌘Enter del paso 2 dejan de llegar. Va al botón de confirmar,
  // que es la acción del paso (mismo criterio que `ProductModal`).
  const confirmRefInterno = useRef<HTMLButtonElement>(null);
  const confirmRef = confirmRefProp ?? confirmRefInterno;
  useEffect(() => {
    // En el flujo rápido no hay tal desmontaje —los métodos quedan a la vista—
    // y el panel del mostrador enfoca el buscador al abrir: robarle el foco acá
    // haría que la primera letra tipeada no llegue a ningún lado.
    if (!method || rapido) return;
    const t = setTimeout(
      () => confirmRef.current?.focus({ preventScroll: true }),
      0,
    );
    return () => clearTimeout(t);
  }, [method, rapido, confirmRef]);

  /**
   * Volver al selector dejando el foco en el método que estaba elegido.
   *
   * Resetea `hasSetAmount` **acá dentro** y no en el botón «Cambiar»: si no, el
   * camino por Esc —el que la spec 075 promociona— se arrastra el monto tipeado
   * para el método anterior. Efectivo $15.000 sobre una cuenta de $10.000, Esc,
   * tarjeta con +10%: el paso 2 abría en $15.000 en vez de $11.000, sin guarda
   * de efectivo ni cartel de vuelto, y ⌘Enter cobraba eso.
   */
  const volverAlSelector = () => {
    const i = methods.findIndex((m) => m.value === method);
    setMethod(null);
    setHasSetAmount(false);
    setTimeout(() => metodoZona.focusIndex(i < 0 ? 0 : i), 0);
  };

  // Al elegir método, el monto arranca en lo que hay que pagar con su ajuste.
  // Si el usuario ya lo tocó a mano, se respeta.
  useEffect(() => {
    if (method && !hasSetAmount) setAmount(finalCents);
  }, [method, finalCents, hasSetAmount]);

  useEffect(() => {
    if (!mpPaymentId || !mp) return;
    const interval = setInterval(async () => {
      try {
        const res = await fetch(
          `/api/billing/payment-status?id=${mpPaymentId}`,
        );
        const data = await res.json();
        if (data?.payment_status === "paid") {
          toast.success("Pago MP confirmado");
          clearInterval(interval);
          mp.onConfirmed();
        } else if (data?.payment_status === "failed") {
          toast.error("MP rechazó el pago");
          clearInterval(interval);
          setMpPaymentId(null);
          setMpInitPoint(null);
          setMethod(null);
        }
      } catch {
        // ignore polling errors
      }
    }, 4_000);
    return () => clearInterval(interval);
  }, [mpPaymentId, mp]);

  // La nota la exige sólo «otro»: ahí es lo único que dice qué fue ese cobro.
  // En transferencia era fricción que se pagaba con basura — las referencias
  // que quedaron en los pedidos reales son "T", "a", "transfirio" (spec 126).
  // El alias se anota si sirve para conciliar, no porque el botón no deje pasar.
  const notesRequired = method === "other";
  const showNotes =
    method === "other" || method === "transfer" || method === "card_manual";

  const confirmDisabled =
    isRegistering ||
    amount <= 0 ||
    cashShort ||
    (notesRequired && notes.trim() === "") ||
    (method === "card_manual" && lastFour !== "" && lastFour.length !== 4) ||
    // spec 141 · US2 — sin cliente no hay botón: un fiado sin dueño es plata
    // que no está en el saldo de nadie (y el check de la base lo rechaza).
    (method === "cuenta_corriente" && !creditCustomerId);

  const handleConfirm = () => {
    if (!method) return;

    if (isMpMethod(method)) {
      if (!mp) return;
      startTransition(async () => {
        const r = await mp.start({
          method,
          amountCents: amount,
          tipCents: effectiveTip,
          cajaId,
        });
        if (!r.ok) {
          toast.error(r.error);
          return;
        }
        setMpInitPoint(r.data.initPoint);
        setMpPaymentId(r.data.paymentId);
      });
      return;
    }

    startTransition(async () => {
      const r = await onSubmit({
        method,
        amountCents: chargeCents,
        tipCents: effectiveTip,
        cajaId,
        lastFour:
          method === "card_manual" && lastFour.length === 4
            ? lastFour
            : undefined,
        cardBrand: method === "card_manual" ? cardBrand : undefined,
        notes: showNotes ? notes : undefined,
        adjustmentPercent,
        adjustmentCents,
        requestId: (requestIdRef.current ??= crypto.randomUUID()),
        creditCustomerId:
          method === "cuenta_corriente" ? creditCustomerId : undefined,
      });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      // Cobro OK → el próximo intento usa una clave nueva.
      requestIdRef.current = null;
      // El mostrador encadena ventas: el formulario vuelve a cero para la que
      // sigue, pero **se queda con el método** — tres cafés en efectivo no se
      // eligen tres veces. Sin esto, los últimos 4 dígitos del cliente anterior
      // viajarían con el cobro del siguiente.
      if (rapido) {
        setHasSetAmount(false);
        setLastFour("");
        setNotes("");
        setCliente(null);
        setCreditCustomerId(null);
        setTip(
          tipConfig.mode === "editable" ? (tipConfig.initialCents ?? 0) : 0,
        );
      }
      // El caller del flujo rápido siempre dice algo más específico (número de
      // venta y comandas a cocina): dos toasts por venta, en una barra, es ruido.
      if (!rapido) toast.success("Pago registrado");
      onPaid?.(r.data);
    });
  };

  const touch = size === "touch";

  // ── Sub-vista MP: link / QR + polling ─────────────────────────────────
  if (mpInitPoint) {
    return (
      <div className="space-y-3">
        <div>
          <p className="text-[0.6rem] font-semibold tracking-[0.18em] text-zinc-500 uppercase">
            {method === "mp_qr" ? "QR Mercado Pago" : "Link Mercado Pago"}
          </p>
          <h3 className="mt-1 text-base font-semibold text-zinc-900">
            Esperando confirmación
          </h3>
        </div>
        {method === "mp_qr" ? (
          <a
            href={mpInitPoint}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 rounded-full bg-zinc-900 px-4 py-2 text-sm font-semibold text-white"
          >
            <QrCode className="size-4" />
            Abrir QR de checkout
          </a>
        ) : (
          <div className="space-y-1.5">
            <p className="text-xs font-semibold text-zinc-600">Link de pago</p>
            <input
              value={mpInitPoint}
              readOnly
              className="h-10 w-full rounded-xl border border-zinc-200 px-3 text-xs"
            />
            <button
              type="button"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(mpInitPoint);
                  toast.success("Link copiado");
                } catch {
                  toast.error("No se pudo copiar");
                }
              }}
              className="inline-flex items-center gap-1.5 rounded-full bg-zinc-100 px-3 py-1.5 text-xs font-semibold text-zinc-700 transition hover:bg-zinc-200"
            >
              Copiar link
            </button>
          </div>
        )}
        <p className="text-xs text-zinc-500">
          Auto-refresh cada 4 segundos. Si MP confirma, se cierra solo.
        </p>
        <button
          type="button"
          onClick={() => {
            setMpInitPoint(null);
            setMpPaymentId(null);
            volverAlSelector();
          }}
          className="text-xs font-semibold text-zinc-500 underline"
        >
          Cancelar y elegir otro método
        </button>
      </div>
    );
  }

  // ── El selector de método ─────────────────────────────────────────────
  // Grilla navegable con flechas y, sobre todo, con dígitos: en la caja en hora
  // pico «efectivo» es apretar 1 (spec 075, FR-018). El número va escrito en
  // cada método para que se aprenda solo.
  //
  // Enter acá SÓLO elige — el cobro se dispara desde Confirmar (FR-020). En el
  // camino estándar eso es el paso siguiente; en el rápido, el botón de abajo:
  // es la misma grilla, pero **sin desmontarse**, porque el mostrador quiere
  // cambiar de método sin perder de vista lo que está por cobrar.
  const selectorDeMetodo = (
    <div
      onKeyDown={(e) => {
        if (metodoZona.handleKeyDown(e)) return;
        const i = indexFromDigit(e.key, methods.length);
        if (i === null) return;
        e.preventDefault();
        setMethod(methods[i].value);
      }}
      className={cn("grid grid-cols-2", rapido ? "gap-1.5" : "gap-2")}
    >
      {methods.map((m, i) => {
        const adj =
          methodConfigs.find((c) => c.method === m.value)?.adjustment_percent ??
          0;
        const { finalCents: adjFinal } = calculateAdjustment(
          amountDueCents,
          adj,
        );
        const Icon = m.icon;
        const elegido = rapido && method === m.value;
        return (
          <button
            key={m.value}
            type="button"
            onClick={() => setMethod(m.value)}
            data-metodo="true"
            {...metodoZona.itemProps(i)}
            className={cn(
              "rounded-2xl bg-white text-left ring-1 ring-zinc-200 transition outline-none hover:ring-zinc-300 active:scale-[0.98]",
              "focus-visible:ring-2 focus-visible:ring-zinc-900",
              rapido
                ? "flex items-center gap-1.5 px-2.5 py-2"
                : "flex flex-col items-start gap-1 p-3",
              !rapido && touch && "p-4",
              elegido && "bg-zinc-900 text-white ring-zinc-900",
            )}
          >
            {rapido ? (
              // Sin ícono: el ancho que ocupa es el que le falta a la etiqueta.
              <>
                <span className="min-w-0 flex-1 truncate text-sm font-semibold">
                  {m.corto ?? m.label}
                </span>
                {adj !== 0 && (
                  <span
                    className={cn(
                      "shrink-0 text-[10px] font-bold",
                      elegido
                        ? "text-white/70"
                        : adj < 0
                          ? "text-emerald-600"
                          : "text-rose-600",
                    )}
                  >
                    {adj > 0 ? "+" : ""}
                    {adj}%
                  </span>
                )}
                {i < 9 && (
                  <kbd
                    className={cn(
                      "shrink-0 rounded px-1 text-[10px] font-bold",
                      elegido
                        ? "bg-white/15 text-white/70"
                        : "bg-zinc-100 text-zinc-500",
                    )}
                  >
                    {i + 1}
                  </kbd>
                )}
              </>
            ) : (
              <>
                <div className="flex w-full items-center justify-between gap-2">
                  <Icon
                    className={cn("size-4 text-zinc-500", touch && "size-5")}
                  />
                  {i < 9 && (
                    <kbd className="rounded bg-zinc-100 px-1 text-[10px] font-bold text-zinc-500">
                      {i + 1}
                    </kbd>
                  )}
                </div>
                <span
                  className={cn(
                    "text-sm font-semibold text-zinc-900",
                    touch && "text-base",
                  )}
                >
                  {m.label}
                </span>
                {adj !== 0 && (
                  <span
                    className={cn(
                      "text-xs font-medium",
                      adj < 0 ? "text-emerald-700" : "text-rose-600",
                    )}
                  >
                    {adj > 0 ? "+" : ""}
                    {adj}% · {formatCurrency(adjFinal)}
                  </span>
                )}
              </>
            )}
          </button>
        );
      })}
    </div>
  );

  // ── Paso 1: elegir método (sólo el camino estándar) ───────────────────
  if (!method) {
    return (
      <div className="space-y-3">
        <CajaPicker cajas={cajas} cajaId={cajaId} onChange={onCajaChange} />
        {selectorDeMetodo}
      </div>
    );
  }

  // ── Paso 2: datos del pago ────────────────────────────────────────────
  const meta = METHODS.find((m) => m.value === method)!;
  const MetaIcon = meta.icon;

  return (
    <div
      onKeyDown={(e) => {
        // Esc con un método ya elegido vuelve al selector, no cierra el panel
        // entero (spec 075, FR-019): el `stopPropagation` corta la cadena de
        // modos del `<aside>` un nivel más arriba.
        if (e.key === "Escape") {
          // En el mostrador no hay selector al que volver y Esc cierra la venta
          // rápida: comérselo acá encerraría al encargado en el formulario.
          if (rapido) return;
          e.stopPropagation();
          e.preventDefault();
          volverAlSelector();
          return;
        }
        // ⌘/Ctrl+Enter cobra desde cualquier campo, con el mismo guard de
        // `isRegistering` que el botón (FR-020, anti-doble-cobro spec 41/42).
        if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && !confirmDisabled) {
          e.preventDefault();
          handleConfirm();
        }
      }}
      // Tope de ancho para el tramo en que el panel del salón ya es ancho pero
      // todavía no entra en dos columnas (spec 111): el input de monto y el
      // botón de confirmar no ganan nada midiendo 560px. Inerte fuera del
      // panel: sin ancestro `@container` la query nunca matchea.
      // El rápido va más apretado: en el panel del salón el cobro comparte
      // columna con el carrito, y cada 4px de aire es un scroll más.
      className={cn("@xl:max-w-[480px]", rapido ? "space-y-2.5" : "space-y-4")}
    >
      {rapido ? (
        // El mostrador no tiene «Cambiar»: los métodos nunca se fueron, y la
        // caja se elige acá y no en una franja aparte del panel.
        <>
          <CajaPicker cajas={cajas} cajaId={cajaId} onChange={onCajaChange} />
          {selectorDeMetodo}
        </>
      ) : (
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <MetaIcon className="size-4 text-zinc-500" />
            <p className="text-sm font-semibold text-zinc-900">{meta.label}</p>
          </div>
          <button
            type="button"
            onClick={() => {
              volverAlSelector();
              onCancel?.();
            }}
            className="text-xs font-semibold text-zinc-500 underline"
          >
            Cambiar
            <kbd className="ml-1 rounded bg-zinc-100 px-1 text-[10px] font-bold text-zinc-500">
              Esc
            </kbd>
          </button>
        </div>
      )}

      <div className="grid gap-1.5">
        <label
          htmlFor="cobro-monto"
          className="text-xs font-semibold text-zinc-600"
        >
          Monto
        </label>
        <input
          id="cobro-monto"
          type="number"
          inputMode="decimal"
          value={amount / 100}
          onChange={(e) => {
            setAmount(Math.max(0, Math.round(Number(e.target.value) * 100)));
            setHasSetAmount(true);
          }}
          className={cn(
            "h-11 w-full rounded-xl border border-zinc-200 px-3 text-base font-semibold tabular-nums focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 focus:outline-none",
            touch && "h-14 text-lg",
          )}
        />
        {adjustmentPercent !== 0 && (
          <p
            className={cn(
              "text-xs font-medium",
              adjustmentPercent < 0 ? "text-emerald-700" : "text-rose-600",
            )}
          >
            {adjustmentPercent < 0 ? "Descuento" : "Recargo"}{" "}
            {adjustmentPercent > 0 ? "+" : ""}
            {adjustmentPercent}%: {formatCurrency(adjustmentCents)}
            <span className="ml-1 text-zinc-500">
              (base {formatCurrency(amountDueCents)})
            </span>
          </p>
        )}
        {changeCents > 0 && (
          <p className="text-xs font-semibold text-emerald-700">
            Vuelto: {formatCurrency(changeCents)}
            <span className="ml-1 font-medium text-zinc-500">
              — se cobra {formatCurrency(chargeCents)}
            </span>
          </p>
        )}
        {cashShort && (
          <p className="text-xs font-semibold text-rose-600">
            En efectivo no se puede cobrar menos de {formatCurrency(finalCents)}
            . Si van a pagar en partes, dividí la cuenta por monto.
          </p>
        )}
      </div>

      {tipConfig.mode === "editable" && (
        <div className="grid gap-1.5">
          <label
            htmlFor="cobro-propina"
            className="text-xs font-semibold text-zinc-600"
          >
            Propina (opcional)
          </label>
          <input
            id="cobro-propina"
            type="number"
            inputMode="decimal"
            value={tip / 100}
            onChange={(e) =>
              setTip(Math.max(0, Math.round(Number(e.target.value) * 100)))
            }
            className={cn(
              "h-11 w-full rounded-xl border border-zinc-200 px-3 text-base tabular-nums focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 focus:outline-none",
              touch && "h-14 text-lg",
            )}
          />
        </div>
      )}
      {tipConfig.mode === "fixed" && tipConfig.cents > 0 && (
        <p className="text-xs text-zinc-500">
          Incluye propina de {formatCurrency(tipConfig.cents)}.
        </p>
      )}

      {method === "cuenta_corriente" && cuentaCorriente && (
        <FiarAQuien
          slug={cuentaCorriente.slug}
          iniciales={cuentaCorriente.clientes}
          value={cliente}
          onChange={(c) => {
            setCliente(c);
            setCreditCustomerId(c?.id ?? null);
          }}
        />
      )}

      {method === "card_manual" && (
        <div className="grid gap-2">
          <div className="grid gap-1.5">
            <label
              htmlFor="cobro-last-four"
              className="text-xs font-semibold text-zinc-600"
            >
              Últimos 4 dígitos (opcional)
            </label>
            <input
              id="cobro-last-four"
              type="text"
              inputMode="numeric"
              maxLength={4}
              value={lastFour}
              onChange={(e) =>
                setLastFour(e.target.value.replace(/\D/g, "").slice(0, 4))
              }
              className="h-11 w-full rounded-xl border border-zinc-200 px-3 text-base tabular-nums focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 focus:outline-none"
            />
          </div>
          <div className="flex flex-wrap gap-1.5">
            {CARD_BRANDS.map((b) => (
              <button
                key={b.value}
                type="button"
                onClick={() => setCardBrand(b.value)}
                className={cn(
                  "rounded-full px-3 py-1.5 text-xs font-semibold transition",
                  cardBrand === b.value
                    ? "bg-zinc-900 text-white"
                    : "bg-white text-zinc-700 ring-1 ring-zinc-200",
                )}
              >
                {b.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {showNotes && (
        <div className="grid gap-1.5">
          <label
            htmlFor="cobro-notas"
            className="text-xs font-semibold text-zinc-600"
          >
            Notas{notesRequired && <span className="text-rose-600"> *</span>}
          </label>
          <textarea
            id="cobro-notas"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            placeholder={
              method === "transfer"
                ? "Alias o referencia…"
                : method === "other"
                  ? "Cheque #1234, cortesía…"
                  : "Opcional"
            }
            className="w-full rounded-xl border border-zinc-200 px-3 py-2 text-sm focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 focus:outline-none"
          />
        </div>
      )}

      <button
        ref={confirmRef}
        type="button"
        disabled={confirmDisabled}
        onClick={handleConfirm}
        className={cn(
          "flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-emerald-600 text-base font-semibold text-white shadow-sm transition hover:brightness-105 active:scale-[0.98] disabled:opacity-50",
          touch && "h-16 text-lg font-bold",
        )}
      >
        {isRegistering ? (
          "Registrando…"
        ) : (
          <>
            <Check className="size-5" />
            Confirmar {formatCurrency(chargeCents)}
          </>
        )}
      </button>
    </div>
  );
}

function CajaPicker({
  cajas,
  cajaId,
  onChange,
}: {
  cajas: Caja[];
  cajaId: string;
  onChange?: (id: string) => void;
}) {
  if (cajas.length <= 1 || !onChange) return null;
  return (
    <div>
      <p className="mb-1.5 text-xs font-semibold text-zinc-600">Caja</p>
      <div className="flex flex-wrap gap-2">
        {cajas.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => onChange(c.id)}
            className={cn(
              "rounded-full px-3 py-1.5 text-sm font-semibold transition",
              cajaId === c.id
                ? "bg-zinc-900 text-white"
                : "bg-white text-zinc-700 ring-1 ring-zinc-200",
            )}
          >
            {c.name}
          </button>
        ))}
      </div>
    </div>
  );
}
