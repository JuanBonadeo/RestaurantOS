import { notFound, redirect } from "next/navigation";

import { AdminSidebar } from "@/components/admin/admin-sidebar";
import { BrandStyle } from "@/components/admin/shell/brand-style";
import { NotificationsLauncher } from "@/components/notifications/notifications-launcher";
import { ensureAdminAccess } from "@/lib/admin/context";
import { getMyAdminBusinesses } from "@/lib/platform/queries";
import { getPendingOrderCount } from "@/lib/admin/orders-query";
import { getLowKitchenStockCount } from "@/lib/ingredients/queries";
import { countUnread, listForUser } from "@/lib/notifications/queries";
import { getLowStockCount } from "@/lib/stock/queries";
import { hasAnySection } from "@/lib/permissions/sections";
import { getBusiness, getBusinessSettings } from "@/lib/tenant";

export default async function AdminAuthedLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ business_slug: string }>;
}) {
  const { business_slug } = await params;
  const business = await getBusiness(business_slug);
  if (!business) notFound();

  const ctx = await ensureAdminAccess(business.id, business_slug);

  // Hard gate: quien no ve ninguna sección del panel no entra. Cubre todas las
  // páginas bajo /admin/(authed)/* con un único redirect — más simple que
  // repetirlo en cada page. El platform admin pasa siempre, aunque no tenga rol.
  //
  // Spec 140: antes esto era una blacklist (`role === "mozo"` → afuera) y por
  // eso la celda `operacion: "limited"` del mozo nunca llegaba a evaluarse.
  // Ahora manda la matriz, que es lo que deja entrar a `terminal` —el puesto
  // compartido del salón— sin abrirle la puerta al mozo, que sigue en /mozo.
  if (!ctx.isPlatformAdmin && !hasAnySection(ctx.role)) {
    redirect(`/${business_slug}/mozo`);
  }

  // Notificaciones: el rol nominal para el platform admin sin membresía es
  // "admin" — la jerarquía de `visibleTargetRoles` hace que el dueño vea
  // también lo del encargado.
  const notiRole = ctx.role ?? "admin";

  // Una sola tanda, no dos en serie (spec 104): antes los contadores del
  // sidebar y las notificaciones eran dos `Promise.all` encadenados, así que el
  // layout pagaba dos round-trips a la DB antes de dejar renderizar `children`.
  // Y `getMyAdminBusinesses` recibe el user ya resuelto, en vez de preguntarle
  // de nuevo a Supabase Auth quién es.
  const [
    pendingCount,
    lowBebidasCount,
    lowCocinaCount,
    myBusinesses,
    notifications,
    unreadCount,
  ] = await Promise.all([
    getPendingOrderCount(business.id, business.timezone),
    getLowStockCount(business.id),
    getLowKitchenStockCount(business.id),
    getMyAdminBusinesses(ctx.userId),
    listForUser({
      userId: ctx.userId,
      businessId: business.id,
      role: notiRole,
      limit: 20,
    }),
    countUnread({
      userId: ctx.userId,
      businessId: business.id,
      role: notiRole,
    }),
  ]);
  // Switcher de negocio: solo si el dueño es admin de ≥2 locales (spec 14).
  const siblings =
    myBusinesses.length >= 2
      ? myBusinesses.map((b) => ({
          slug: b.slug,
          name: b.name,
          logoUrl: b.logo_url,
        }))
      : [];
  // El badge de "Productos e inventario" suma faltantes de bebidas + cocina,
  // ya que ambos stocks ahora viven en la misma sección.
  const lowStockCount = lowBebidasCount + lowCocinaCount;
  const settings = getBusinessSettings(business);

  return (
    <div
      data-admin-brand
      className="flex min-h-screen bg-zinc-100/60"
    >
      <BrandStyle
        primary={settings.primary_color}
        primaryForeground={settings.primary_foreground}
      />
      <AdminSidebar
        slug={business_slug}
        businessId={business.id}
        businessName={business.name}
        businessLogoUrl={business.logo_url}
        userEmail={ctx.userEmail}
        userName={ctx.userName}
        isPlatformAdmin={ctx.isPlatformAdmin}
        role={ctx.role}
        siblings={siblings}
        initialPendingCount={pendingCount}
        lowStockCount={lowStockCount}
        isActive={business.is_active ?? true}
      />
      {/* En mobile el contenido despeja la top-bar fija (h-14) de
          AdminMobileNav. En md+ el rail lateral ocupa el flujo. */}
      <div className="min-w-0 flex-1 pt-14 md:pt-0">{children}</div>

      {/* Bell fixed top-right — visible en todas las pantallas admin,
          z-50 queda por encima del overlay del LocalShell (z-30) y de los
          page headers. Sheets/dialogs portados pueden subir por encima. */}
      <NotificationsLauncher
        notifications={notifications}
        unreadCount={unreadCount}
        businessSlug={business_slug}
        businessId={business.id}
        userId={ctx.userId}
        role={notiRole}
        fixed
      />
    </div>
  );
}
