import type { SupabaseClient, User } from "@supabase/supabase-js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>;

/** Tamaño de página de GoTrue. El máximo que acepta el admin API. */
export const PAGE_SIZE = 200;

/**
 * Techo de seguridad: 50 páginas = 10.000 cuentas de auth. Es una barrera
 * contra un bucle infinito si GoTrue devolviera siempre páginas llenas, no un
 * límite de producto. Si algún día el proyecto pasa ese número, esto tiene que
 * volverse una consulta por email, no más páginas.
 */
const MAX_PAGES = 50;

/**
 * Busca una cuenta de auth por email, paginando.
 *
 * Antes esto era `listUsers({ perPage: 200 })` + `.find(...)`: sólo la primera
 * página. GoTrue ordena por fecha de creación, así que pasados los 200 usuarios
 * del proyecto —todos los negocios juntos, más los comensales que se registran
 * por la carta pública— los que dejaban de verse eran los MÁS VIEJOS: justo los
 * empleados fundadores que uno quiere re-invitar, y la misma persona dada de
 * alta en el segundo local. El alta los tomaba por gente nueva y `createUser`
 * rebotaba con "already registered", un error que manda a mirar el email o el
 * rol y nunca la paginación.
 *
 * Lo que se pierde: con el padrón grande, un alta de alguien realmente nuevo
 * paga N round-trips antes de darse por vencida. A 200 por página y con el
 * proyecto en ~150 cuentas, hoy es una sola llamada.
 */
export async function findAuthUserByEmail(
  service: AnyClient,
  email: string,
): Promise<User | undefined> {
  const buscado = email.toLowerCase();

  for (let page = 1; page <= MAX_PAGES; page++) {
    const { data } = await service.auth.admin.listUsers({
      page,
      perPage: PAGE_SIZE,
    });
    const users: User[] = data?.users ?? [];
    const found = users.find((u) => u.email?.toLowerCase() === buscado);
    if (found) return found;
    // Página incompleta = última página. No hay más para mirar.
    if (users.length < PAGE_SIZE) return undefined;
  }

  return undefined;
}
