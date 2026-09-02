import type { BusinessRole } from "@/lib/admin/context";

// ============================================
// Secciones del panel admin × rol — fuente de verdad de qué ve cada quien.
//
// Reemplaza el booleano grueso `canManageBusiness` (admin sí / no) por una
// matriz fina por sección. De acá derivan el sidebar (qué items se muestran) y
// los page-gates (a qué URL se puede entrar). Un solo lugar para cambiar un
// permiso = una celda.
//
// Espejo de la matriz en
// `wiki/specs/14-multi-local-y-deploy-onsite/dashboard-y-permisos.md` (§B).
//
// Spec 140 — `terminal` (el puesto compartido del salón) sólo ve `operacion`, y
// en "limited": el plano, comandas, reservas y fichaje. Nada de caja, rendición
// ni pedidos de mostrador. Ver D2 de la spec.
//
// "full"    → ve/usa la sección completa.
// "limited" → versión recortada (ej: chatbot solo on/off).
// "none"    → sin acceso (ni en el sidebar ni por URL).
// ============================================

export type AdminSection =
  | "dashboard"
  | "operacion"
  | "pedidos"
  | "cajas"
  | "catalogo"
  | "salones"
  | "reservas"
  | "clientes"
  | "promociones"
  | "campanas"
  | "chatbot"
  | "conversaciones"
  | "reportes"
  | "proveedores"
  | "facturacion"
  | "rrhh"
  | "configuracion"
  | "ayuda";

export type SectionAccess = "full" | "limited" | "none";

