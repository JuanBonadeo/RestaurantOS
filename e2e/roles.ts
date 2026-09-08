/**
 * Los usuarios del negocio `demo`, por rol.
 *
 * Regla: cada spec entra con el rol **más bajo** que pueda hacer lo que prueba.
 * El techo de autorización (`canAcceptCajaDifference` = $5.000,
 * `DESCUENTO_MEDIO_PCT` = 25%) sólo aparece con el rol real — entrar de admin
 * "porque puede todo" es justamente no probar la guarda.
 */
export const SLUG = "demo";

export const ROLES = {
  encargada: "sofia@demo.test",
  admin: "admin@demo.test",
  mozo: "pedro@demo.test",
  mozo2: "diego@demo.test",
  personal: "ramon@demo.test",
} as const;

export type Rol = keyof typeof ROLES;

export const storageState = (rol: Rol) => `e2e/.auth/${rol}.json`;
