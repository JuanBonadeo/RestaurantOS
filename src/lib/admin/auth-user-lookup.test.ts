import { describe, expect, it } from "vitest";

import { findAuthUserByEmail, PAGE_SIZE } from "./auth-user-lookup";

// El alta buscaba al usuario con `listUsers({ perPage: 200 })` y se quedaba con
// esa primera página. Pasados los 200 usuarios en `auth.users` —de TODO el
// proyecto, no de un negocio— alguien que sí existía volvía `undefined`, el
// código lo tomaba por nuevo y `createUser` rebotaba con "already registered".
// El mensaje que veía el admin culpaba al email o al rol, nunca a la
// paginación. Y el camino que rompe es justo el frecuente: re-invitar a un
// empleado viejo, o la misma persona en el segundo local.

type FakeUser = { id: string; email: string };

function fakeService(users: FakeUser[]) {
  const pedidos: number[] = [];
  return {
    pedidos,
    auth: {
      admin: {
        listUsers: async ({ page = 1, perPage = PAGE_SIZE }) => {
          pedidos.push(page);
          const from = (page - 1) * perPage;
          return { data: { users: users.slice(from, from + perPage) } };
        },
      },
    },
  };
}

function padron(cantidad: number): FakeUser[] {
  return Array.from({ length: cantidad }, (_, i) => ({
    id: `u${i}`,
    email: `user${i}@example.test`,
  }));
}

describe("findAuthUserByEmail", () => {
  it("encuentra a alguien que quedó fuera de la primera página", async () => {
    const users = padron(PAGE_SIZE * 2 + 5);
    users[PAGE_SIZE * 2 + 3] = { id: "viejo", email: "fundador@example.test" };
    const service = fakeService(users);

    const found = await findAuthUserByEmail(
      service as never,
      "fundador@example.test",
    );

    expect(found?.id).toBe("viejo");
    expect(service.pedidos).toEqual([1, 2, 3]);
  });

  it("compara el email sin distinguir mayúsculas", async () => {
    const service = fakeService([{ id: "u1", email: "Ana@Example.test" }]);
    const found = await findAuthUserByEmail(service as never, "ana@example.TEST");
    expect(found?.id).toBe("u1");
  });

  it("corta en la última página en vez de pedir de más", async () => {
    const service = fakeService(padron(10));
    const found = await findAuthUserByEmail(service as never, "nadie@example.test");
    expect(found).toBeUndefined();
    expect(service.pedidos).toEqual([1]);
  });

  it("no encontrarlo con el padrón lleno tampoco cuelga el alta", async () => {
    const service = fakeService(padron(PAGE_SIZE * 3));
    const found = await findAuthUserByEmail(service as never, "nadie@example.test");
    expect(found).toBeUndefined();
    // 3 páginas llenas + la cuarta vacía que confirma el final.
    expect(service.pedidos).toEqual([1, 2, 3, 4]);
  });
});
