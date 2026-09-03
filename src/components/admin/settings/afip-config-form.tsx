"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, FlaskConical, ShieldCheck, XCircle } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  promoteAfipToProduction,
  revertAfipToSandbox,
  updateAfipConfig,
} from "@/lib/afip/config-actions";
import type { AFIPProvider, FiscalMode, TipoComprobante } from "@/lib/afip/types";
import { cn } from "@/lib/utils";

import { SectionField } from "./settings-section";

type Props = {
  slug: string;
  initial: {
    cuit: string;
    puntoVenta: number;
    provider: AFIPProvider;
    defaultTipo: TipoComprobante;
    mode: FiscalMode;
    enabled: boolean;
    /** Emitir solo al cobrar (spec 147). */
    autoEmit: boolean;
    /** La API key (secreta) ya está cargada. */
    hasGatewayKey: boolean;
    /** Slug del cliente en el gateway (no secreto, se pre-rellena). */
    gatewayTenantSlug: string;
    /** Base URL del gateway (no secreto, se pre-rellena). */
    gatewayBaseUrl: string;
  };
};

export function AfipConfigForm({ slug, initial }: Props) {
  const router = useRouter();
  const [cuit, setCuit] = useState(initial.cuit);
  const [puntoVenta, setPuntoVenta] = useState(String(initial.puntoVenta || ""));
  const [provider, setProvider] = useState<AFIPProvider>(initial.provider);
  const [defaultTipo, setDefaultTipo] = useState<TipoComprobante>(
    initial.defaultTipo,
  );
  // La API key nunca se pre-rellena. Vacío = "no tocar la ya guardada".
  const [gatewayApiKey, setGatewayApiKey] = useState("");
  const [gatewayTenantSlug, setGatewayTenantSlug] = useState(
    initial.gatewayTenantSlug,
  );
  const [gatewayBaseUrl, setGatewayBaseUrl] = useState(initial.gatewayBaseUrl);
  const [autoEmit, setAutoEmit] = useState(initial.autoEmit);
  const [pending, startTransition] = useTransition();
  const [promoting, startPromote] = useTransition();

  const isProduction = initial.mode === "produccion" && initial.enabled;
  // Credencial cargada: API key (ya guardada o recién tipeada) + slug.
  const credsLoaded =
    (initial.hasGatewayKey || gatewayApiKey.trim().length > 0) &&
    gatewayTenantSlug.trim().length > 0;

  const handleSave = () => {
    startTransition(async () => {
      const result = await updateAfipConfig({
        slug,
        cuit,
        puntoVenta: Number(puntoVenta) || 0,
        provider,
        defaultTipo,
        gatewayApiKey: gatewayApiKey || undefined,
        gatewayTenantSlug: gatewayTenantSlug || undefined,
        gatewayBaseUrl: gatewayBaseUrl || undefined,
        autoEmit,
      });
      if (result.ok) {
        toast.success("Configuración AFIP guardada.");
        setGatewayApiKey("");
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  };

  const handlePromote = () => {
    startPromote(async () => {
      const result = await promoteAfipToProduction(slug);
      if (result.ok) {
        toast.success("Negocio en producción: emisión fiscal real activada.");
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  };

  const handleRevert = () => {
    startPromote(async () => {
      const result = await revertAfipToSandbox(slug);
      if (result.ok) {
        toast.success("Negocio vuelto a sandbox.");
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  };

  return (
    <div className="grid gap-6">
      {/* ── Estado de conexión ARCA ──────────────────────────────── */}
      <div
        className={cn(
          "flex flex-col gap-3 rounded-xl p-4 ring-1 sm:flex-row sm:items-center sm:justify-between",
          isProduction
            ? "bg-emerald-50 ring-emerald-200/60"
            : "bg-amber-50 ring-amber-200/60",
        )}
      >
        <div className="flex items-center gap-3">
          {isProduction ? (
            <ShieldCheck className="size-5 text-emerald-600" />
          ) : (
            <FlaskConical className="size-5 text-amber-600" />
          )}
          <div>
            <p className="text-sm font-semibold text-zinc-900">
              {isProduction
                ? "Producción — emisión fiscal real"
                : "Sandbox — comprobantes de prueba (sin valor fiscal)"}
            </p>
            <p className="mt-0.5 flex items-center gap-1 text-xs text-zinc-600">
              {credsLoaded ? (
                <>
                  <CheckCircle2 className="size-3.5 text-emerald-600" />
                  Gateway conectado
                </>
              ) : (
                <>
                  <XCircle className="size-3.5 text-zinc-400" />
                  Sin credencial del gateway
                </>
              )}
            </p>
          </div>
        </div>

        {isProduction ? (
          <Button
            variant="outline"
            size="sm"
            onClick={handleRevert}
            disabled={promoting}
          >
            Volver a sandbox
          </Button>
        ) : (
          <Button
            size="sm"
            onClick={handlePromote}
            disabled={promoting || !credsLoaded}
            title={
              credsLoaded
                ? undefined
                : "Cargá la credencial del gateway antes de promover"
            }
          >
            Pasar a producción
          </Button>
        )}
      </div>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <SectionField label="CUIT" hint="11 dígitos, sin guiones.">
          <Input
            value={cuit}
            onChange={(e) => setCuit(e.target.value)}
            placeholder="20123456789"
            maxLength={13}
          />
        </SectionField>
        <SectionField label="Punto de venta">
          <Input
            type="number"
            value={puntoVenta}
            onChange={(e) => setPuntoVenta(e.target.value)}
            placeholder="1"
            min={1}
            max={99999}
          />
        </SectionField>
      </div>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <SectionField label="Proveedor de facturación">
          <Select value={provider} onValueChange={(v) => setProvider(v as AFIPProvider)}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="sandbox">Sandbox (pruebas)</SelectItem>
              <SelectItem value="gateway">ARCA GPSF Gateway</SelectItem>
            </SelectContent>
          </Select>
        </SectionField>
        <SectionField label="Tipo de comprobante por defecto">
          <Select value={defaultTipo} onValueChange={(v) => setDefaultTipo(v as TipoComprobante)}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="factura_b">Factura B</SelectItem>
              <SelectItem value="factura_a">Factura A</SelectItem>
              <SelectItem value="nota_credito_b">Nota de Crédito B</SelectItem>
              <SelectItem value="nota_credito_a">Nota de Crédito A</SelectItem>
            </SelectContent>
          </Select>
        </SectionField>
      </div>

      {/* ── Emisión automática al cobrar (spec 147) ──────────────── */}
      <button
        type="button"
        role="switch"
        aria-checked={autoEmit}
        onClick={() => setAutoEmit((v) => !v)}
        className={cn(
          "flex w-full items-center justify-between gap-3 rounded-2xl border p-4 text-left transition",
          autoEmit
            ? "border-zinc-900 bg-zinc-900 text-zinc-50"
            : "border-zinc-200 bg-white hover:border-zinc-300",
        )}
      >
        <div className="min-w-0">
          <p className="text-sm font-semibold">
            Emitir el comprobante al cobrar
          </p>
          <p
            className={cn(
              "mt-0.5 text-xs",
              autoEmit ? "text-zinc-400" : "text-zinc-500",
            )}
          >
            Cada mesa saldada encola una Factura B a consumidor final, sin que
            nadie apriete nada. La Factura A y la impresión siguen a pedido.
          </p>
        </div>
        <span
          aria-hidden
          className={cn(
            "relative flex h-6 w-11 shrink-0 items-center rounded-full transition",
            autoEmit ? "bg-emerald-400" : "bg-zinc-300",
          )}
        >
          <span
            className={cn(
              "absolute size-5 rounded-full bg-white shadow-sm transition",
              autoEmit ? "translate-x-5" : "translate-x-0.5",
            )}
          />
        </span>
      </button>

      {/* ── Credencial del ARCA GPSF Gateway (server-only) ───────── */}
      <div className="rounded-xl bg-zinc-50 p-4 ring-1 ring-zinc-200/60">
        <p className="text-sm font-semibold text-zinc-900">
          Credencial del gateway ARCA
        </p>
        <p className="mt-1 text-xs text-zinc-500">
          La API key (<code>sk_live_…</code>) y el slug del cliente que emite el
          admin del gateway. La API key se guarda de forma segura y no se vuelve a
          mostrar; dejá el campo vacío para no modificar la ya cargada. El
          certificado de ARCA lo gestiona el gateway.
        </p>
        <div className="mt-4 grid grid-cols-1 gap-5 sm:grid-cols-2">
          <SectionField label="API Key">
            <Input
              type="password"
              autoComplete="off"
              value={gatewayApiKey}
              onChange={(e) => setGatewayApiKey(e.target.value)}
              placeholder={initial.hasGatewayKey ? "•••••••• (cargada)" : "sk_live_…"}
            />
          </SectionField>
          <SectionField label="Slug del cliente" hint="El identificador del negocio en el gateway.">
            <Input
              autoComplete="off"
              value={gatewayTenantSlug}
              onChange={(e) => setGatewayTenantSlug(e.target.value)}
              placeholder="house"
            />
          </SectionField>
        </div>
        <div className="mt-5">
          <SectionField label="Base URL" hint="Por defecto el gateway de producción.">
            <Input
              autoComplete="off"
              value={gatewayBaseUrl}
              onChange={(e) => setGatewayBaseUrl(e.target.value)}
              placeholder="https://arca-gpsf-gateway.vercel.app"
            />
          </SectionField>
        </div>
      </div>

      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={pending}>
          {pending ? "Guardando…" : "Guardar AFIP"}
        </Button>
      </div>
    </div>
  );
}
