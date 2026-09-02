import "server-only";

import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

type LimitResult = { success: boolean };

// Redis compartido entre limitadores. `undefined` = sin resolver todavía;
// `null` = Upstash no configurado en este entorno (degradación elegante: los
// limitadores dejan pasar). Se resuelve una sola vez por proceso.
let redis: Redis | null | undefined;

function getRedis(): Redis | null {
  if (redis !== undefined) return redis;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  redis = url && token ? new Redis({ url, token }) : null;
  return redis;
}

// Un limitador por prefijo, cacheado. Sin Redis → null (no limita).
const limiters = new Map<string, Ratelimit>();

function getLimiter(
  prefix: string,
  limiter: ConstructorParameters<typeof Ratelimit>[0]["limiter"],
): Ratelimit | null {
  const r = getRedis();
  if (!r) return null;
  const cached = limiters.get(prefix);
  if (cached) return cached;
  const l = new Ratelimit({ redis: r, limiter, prefix });
  limiters.set(prefix, l);
  return l;
}

export async function limitCreateOrder(ip: string): Promise<LimitResult> {
  const l = getLimiter(
    "pedidos:createOrder",
    Ratelimit.slidingWindow(5, "1 m"),
  );
  if (!l) return { success: true };
  const { success } = await l.limit(ip);
  return { success };
}

// Chatbot: límite de dos niveles para proteger antes de invocar al modelo.
// - Por contacto (anti-spam): corta el doble/triple-texteo abusivo de un usuario.
// - Por negocio (techo de costo / anti-DoS): acota el gasto agregado por hora
//   aunque entren muchos contactos distintos.
// Ambos configurables por env; defaults conservadores-generosos para no cortar
// uso legítimo del piloto.
const CHATBOT_PER_CONTACT_PER_MIN = Number(
  process.env.CHATBOT_RL_PER_CONTACT_PER_MIN ?? 8,
);
const CHATBOT_PER_BUSINESS_PER_HOUR = Number(
  process.env.CHATBOT_RL_PER_BUSINESS_PER_HOUR ?? 240,
);

export async function limitChatbotTurn(
  businessId: string,
  contactIdentifier: string,
): Promise<LimitResult> {
  const contactLimiter = getLimiter(
    "pedidos:chatbot:contact",
    Ratelimit.slidingWindow(CHATBOT_PER_CONTACT_PER_MIN, "1 m"),
  );
  const businessLimiter = getLimiter(
    "pedidos:chatbot:business",
    Ratelimit.slidingWindow(CHATBOT_PER_BUSINESS_PER_HOUR, "1 h"),
  );
  // Sin Upstash configurado → degradación elegante (no rompe la operación).
  if (!contactLimiter || !businessLimiter) return { success: true };

  const [contact, business] = await Promise.all([
    contactLimiter.limit(`${businessId}:${contactIdentifier}`),
    businessLimiter.limit(businessId),
  ]);
  return { success: contact.success && business.success };
}

// Login del panel (spec 142). Con el PIN como identificador, el espacio de
// identidades de un negocio pasa a ser 10.000 números — y golf-jcr tiene 38
// PINs activos, o sea que 1 de cada 263 acierta a alguien. La contraseña sigue
// siendo lo que autentica, pero sin un techo por IP nada impide recorrer el
// espacio entero probando contraseñas comunes contra cada PIN.
//
// Dos niveles: una ráfaga corta tolerable (el que se equivoca tipeando) y un
// techo por hora que hace inviable la enumeración.
const LOGIN_PER_IP_PER_MIN = Number(process.env.LOGIN_RL_PER_IP_PER_MIN ?? 10);
const LOGIN_PER_IP_PER_HOUR = Number(process.env.LOGIN_RL_PER_IP_PER_HOUR ?? 60);

export async function limitLogin(ip: string): Promise<LimitResult> {
  const burst = getLimiter(
    "pedidos:login:min",
    Ratelimit.slidingWindow(LOGIN_PER_IP_PER_MIN, "1 m"),
  );
  const hourly = getLimiter(
    "pedidos:login:hour",
    Ratelimit.slidingWindow(LOGIN_PER_IP_PER_HOUR, "1 h"),
  );
  // Sin Upstash configurado → degradación elegante, igual que el resto.
  if (!burst || !hourly) return { success: true };

  const [a, b] = await Promise.all([burst.limit(ip), hourly.limit(ip)]);
  return { success: a.success && b.success };
}

// ─────────────────────────────────────────────────────────────────────
// SPEC 25 (PENDING) — limitador de envío de códigos por WhatsApp, DESACTIVADO.
// Preservado (comentado) hasta reactivar la verificación. Dos niveles por
// identidad (user_id|teléfono): cooldown 1/60s + techo 5/h.
// ─────────────────────────────────────────────────────────────────────
//
// export async function limitPhoneVerificationSend(
//   identifier: string,
// ): Promise<LimitResult> {
//   const cooldown = getLimiter(
//     "pedidos:phoneverify:cooldown",
//     Ratelimit.slidingWindow(1, "60 s"),
//   );
//   const hourly = getLimiter(
//     "pedidos:phoneverify:hour",
//     Ratelimit.slidingWindow(5, "1 h"),
//   );
//   // Sin Upstash configurado → degradación elegante (no limita).
//   if (!cooldown || !hourly) return { success: true };
//
//   const [a, b] = await Promise.all([
//     cooldown.limit(identifier),
//     hourly.limit(identifier),
//   ]);
//   return { success: a.success && b.success };
// }
