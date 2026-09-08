import { defineConfig, devices } from "@playwright/test";

/**
 * E2E — los procesos del local, del tablero en `wiki/qa/README.md`.
 *
 * Un archivo por proceso, con el mismo ID en los tres lados: el caso de uso
 * (`wiki/qa/procesos/P01-*.md`), el test (`e2e/P01-*.spec.ts`) y la issue.
 *
 * Corre SIEMPRE contra el stack local sembrado, nunca contra la nube — ver la
 * guarda en `e2e/guard-local.ts` y el porqué en el tablero. Antes de la primera
 * corrida:
 *
 *   pnpm setup:local     # supabase start + schema + seed del negocio demo
 *   pnpm e2e
 */
const PORT = Number(process.env.E2E_PORT ?? 3002);
const BASE_URL = process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  // Los procesos comparten el negocio `demo`: dos specs cobrando mesas a la vez
  // se pisan el arqueo. El paralelismo se gana sembrando por worker, no acá.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : [["list"]],
  timeout: 60_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL: BASE_URL,
    locale: "es-AR",
    timezoneId: "America/Argentina/Buenos_Aires",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },

  projects: [
    // Abre una sesión por rol y la deja en `e2e/.auth/<rol>.json`.
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
      dependencies: ["setup"],
    },
  ],

  // `dev:local` levanta supabase, apunta .env.local al stack local y arranca
  // Next. Si ya lo tenés corriendo, se reusa y no toca nada.
  webServer: {
    command: `pnpm dev --port ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: true,
    timeout: 180_000,
  },
});
