import { notFound } from "next/navigation";

import { Bell, CalendarCheck, Mail, MessageCircle, Send, Smartphone } from "lucide-react";

import { CustomerChannelForm } from "@/components/admin/settings/customer-channel-form";
import { DeliveryTemplatesForm } from "@/components/admin/settings/delivery-templates-form";
import { NotificationPreferencesForm } from "@/components/admin/settings/notification-preferences-form";
import { ReservationTemplatesForm } from "@/components/admin/settings/reservation-templates-form";
import { SettingsSection } from "@/components/admin/settings/settings-section";
import { ShiftSummaryForm } from "@/components/admin/settings/shift-summary-form";
import { WhatsappConfigForm } from "@/components/admin/settings/whatsapp-config-form";
import { normalizeCustomerChannel } from "@/lib/notifications/customer-channel";
import { getBusiness, getBusinessSettings } from "@/lib/tenant";

// Ajustes › Notificaciones y mensajes: conexión de WhatsApp, avisos internos,
// mensajes de delivery y de reserva al cliente, y resumen de cierre por email.
// Gate: layout.
export default async function ConfiguracionNotificacionesPage({
  params,
}: {
  params: Promise<{ business_slug: string }>;
}) {
  const { business_slug } = await params;
  const business = await getBusiness(business_slug);
  if (!business) notFound();

  const settings = getBusinessSettings(business);

  return (
    <>
      <SettingsSection
        icon={<Send className="size-5" />}
        title="Canal de avisos al cliente"
        description="Por dónde le llegan al cliente los avisos de su pedido y reservas: WhatsApp, email o ambos. El email usa la dirección del login con Google y no depende de la habilitación de Meta."
      >
        <CustomerChannelForm
          slug={business_slug}
          initial={normalizeCustomerChannel(
            (business as { customer_channel?: string }).customer_channel,
          )}
        />
      </SettingsSection>

      <SettingsSection
        icon={<Smartphone className="size-5" />}
        title="WhatsApp"
        description="Conectá la cuenta de WhatsApp del local para enviar avisos a clientes y notificaciones. La API key se guarda de forma segura y no se vuelve a mostrar."
      >
        <WhatsappConfigForm slug={business_slug} />
      </SettingsSection>

      <SettingsSection
        icon={<Bell className="size-5" />}
        title="Avisos del local"
        description="Elegí quién recibe cada aviso interno y por qué canal (en la app o WhatsApp)."
      >
        <NotificationPreferencesForm slug={business_slug} />
      </SettingsSection>

      <SettingsSection
        icon={<MessageCircle className="size-5" />}
        title="Mensajes de delivery por WhatsApp"
        description="Personalizá el mensaje que recibe el cliente en cada cambio de estado de su pedido."
      >
        <DeliveryTemplatesForm slug={business_slug} />
      </SettingsSection>

      <SettingsSection
        icon={<CalendarCheck className="size-5" />}
        title="Mensajes de reserva al cliente"
        description="Qué le llega al cliente en cada momento de su reserva: cuando la pide, cuando la confirmás, cuando la rechazás y cuando vence sin respuesta."
      >
        <ReservationTemplatesForm slug={business_slug} />
      </SettingsSection>

      <SettingsSection
        icon={<Mail className="size-5" />}
        title="Resumen de cierre por email"
        description="Recibí por mail el resumen del día (recaudación, facturación, mesas, por mozo y anulaciones) a la hora de cierre. Vacío en destinatarios = los admins del negocio."
      >
        <ShiftSummaryForm
          slug={business_slug}
          initial={{
            enabled: settings.closing_summary_enabled ?? false,
            hour: settings.closing_summary_hour ?? 23,
            recipients: settings.closing_summary_recipients ?? [],
          }}
        />
      </SettingsSection>
    </>
  );
}

export const dynamic = "force-dynamic";