// NOTA — "sección admin" vs "acción operativa": esta matriz gobierna qué
// **secciones del panel admin** ve cada rol (sidebar + page-gate). Algunas
// acciones que el encargado SÍ hace viven en OTRAS superficies que ya ve, no en
// estas secciones de administración:
//   - cortes/sangría → se hacen en Operación (`operacion?tab=caja`), no en la
//     sección Cajas (que es config de caja, admin). Por eso `cajas` = none p/ encargado.
//   - emitir factura → también en el flujo de cobro (mozo/encargado). Pero eso
//     NO alcanzaba: la sección Facturación es el único lugar donde se ve el
//     comprobante después (reintentar una fallida, anular con nota de crédito,
//     buscar la de una mesa que ya se fue), y el encargado la tenía en `none`.
//     Se le abrió el 2026-08-04 (#139). Ojo: la config AFIP (CUIT, punto de
//     venta, credencial del gateway) NO vive acá sino en `configuracion`, que
//     sigue siendo admin-only — por eso abrir esta sección no le da al
//     encargado ninguna llave del negocio.
//   - reservas del día → también viven como tab dentro de Operación
//     (`operacion?tab=reservas`); la sección sigue disponible para el encargado.
const MATRIX: Record<AdminSection, Record<BusinessRole, SectionAccess>> = {
  // Dashboard: admin-only (decisión 2026-07-25, Juan). Es analítica del negocio
  // (ingresos, márgenes, CMV, merma) — mismo criterio que Reportes. El encargado
  // entra directo a Operación: su turno se mide ahí (mesas, caja, rendición).
  dashboard: {
    admin: "full",
    encargado: "none",
    mozo: "none",
    terminal: "none",
    personal: "none",
  },
  // El mozo queda en "none" (spec 140). Esta celda decía "limited" desde la 14,
  // pero era letra muerta: el layout de `(authed)` lo redirigía antes de que
  // `canSee` se evaluara, así que el mozo nunca entró. La intención que
  // expresaba —alguien de salón operando el panel— es la que ahora cumple
  // `terminal`. El mozo con móvil tiene su superficie en `/mozo`.
  operacion: {
    admin: "full",
    encargado: "full",
    mozo: "none",
    terminal: "limited",
    personal: "none",
  },
  pedidos: {
    admin: "full",
    encargado: "full",
    mozo: "none",
    terminal: "none",
    personal: "none",
  },
  cajas: {
    admin: "full",
    encargado: "none",
    mozo: "none",
    terminal: "none",
    personal: "none",
  },
  catalogo: {
    admin: "full",
    encargado: "full",
    mozo: "none",
    terminal: "none",
    personal: "none",
  },
  // Salones: encargado full (decisión 2026-07-28, Juan). Es layout del local —
  // crear/renombrar salones y dibujar mesas es trabajo de piso, no config
  // sensible del negocio: el encargado arma el salón cuando cambia el mobiliario
  // (eventos, temporada) sin depender del dueño.
  salones: {
    admin: "full",
    encargado: "full",
    mozo: "none",
    terminal: "none",
    personal: "none",
  },
  reservas: {
    admin: "full",
    encargado: "full",
    mozo: "none",
    terminal: "none",
    personal: "none",
  },
  clientes: {
    admin: "full",
    encargado: "full",
    mozo: "none",
    terminal: "none",
    personal: "none",
  },
  promociones: {
    admin: "full",
    encargado: "full",
    mozo: "none",
    terminal: "none",
    personal: "none",
  },
  campanas: {
    admin: "full",
    encargado: "full",
    mozo: "none",
    terminal: "none",
    personal: "none",
  },
  chatbot: {
    admin: "full",
    encargado: "limited",
    mozo: "none",
    terminal: "none",
    personal: "none",
  },
  // Bandeja de conversaciones + handoff humano (spec 32): atención al cliente
  // del mostrador. Admin/encargado la operan; mozo está en salón.
  conversaciones: {
    admin: "full",
    encargado: "full",
    mozo: "none",
    terminal: "none",
    personal: "none",
  },
  reportes: {
    admin: "full",
    encargado: "none",
    mozo: "none",
    terminal: "none",
    personal: "none",
  },
  proveedores: {
    admin: "full",
    encargado: "full",
    mozo: "none",
    terminal: "none",
    personal: "none",
  },
  facturacion: {
    admin: "full",
    encargado: "full",
    mozo: "none",
    terminal: "none",
    personal: "none",
  },
  // RRHH: admin-only (decisión 2026-06-15, confirmada por Juan). El encargado ya
  // no gestiona fichajes/equipo desde el panel admin.
  rrhh: {
    admin: "full",
    encargado: "none",
    mozo: "none",
    terminal: "none",
    personal: "none",
  },
  configuracion: {
    admin: "full",
    encargado: "none",
    mozo: "none",
    terminal: "none",
    personal: "none",
  },
  // Ayuda (spec 134): la guía está ESCRITA para el encargado — su turno, sus
  // topes, sus carteles. El admin la ve porque ve todo y porque es quien la
  // manda a leer. El mozo no: su superficie es /mozo y el layout de
  // `(authed)` ya lo redirige antes de llegar acá; darle un ítem que no puede
  // abrir sería prometerle una guía que no es la suya.
  ayuda: {
    admin: "full",
    encargado: "full",
    mozo: "none",
    terminal: "none",
    personal: "none",
  },
};

type AccessOpts = { isPlatformAdmin?: boolean };

/**
 * Nivel de acceso de un rol a una sección. El platform admin (equipo dev)
 * siempre ve todo. Sin rol (no-miembro) no ve nada.
 */
export function sectionAccess(
  section: AdminSection,
  role: BusinessRole | null,
  opts: AccessOpts = {},
): SectionAccess {
  if (opts.isPlatformAdmin) return "full";
  if (!role) return "none";
  return MATRIX[section][role];
}

/** ¿El rol puede ver la sección (en cualquier nivel)? Para el sidebar y los gates. */
export function canSee(
  section: AdminSection,
  role: BusinessRole | null,
  opts: AccessOpts = {},
): boolean {
  return sectionAccess(section, role, opts) !== "none";
}

/**
 * ¿El rol tiene *alguna* sección del panel? Es el gate del layout de
 * `admin/(authed)` (spec 140): antes preguntaba "¿sos mozo? afuera", una
 * blacklist que había que recordar actualizar cada vez que aparecía un rol.
 * Ahora la matriz decide, y un rol nuevo entra o no según sus celdas.
 */
export function hasAnySection(
  role: BusinessRole | null,
  opts: AccessOpts = {},
): boolean {
  if (opts.isPlatformAdmin) return true;
  if (!role) return false;
  return Object.keys(MATRIX).some((s) =>
    canSee(s as AdminSection, role, opts),
  );
}
