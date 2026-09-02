/**
 * Con qué se identifica alguien al entrar: su email, o su PIN de 4 dígitos.
 *
 * Spec 142 · D1 — el PIN reemplaza al **email**, no a la contraseña. Sigue
 * siendo identificador + secreto; lo único que cambia es que el identificador
 * pasa a ser algo que la persona ya se sabe de memoria, porque lo usa todos los
 * días para fichar. Los emails del padrón migrado de MaxiRest son
 * `nombre.apellido@golf-jcr.internal`: treinta caracteres de una casilla que no
 * existe, tipeados en la pantalla del local.
 *
 * Función pura: sólo decide **por dónde buscar** a la persona. Quién la
 * encuentra, y qué se le contesta si no está, es de `signIn` (ver D2: un solo
 * mensaje de error, o esto se vuelve un oráculo de PINs válidos).
 */
export type Identificador =
  | { tipo: "pin"; valor: string }
  | { tipo: "email"; valor: string };

/** Mismo formato que `clockPunch` y la columna `business_users.pin`. */
const PIN_RE = /^\d{4}$/;

/**
 * Deliberadamente laxo comparado con un validador de emails de verdad: lo único
 * que hace falta acá es distinguir «esto es un email» de «esto es un PIN» o de
 * «esto es basura». Si el email no existe, lo dice Supabase — con el mismo
 * mensaje genérico que todo lo demás.
 */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function parseIdentificador(raw: string): Identificador | null {
  const v = raw.trim();
  if (!v) return null;
  // El PIN se evalúa primero, pero sólo matchea 4 dígitos *solos*: un email que
  // arranca con números (`1234@demo.test`) cae en la rama de email, como debe.
  if (PIN_RE.test(v)) return { tipo: "pin", valor: v };
  const lower = v.toLowerCase();
  if (EMAIL_RE.test(lower)) return { tipo: "email", valor: lower };
  return null;
}
