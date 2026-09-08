import { test as setup, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

import { assertStackLocal } from "./guard-local";
import { ROLES, storageState, type Rol } from "./roles";

/**
 * Abre una sesión por rol y la guarda, para que los specs no gasten tiempo
 * logueándose.
 *
 * Usa la misma mecánica que `scripts/magic-link.mjs` y que la invitación de
 * empleados: `auth.admin.generateLink` + `/auth/confirm`, que hace `verifyOtp` y
 * deja la cookie del server puesta. No se tipean contraseñas en formularios, y
 * la sesión que queda es la del **rol real** — nunca service_role.
 */
const { url, serviceKey } = assertStackLocal();

const admin = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

for (const [rol, email] of Object.entries(ROLES) as [Rol, string][]) {
  setup(`sesión de ${rol}`, async ({ page }) => {
    const { data, error } = await admin.auth.admin.generateLink({
      type: "magiclink",
      email,
    });
    if (error) {
      throw new Error(
        `No se pudo generar el link para ${email}: ${error.message}\n` +
          "¿Sembraste el negocio demo? → pnpm setup:local",
      );
    }

    const params = new URLSearchParams({
      token_hash: data.properties.hashed_token,
      type: "magiclink",
      next: "/",
    });
    await page.goto(`/auth/confirm?${params}`);

    // `/auth/confirm` redirige con `?error=` cuando el token no sirve, así que
    // un 200 no alcanza como prueba de que la sesión quedó abierta.
    await expect(page).not.toHaveURL(/[?&]error=/);

    await page.context().storageState({ path: storageState(rol) });
  });
}
