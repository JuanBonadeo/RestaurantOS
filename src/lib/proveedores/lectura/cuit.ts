/**
 * El CUIT que salió de una foto — spec 172.
 *
 * Ya hay un módulo de CUIT en `src/lib/afip/cuit.ts` y **no es el mismo trabajo**.
 * Aquel atiende un input: la persona tipea, el texto llega a medio escribir, y
 * por eso `normalizarCuit` devuelve los dígitos que haya y `esCuitValido` sólo
 * mira que sean once — el gateway de ARCA rechaza después el CUIT inexistente,
 * así que validar de más ahí sólo peleaba con el teclado.
 *
 * Acá el texto no lo tipeó nadie: lo transcribió el modelo de una foto de un
 * remito arrugado, y el destino no es ARCA sino
 * `proponer_proveedor_para_cabecera`, que busca por CUIT exacto. Dos cosas
 * cambian por eso:
 *
 * 1. **Once dígitos o nada.** Diez dígitos no son «un CUIT incompleto», son un
 *    CUIT mal leído. Mandarlo al RPC no encuentra nada en el mejor caso y
 *    encuentra al proveedor equivocado en el peor. Por eso `null` y a buscar por
 *    nombre, que es el camino que sí tolera la letra fea.
 * 2. **Se verifica el dígito verificador.** Es la única defensa barata contra un
 *    `6` que se leyó `8`: el módulo 11 rebota casi todas las transcripciones
 *    rotas antes de que lleguen a la base. Importa porque el CUIT **no es único**
 *    en `suppliers` —golf-jcr tiene 71 bien formados y 69 distintos— y una
 *    coincidencia por CUIT pesa mucho en la propuesta.
 *
 * Puro y sin `server-only` a propósito: lo usa el endpoint de lectura y también
 * la banda de proveedor en el cliente.
 */

/** Los pesos del módulo 11, de izquierda a derecha sobre los 10 primeros dígitos. */
const PESOS = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2] as const;

/**
 * Once dígitos sin separadores, o `null`.
 *
 * Acepta lo que el papel imprime de verdad: `30-68469261-1`, `30684692611`,
 * `CUIT: 30-68469261-1`, `C.U.I.T. 30 68469261 1`. **No** valida el dígito
 * verificador — normalizar y validar son dos preguntas distintas, y hay lugares
 * (mostrar lo leído para que la persona lo corrija) donde queremos el número
 * aunque no cierre.
 */
export function normalizarCuit(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;

  const texto = String(raw);
  if (!texto.trim()) return null;

  // El caso normal: el campo trae el CUIT y nada más que ruido sin dígitos
  // (`CUIT:`, `C.U.I.T.`, guiones, puntos, espacios). Se van todos y quedan 11.
  const digitos = texto.replace(/\D/g, "");
  if (digitos.length === 11) return digitos;
  if (digitos.length < 11) return null;

  // Sobran dígitos: el modelo metió más de un número en el campo (el clásico es
  // el CUIT del proveedor pegado al de Ingresos Brutos, o la fecha al lado). Se
  // busca la FORMA del CUIT —dos, ocho, uno— delimitada, en vez de rendirse:
  // rendirse acá pierde un CUIT que está perfectamente legible en el papel.
  const candidatos = new Set<string>();
  for (const m of texto.matchAll(/(?<!\d)(\d{2})[\s.\-]?(\d{8})[\s.\-]?(\d)(?!\d)/g)) {
    candidatos.add(`${m[1]}${m[2]}${m[3]}`);
  }
  if (candidatos.size === 1) return [...candidatos][0]!;

  // Dos formas de CUIT en el mismo campo. Si el módulo 11 deja una sola en pie,
  // esa es; si deja dos, no hay forma de saber cuál es el proveedor y adivinar
  // sale peor que el nombre.
  const validos = [...candidatos].filter(cuitValido);
  return validos.length === 1 ? validos[0]! : null;
}

/**
 * Módulo 11 sobre 11 dígitos ya normalizados.
 *
 * Devuelve `false` para cualquier cosa que no sean 11 dígitos: es la guarda que
 * permite llamarlo con lo que venga sin normalizar antes.
 */
export function cuitValido(cuit11: string): boolean {
  if (!/^\d{11}$/.test(cuit11)) return false;

  let suma = 0;
  for (let i = 0; i < 10; i++) suma += Number(cuit11[i]) * PESOS[i]!;

  let dv = 11 - (suma % 11);

  // Las dos ramas del algoritmo de ARCA, que existen porque el dígito
  // verificador tiene que entrar en un solo carácter:
  //
  // · resto 0 ⇒ el cálculo da 11 ⇒ el verificador es 0.
  // · el cálculo da 10 ⇒ no hay dígito posible con ese prefijo, así que ARCA le
  //   cambia el prefijo a la persona física (20→23 el varón, 27→24 la mujer) y
  //   el verificador queda 9. Nosotros aceptamos el 9 sin exigir que además haya
  //   venido con el prefijo 23/24: el que valida acá es un papel escaneado, no
  //   el padrón, y rechazar un CUIT que ARCA considera bueno nos deja sin la
  //   única pista fuerte que trae la cabecera.
  if (dv === 11) dv = 0;
  else if (dv === 10) dv = 9;

  return dv === Number(cuit11[10]);
}

/**
 * `30684692611` → `30-68469261-1`.
 *
 * Lo que no sean 11 dígitos vuelve tal cual, igual que en `afip/cuit.ts`:
 * formatear a medias algo que se está tipeando pelea con el input.
 */
export function formatearCuit(cuit11: string): string {
  if (!/^\d{11}$/.test(cuit11)) return cuit11;
  return `${cuit11.slice(0, 2)}-${cuit11.slice(2, 10)}-${cuit11.slice(10)}`;
}
