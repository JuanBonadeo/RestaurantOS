import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    tsconfigPaths: true,
    alias: {
      "server-only": path.resolve(__dirname, "vitest.server-only-stub.ts"),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    // Los tests de integración corren contra la DB **cloud**, con ~300ms de RTT
    // por query: un `registrarPago` son ~6 round-trips (1.8s) y un caso que
    // crea la orden, cobra y verifica pasa de 4s. Con el default de 5s, esos
    // tests fallaban por la red y no por el código — rojos que enmascaraban
    // fallas reales. El día que los tests corran contra una base local esto
    // puede volver a bajar.
    testTimeout: 20_000,
    hookTimeout: 60_000,
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    css: true,
  },
});
