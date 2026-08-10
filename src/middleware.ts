import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

function resolveSlugFromHost(
  host: string | null,
  rootDomain: string | undefined,
): string | null {
  if (!rootDomain || !host || host === rootDomain) return null;
  const suffix = `.${rootDomain}`;
  if (!host.endsWith(suffix)) return null;
  const slug = host.slice(0, -suffix.length);
  if (!slug || slug.includes(".")) return null;
  return slug;
}

/**
 * Por qué `getClaims()` y no `getUser()` (spec 104).
 *
 * `getUser()` es un **hop de red a GoTrue** en cada request — y este matcher
 * incluye las peticiones RSC, así que se pagaba también en cada navegación
 * soft. `getClaims()` verifica la firma del JWT **local** con la clave pública
 * (el proyecto usa signing keys asimétricas: su JWKS publica una ES256, y la
 * librería la cachea). Si algún día el token volviera a ser simétrico,
 * `getClaims` cae solo a `getUser` — el cambio no puede quedar por debajo del
 * comportamiento anterior.
 *
 * Lo demás no cambia: `getClaims` llama a `getSession()` por dentro, así que el
 * refresh del token y la escritura de cookies siguen ocurriendo igual. Y el
 * gate fino sigue donde estaba: `ensureAdminAccess` / `ensureMozoAccess` en la
 * page, más RLS. Acá sólo se bloquea la sesión anónima.
 */
export async function middleware(request: NextRequest) {
  const rootDomain = process.env.ROOT_DOMAIN;
  const host = request.headers.get("host");
  const hostSlug = resolveSlugFromHost(host, rootDomain);
  const pathname = request.nextUrl.pathname;

  // Subdomain → path rewrite for prod. Skip global routes (auth callback,
  // platform admin at root, platform login, platform business CRUD).
  const isGlobalRoute =
    pathname === "/auth/callback" ||
    pathname === "/auth/confirm" ||
    pathname === "/" ||
    pathname === "/login" ||
    pathname.startsWith("/negocios") ||
    pathname.startsWith("/mis-locales");
  if (
    hostSlug &&
    !isGlobalRoute &&
    !pathname.startsWith(`/${hostSlug}/`) &&
    pathname !== `/${hostSlug}`
  ) {
    const url = request.nextUrl.clone();
    url.pathname = `/${hostSlug}${pathname === "/" ? "" : pathname}`;
    return NextResponse.rewrite(url);
  }

  // Effective path used for admin protection (same in dev)
  const effectivePath = hostSlug
    ? `/${hostSlug}${pathname === "/" ? "" : pathname}`
    : pathname;

  // Protect platform routes (/ and /negocios/*) y "Mis locales" (vista del dueño
  // multi-local, cross-negocio). /login es el ingreso anónimo, excluido.
  // El gate fino (admin de ≥2 locales) lo hace el layout de (owner); acá solo
  // se bloquea la sesión anónima.
  const isPlatformProtected =
    effectivePath === "/" ||
    effectivePath.startsWith("/negocios") ||
    effectivePath.startsWith("/mis-locales");
  if (isPlatformProtected) {
    const response = NextResponse.next();
    const supabase = makeSessionClient(request, response);
    const { data: claims } = await supabase.auth.getClaims();
    if (!claims) {
      const redirectUrl = request.nextUrl.clone();
      redirectUrl.pathname = `/login`;
      return NextResponse.redirect(redirectUrl);
    }
    return response;
  }

  // Protect /{slug}/admin/* (except /admin/login) y /{slug}/mozo/*.
  // El gating fino por rol/disabled lo hacen ensureAdminAccess/ensureMozoAccess
  // en la page; el middleware solo bloquea sesiones anónimas.
  const protectedMatch = effectivePath.match(
    /^\/([^/]+)\/(admin|mozo)(?:\/(.*))?$/,
  );
  if (protectedMatch) {
    const [, slug, area, rest = ""] = protectedMatch;
    const isAdminLogin = area === "admin" && rest === "login";
    if (!isAdminLogin) {
      const response = NextResponse.next();
      const supabase = makeSessionClient(request, response);
      const { data: claims } = await supabase.auth.getClaims();
      if (!claims) {
        const redirectUrl = request.nextUrl.clone();
        redirectUrl.pathname = `/${slug}/admin/login`;
        return NextResponse.redirect(redirectUrl);
      }
      return response;
    }
  }

  return NextResponse.next();
}

function makeSessionClient(request: NextRequest, response: NextResponse) {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookies) {
          for (const { name, value, options } of cookies) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );
}

export const config = {
  matcher: ["/((?!_next/|api/|.*\\..*).*)"],
};
