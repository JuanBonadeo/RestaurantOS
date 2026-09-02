export const BUSINESS_ROLES = [
  "admin",
  "encargado",
  "mozo",
  "terminal",
  "personal",
] as const;
export type BusinessRoleInput = (typeof BUSINESS_ROLES)[number];

export const ROLE_META: Record<
  BusinessRoleInput,
  { label: string; description: string }
> = {
  admin: {
    label: "Admin",
    description: "Manage total: catálogo, equipo, configuración y pagos.",
  },
  encargado: {
    label: "Encargado",
    description:
      "Salón, reservas, apertura y cierre de caja, cobros, descuentos hasta 25%, anulaciones, sangrías.",
  },
  mozo: {
    label: "Mozo",
    description:
      "Plano de mesas, toma de pedido, cobros, descuentos hasta 10%.",
  },
  terminal: {
    label: "Terminal del salón",
    description:
      "La compu compartida del salón: opera todas las mesas, carga pedidos y cobra. La plata se atribuye al mozo de cada mesa, no a esta cuenta.",
  },
  personal: {
    label: "Personal",
    description:
      "Cocina, limpieza, barra. Solo ficha asistencia, no opera el sistema.",
  },
};
