import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type { BusinessRole } from "@/lib/admin/context";
import { canManageProveedores } from "@/lib/permissions/can";
import { canSee } from "@/lib/permissions/sections";

/**
 * Issue #247 — Proveedores es plata: sólo admin y encargado.
 *
 * Antes de la migración 0068 las seis tablas del módulo tenían sus policies en
 * `is_business_member`, y la página no tenía gate de sección. Medido con el JWT
 * real de un mozo de `demo`: leía comprobantes y pagos, creaba proveedores,
 * editaba comprobantes y pagos, y borraba los 31 conceptos de gasto del negocio
 * de una sola llamada.
 *
 * La RLS no se puede testear desde acá (los integration tests necesitan el
 * stack local). Lo que sí se testea es lo que la RLS asume: que "quién maneja
 * proveedores" es UNA sola definición, y que la página la respeta.
 */

const ROLES: BusinessRole[] = ["admin", "encargado", "mozo", "terminal", "personal"];

describe("permisos de proveedores (#247)", () => {
  // La migración 0068 hardcodea `is_business_manager` (= admin + encargado) en
  // las policies. Ese SQL no puede importar `can.ts`, así que la coherencia se
  // sostiene sola: si alguien abre la sección a otro rol en la matriz, la
  // pantalla lo deja entrar pero PostgREST le devuelve cero filas, y la ficha
  // del proveedor se ve vacía sin ningún error. Este test es el que avisa que
  // hay que tocar también la RLS.
  it("la matriz de secciones y can.ts dicen lo mismo, rol por rol", () => {
    for (const role of ROLES) {
      expect(
        canSee("proveedores", role),
        `${role}: canSee y canManageProveedores no coinciden — si el cambio es a propósito, la RLS de la 0068 hay que moverla también`,
      ).toBe(canManageProveedores(role));
    }
  });

  it("sólo admin y encargado — que es lo que la 0068 escribió en la RLS", () => {
    expect(canSee("proveedores", "admin")).toBe(true);
    expect(canSee("proveedores", "encargado")).toBe(true);
    expect(canSee("proveedores", "mozo")).toBe(false);
    expect(canSee("proveedores", "terminal")).toBe(false);
    expect(canSee("proveedores", "personal")).toBe(false);
  });

  // El layout de `(authed)` deja pasar al mozo (por la Ayuda, spec 142) y al
  // terminal (por Operación, spec 140) contando con que cada página se defienda
  // sola — el comentario está en `sections.test.ts`. Proveedores era la única
  // página de plata que no se defendía, y sus cuatro queries corren con service
  // role: sin el gate, la lista y los saldos se renderizaban para cualquiera
  // que tipeara la URL. Se mira el ARCHIVO porque el fallo es la AUSENCIA de
  // una línea, y eso no se puede afirmar ejecutando el módulo.
  it("la página tiene su gate de sección, antes de leer nada", () => {
    const fuente = readFileSync(
      join(
        process.cwd(),
        "src/app/[business_slug]/admin/(authed)/proveedores/page.tsx",
      ),
      "utf8",
    );

    expect(fuente, "el gate de sección desapareció de proveedores/page.tsx").toMatch(
      /canSee\(\s*"proveedores"/,
    );
    expect(fuente).toMatch(/ensureAdminAccess\(/);

    // Y que gatee ANTES de consultar: las queries usan service role, así que un
    // gate después del `await` ya habría leído la plata del negocio.
    const posGate = fuente.search(/canSee\(\s*"proveedores"/);
    const posQuery = fuente.search(/getSuppliers\(/);
    expect(posGate, "no se encontró el gate").toBeGreaterThan(-1);
    expect(posQuery, "no se encontró getSuppliers").toBeGreaterThan(-1);
    expect(
      posGate,
      "el gate quedó DESPUÉS de la consulta: para cuando redirige, ya leyó",
    ).toBeLessThan(posQuery);
  });

  // La migración es el único lugar donde vive la lista de tablas del módulo.
  // Si mañana se agrega una (p. ej. `supplier_invoice_items`, #245) y nace con
  // el `is_business_member` de siempre, este test no la ve — pero el bloque de
  // autoverificación al final de la 0068 sí, y aborta. Acá se chequea lo que sí
  // se puede: que el .sql commiteado es el que se aplicó al cloud.
  it("la 0068 cubre las seis tablas del módulo", () => {
    const sql = readFileSync(
      join(
        process.cwd(),
        "supabase/migrations/0068_proveedores_solo_admin_y_encargado.sql",
      ),
      "utf8",
    );

    const tablas = [
      "suppliers",
      "supplier_invoices",
      "supplier_payments",
      "supplier_payment_allocations",
      "expense_concepts",
      "supplier_ingredients",
    ];
    for (const t of tablas) {
      expect(sql, `la 0068 no toca ${t}`).toContain(`on public.${t}`);
    }

    // Ninguna policy nueva puede quedar en el helper viejo.
    const creates = sql.match(/create policy[\s\S]*?;/g) ?? [];
    expect(creates.length, "la 0068 no crea policies").toBeGreaterThan(0);
    for (const c of creates) {
      expect(c, `una policy de la 0068 quedó en is_business_member: ${c}`).not.toContain(
        "is_business_member",
      );
    }
  });
});
