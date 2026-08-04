import { notFound } from "next/navigation";

import {
  ClipboardList,
  FileText,
  Fingerprint,
  MonitorDown,
  Printer,
  Receipt,
} from "lucide-react";

import { ClockOriginsForm } from "@/components/admin/settings/clock-origins-form";
import {
  ControlPrinterForm,
  type ControlPrinterRow,
} from "@/components/admin/settings/control-printer-form";
import {
  CuentaPrintersForm,
  type CuentaPrinterConfig,
  type FloorPlanPrinterRow,
} from "@/components/admin/settings/cuenta-printers-form";
import {
  FiscalPrintersForm,
  type CajaFiscalPrinterRow,
} from "@/components/admin/settings/fiscal-printers-form";
import { PrintAgentCard } from "@/components/admin/settings/print-agent-card";
import { SettingsSection } from "@/components/admin/settings/settings-section";
import {
  StationPrintersForm,
  type StationPrinterRow,
} from "@/components/admin/settings/station-printers-form";
import { listClockOrigins } from "@/lib/rrhh/clock-origin-actions";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { getBusiness } from "@/lib/tenant";

// Ajustes › Operación del local: impresoras por sector (comanderas) y fichaje
// restringido a las computadoras del local. El gate vive en el layout.
export default async function ConfiguracionLocalPage({
  params,
}: {
  params: Promise<{ business_slug: string }>;
}) {
  const { business_slug } = await params;
  const business = await getBusiness(business_slug);
  if (!business) notFound();

  const service = createSupabaseServiceClient();
  const [
    clockOrigins,
    { data: stations },
    { data: bizFlag },
    { data: floorPlans },
    { data: cajas },
    { data: agentStatus },
  ] =
    await Promise.all([
      listClockOrigins(business.id),
      service
        .from("stations")
        .select("id, name, is_active, printer_ip, printer_port, printer_enabled")
        .eq("business_id", business.id)
        .order("sort_order"),
      service
        .from("businesses")
        .select(
          "print_agent_key_set, control_printer_ip, control_printer_port, control_printer_enabled, cuenta_printer_ip, cuenta_printer_port, cuenta_printer_enabled",
        )
        .eq("id", business.id)
        .maybeSingle(),
      service
        .from("floor_plans")
        .select(
          "id, name, cuenta_printer_ip, cuenta_printer_port, cuenta_printer_enabled",
        )
        .eq("business_id", business.id)
        .order("name"),
      service
        .from("cajas")
        .select(
          "id, name, is_default, fiscal_printer_ip, fiscal_printer_port, fiscal_printer_enabled",
        )
        .eq("business_id", business.id)
        .eq("is_active", true)
        .order("sort_order"),
      service
        .from("print_agent_status")
        .select("last_seen_at")
        .eq("business_id", business.id)
        .maybeSingle(),
    ]);

  const printAgentKeySet = Boolean(
    (bizFlag as { print_agent_key_set?: boolean } | null)?.print_agent_key_set,
  );
  const controlPrinter: ControlPrinterRow = {
    control_printer_ip:
      (bizFlag as ControlPrinterRow | null)?.control_printer_ip ?? null,
    control_printer_port:
      (bizFlag as ControlPrinterRow | null)?.control_printer_port ?? 9100,
    control_printer_enabled:
      (bizFlag as ControlPrinterRow | null)?.control_printer_enabled ?? true,
  };
  const cuentaPrinter: CuentaPrinterConfig = {
    cuenta_printer_ip:
      (bizFlag as CuentaPrinterConfig | null)?.cuenta_printer_ip ?? null,
    cuenta_printer_port:
      (bizFlag as CuentaPrinterConfig | null)?.cuenta_printer_port ?? 9100,
    cuenta_printer_enabled:
      (bizFlag as CuentaPrinterConfig | null)?.cuenta_printer_enabled ?? true,
  };
  const printAgentLastSeenAt =
    (agentStatus as { last_seen_at?: string } | null)?.last_seen_at ?? null;

  return (
    <>
      <SettingsSection
        icon={<Printer className="size-5" />}
        title="Comanderas"
        description="Asigná a cada sector la IP de su impresora térmica en la red del local. Dejá la IP vacía para un sector sin comandera (no se imprime). Puerto por defecto 9100."
      >
        <StationPrintersForm
          slug={business_slug}
          stations={(stations ?? []) as StationPrinterRow[]}
        />
      </SettingsSection>

      <SettingsSection
        icon={<ClipboardList className="size-5" />}
        title="Comandera de control"
        description="Además de las comandas de cocina, cada delivery y cada retiro imprime un «control de pedido» — el papel que se lleva el repartidor: el pedido completo con precios, cliente, dirección, horario de entrega y cuánta plata cobrar. Dejá la IP vacía para no imprimirlos."
      >
        <ControlPrinterForm slug={business_slug} initial={controlPrinter} />
      </SettingsSection>

      <SettingsSection
        icon={<Receipt className="size-5" strokeWidth={1.75} />}
        title="Comandera de cuentas"
        description="Dónde sale la cuenta que se le da al cliente cuando el mozo toca «Imprimir cuenta». Cada salón puede tener la suya; los que no, usan la del local."
      >
        <CuentaPrintersForm
          slug={business_slug}
          business={cuentaPrinter}
          floorPlans={(floorPlans ?? []) as FloorPlanPrinterRow[]}
        />
      </SettingsSection>

      <SettingsSection
        icon={<FileText className="size-5" strokeWidth={1.75} />}
        title="Comandera fiscal"
        description="Dónde sale la factura impresa —con el QR de ARCA— cuando el encargado toca «Imprimir factura». Es por caja: el papel fiscal tiene que salir donde está parado el que cobra."
      >
        <FiscalPrintersForm
          slug={business_slug}
          cajas={(cajas ?? []) as CajaFiscalPrinterRow[]}
        />
      </SettingsSection>

      <SettingsSection
        icon={<MonitorDown className="size-5" />}
        title="Agente de impresión"
        description="Descargá el agente ya configurado para este negocio e instalalo en UNA PC del local (la que quede siempre prendida). Hace de puente entre el sistema y las comanderas de la red."
      >
        <PrintAgentCard
          slug={business_slug}
          keySet={printAgentKeySet}
          lastSeenAt={printAgentLastSeenAt}
        />
      </SettingsSection>

      <SettingsSection
        icon={<Fingerprint className="size-5" />}
        title="Fichaje desde el local"
        description="Restringí el fichaje a las computadoras del local. Agregá el rango de IP de la red interna (CIDR); sin orígenes configurados se puede fichar desde cualquier dispositivo."
      >
        <ClockOriginsForm slug={business_slug} origins={clockOrigins} />
      </SettingsSection>
    </>
  );
}

export const dynamic = "force-dynamic";
