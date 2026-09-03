import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowRight,
  Bot,
  CalendarDays,
  ClipboardList,
  Clock,
  Contact,
  CreditCard,
  LayoutDashboard,
  LogIn,
  Map,
  MessageCircle,
  Monitor,
  Receipt,
  Settings,
  ShoppingCart,
  UserCircle,
  Users,
  UtensilsCrossed,
  Utensils,
  Warehouse,
} from "lucide-react";

import { getSampleCustomerForChatbotDemo } from "@/lib/admin/customers-query";
import { getBusiness } from "@/lib/tenant";

type SubLink = {
  href: string;
  title: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
};

type AdminCluster = {
  label: string;
  items: SubLink[];
};

type Role = {
  href: string;
  title: string;
  subtitle: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  accent: string;
};

export default async function DemoHubPage({
  params,
}: {
  params: Promise<{ business_slug: string }>;
}) {
  const { business_slug } = await params;
  const business = await getBusiness(business_slug);
  if (!business) notFound();

  const chatbotSample = await getSampleCustomerForChatbotDemo(business.id);

  // ── Acto 01: Experiencia del cliente ──────────────────────────────────────

  const clienteHeroFlow: SubLink[] = [
    {
      href: `/${business_slug}/menu`,
      title: "Carta digital",
      description: "Tu menú con fotos y descripciones, siempre actualizado.",
      icon: UtensilsCrossed,
    },
    {
      href: `/${business_slug}/carrito`,
      title: "Carrito",
      description: "El cliente arma su pedido a su ritmo, sin presión.",
      icon: ShoppingCart,
    },
    {
      href: `/${business_slug}/checkout`,
      title: "Pago online",
      description: "Cobrás antes de que el pedido entre a cocina.",
      icon: ClipboardList,
    },
  ];

  const clienteExtra: SubLink[] = [
    {
      href: `/${business_slug}/reservar`,
      title: "Reservas",
      description: "Reservas online 24/7 sin que nadie atienda el teléfono.",
      icon: CalendarDays,
    },
    {
      href: `/${business_slug}/perfil`,
      title: "Mi cuenta",
      description: "Historial de pedidos y reservas para fidelizar al cliente.",
      icon: UserCircle,
    },
    {
      href: `/${business_slug}/login`,
      title: "Ingreso",
      description: "Acceso simple sin contraseñas que recordar.",
      icon: LogIn,
    },
    ...(chatbotSample
      ? [
          {
            href: `/${business_slug}/admin/clientes/${chatbotSample.id}/chatbot`,
            title: "Chat con el bot",
            description:
              "El cliente pide por WhatsApp y el bot le arma el carrito.",
            icon: MessageCircle,
          },
        ]
      : []),
  ];

  // ── Acto 02: Equipo ───────────────────────────────────────────────────────

  const roles: Role[] = [
    {
      href: `/${business_slug}/mozo`,
      title: "Mozos",
      subtitle: "Equipo de salón",
      description:
        "Tus mozos atienden más mesas y con menos errores: ven el estado de cada mesa, toman pedidos desde el celular y reciben avisos cuando un plato está listo.",
      icon: UtensilsCrossed,
      accent: "from-emerald-500/20 to-emerald-500/0",
    },
    {
      href: `/${business_slug}/fichar`,
      title: "Fichaje",
      subtitle: "Control de asistencia",
      description:
        "Tu equipo ficha entrada y salida con un PIN de 4 dígitos. Vos ves las horas trabajadas en el panel de RRHH.",
      icon: Clock,
      accent: "from-sky-500/20 to-sky-500/0",
    },
  ];

  // ── Acto 03: Admin (clusters) ─────────────────────────────────────────────

  const adminClusters: AdminCluster[] = [
    {
      label: "Día a día",
      items: [
        {
          href: `/${business_slug}/admin`,
          title: "Inicio",
          description: "Cómo va el día de un vistazo: ventas, pedidos y mesas activas.",
          icon: LayoutDashboard,
        },
        {
          href: `/${business_slug}/admin/operacion`,
          title: "Local en Vivo",
          description: "Mesas, comandas, pedidos y caja en una sola pantalla.",
          icon: Monitor,
        },
        {
          href: `/${business_slug}/admin/pedidos/historial`,
          title: "Pedidos",
          description: "Todos los pedidos en un solo lugar, en vivo y con historial.",
          icon: Receipt,
        },
      ],
    },
    {
      label: "Tu oferta",
      items: [
        {
          href: `/${business_slug}/admin/catalogo`,
          title: "Tu carta",
          description: "Cambiá precios, fotos y disponibilidad en segundos.",
          icon: Utensils,
        },
        {
          href: `/${business_slug}/admin/menu-del-dia`,
          title: "Menú del día",
          description: "Programá los menús ejecutivos de toda la semana.",
          icon: CalendarDays,
        },
        {
          href: `/${business_slug}/admin/reservas`,
          title: "Reservas",
          description: "Agenda visual con tu plano de salón real.",
          icon: CalendarDays,
        },
        {
          href: `/${business_slug}/admin/catalogo?tab=stock`,
          title: "Stock",
          description: "Controlá las unidades de bebidas y vinos en tiempo real.",
          icon: Warehouse,
        },
      ],
    },
    {
      label: "Salón y dinero",
      items: [
        {
          href: `/${business_slug}/admin/salones`,
          title: "Salones",
          description: "Diseñá el plano de mesas arrastrando y soltando.",
          icon: Map,
        },
        {
          href: `/${business_slug}/admin/caja`,
          title: "Cajas",
          description: "Controlá las cajas, arqueos y movimientos de efectivo.",
          icon: CreditCard,
        },
        {
          href: `/${business_slug}/admin/clientes`,
          title: "Clientes",
          description: "Conocé quién vuelve, cuánto gasta y qué le gusta.",
          icon: Contact,
        },
      ],
    },
    {
      label: "Tu negocio",
      items: [
        {
          href: `/${business_slug}/admin/chatbot`,
          title: "Asistente IA",
          description: "Atiende consultas y toma pedidos por WhatsApp 24/7.",
          icon: Bot,
        },
        {
          href: `/${business_slug}/admin/rrhh`,
          title: "RRHH",
          description: "Fichadas, asistencia del equipo y control de horas.",
          icon: Users,
        },
        {
          href: `/${business_slug}/admin/configuracion`,
          title: "Configuración",
          description: "Personalizá colores, horarios, pagos y zonas de delivery.",
          icon: Settings,
        },
      ],
    },
  ];

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-zinc-50 px-4 py-16 sm:px-6">
      <div className="mx-auto max-w-5xl">
        {/* Header */}
        <header className="mb-16 text-center">
          <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
            Demo personalizada · {business.name}
          </p>
          <h1 className="mt-2 font-heading text-4xl font-semibold tracking-tight">
            Una plataforma, todo tu restaurante
          </h1>
          <p className="mt-3 text-base text-muted-foreground">
            Recorré la experiencia desde cada punto de contacto: el cliente que
            pide, el equipo que atiende y vos que dirigís el negocio.
          </p>
        </header>

        {/* ═══ ACTO 01: La experiencia del cliente ═══ */}
        <section className="mb-16">
          <div className="mb-6 flex items-baseline gap-4">
            <span className="select-none font-heading text-5xl font-bold text-zinc-200">
              01
            </span>
            <div>
              <h2 className="font-heading text-xl font-semibold">
                La experiencia de tu cliente
              </h2>
              <p className="text-sm text-muted-foreground">
                El camino del comensal, de la carta al pago.
              </p>
            </div>
          </div>

          {/* Hero flow: 3 cards con flechas */}
          <div className="overflow-hidden rounded-3xl bg-gradient-to-br from-sky-50 via-white to-sky-50/50 p-6 ring-1 ring-sky-100 sm:p-8">
            <div className="flex flex-col items-stretch gap-4 sm:flex-row sm:items-center sm:gap-3">
              {clienteHeroFlow.map((link, idx) => {
                const Icon = link.icon;
                return (
                  <div key={link.href} className="contents">
                    <Link
                      href={link.href}
                      className="group flex flex-1 flex-col items-center rounded-2xl bg-white p-6 text-center ring-1 ring-zinc-200 transition hover:-translate-y-1 hover:shadow-lg hover:ring-sky-300"
                    >
                      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-sky-100 text-sky-700 ring-1 ring-sky-200">
                        <Icon className="h-6 w-6" />
                      </div>
                      <h3 className="mt-4 font-heading text-base font-semibold">
                        {link.title}
                      </h3>
                      <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                        {link.description}
                      </p>
                      <span className="mt-4 text-sm font-medium text-sky-700 opacity-0 transition group-hover:opacity-100">
                        Probar →
                      </span>
                    </Link>
                    {idx < clienteHeroFlow.length - 1 && (
                      <ArrowRight className="hidden h-5 w-5 shrink-0 text-sky-300 sm:block" />
                    )}
                  </div>
                );
              })}
            </div>

            {/* Complementos */}
            <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {clienteExtra.map((link) => {
                const Icon = link.icon;
                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    className="group flex flex-col rounded-xl bg-white p-4 ring-1 ring-zinc-200 transition hover:-translate-y-0.5 hover:shadow-md hover:ring-zinc-300"
                  >
                    <div className="flex items-center gap-2">
                      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-sky-50 text-sky-600 ring-1 ring-sky-100">
                        <Icon className="h-4 w-4" />
                      </div>
                      <h3 className="font-heading text-sm font-semibold">
                        {link.title}
                      </h3>
                    </div>
                    <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                      {link.description}
                    </p>
                    <div className="mt-3 text-xs font-medium text-zinc-900 opacity-0 transition group-hover:opacity-100">
                      Ver →
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>
        </section>

        {/* ═══ ACTO 02: Tu equipo en acción ═══ */}
        <section className="mb-16">
          <div className="mb-6 flex items-baseline gap-4">
            <span className="select-none font-heading text-5xl font-bold text-zinc-200">
              02
            </span>
            <div>
              <h2 className="font-heading text-xl font-semibold">
                Tu equipo en acción
              </h2>
              <p className="text-sm text-muted-foreground">
                Las herramientas que usan mozos y empleados todos los días.
              </p>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            {roles.map((role) => {
              const Icon = role.icon;
              return (
                <Link
                  key={role.href}
                  href={role.href}
                  className="group relative flex flex-col overflow-hidden rounded-2xl bg-white p-6 ring-1 ring-zinc-200 transition hover:-translate-y-0.5 hover:shadow-lg hover:ring-zinc-300 sm:p-8"
                >
                  <div
                    className={`pointer-events-none absolute inset-0 bg-gradient-to-br ${role.accent} opacity-0 transition group-hover:opacity-100`}
                  />
                  <div className="relative flex items-start justify-between">
                    <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-zinc-900 text-white">
                      <Icon className="h-5 w-5" />
                    </div>
                    <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                      {role.subtitle}
                    </span>
                  </div>
                  <h2 className="relative mt-6 font-heading text-2xl font-semibold">
                    {role.title}
                  </h2>
                  <p className="relative mt-2 text-sm leading-relaxed text-muted-foreground">
                    {role.description}
                  </p>
                  <div className="relative mt-6 text-sm font-medium text-zinc-900">
                    Ver demo →
                  </div>
                </Link>
              );
            })}
          </div>
        </section>

        {/* ═══ ACTO 03: Vos al mando ═══ */}
        <section className="mb-16">
          <div className="mb-8 flex items-baseline gap-4">
            <span className="select-none font-heading text-5xl font-bold text-zinc-200">
              03
            </span>
            <div>
              <h2 className="font-heading text-xl font-semibold">
                Vos al mando
              </h2>
              <p className="text-sm text-muted-foreground">
                Todo el control del negocio en un solo panel.
              </p>
            </div>
          </div>

          <div className="grid gap-8 sm:grid-cols-2">
            {adminClusters.map((cluster) => (
              <div key={cluster.label}>
                <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  {cluster.label}
                </h3>
                <div className="space-y-2">
                  {cluster.items.map((link) => {
                    const Icon = link.icon;
                    return (
                      <Link
                        key={link.href}
                        href={link.href}
                        className="group flex items-center gap-3 rounded-xl bg-white p-3 ring-1 ring-zinc-200 transition hover:shadow-sm hover:ring-zinc-300"
                      >
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-violet-50 text-violet-600 ring-1 ring-violet-100">
                          <Icon className="h-4 w-4" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <h4 className="font-heading text-sm font-semibold">
                            {link.title}
                          </h4>
                          <p className="truncate text-xs text-muted-foreground">
                            {link.description}
                          </p>
                        </div>
                      </Link>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Footer */}
        <p className="text-center text-sm text-muted-foreground">
          Esta demo usa datos de ejemplo para que puedas explorar la plataforma
          sin compromiso.
        </p>
      </div>
    </div>
  );
}

export const dynamic = "force-dynamic";
