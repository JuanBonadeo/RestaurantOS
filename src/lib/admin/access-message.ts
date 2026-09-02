/**
 * El mensaje que el admin copia y le manda a alguien del equipo para que entre
 * (spec 142 · D5).
 *
 * Existe porque el que había decía «Te invito a entrar al panel de Pedidos» y
 * nada más: no nombraba el negocio (para un mozo, «Pedidos» no significa nada),
 * no decía con qué entrar después del link, y no avisaba que el link se vence
 * en una hora — así que el que lo abría al otro día veía un error y no sabía
 * qué hacer.
 *
 * Función pura para poder probarla, y compartida por los tres lugares que hoy
 * arman este texto por su cuenta: los dos modos del alta y el botón nuevo de la
 * fila del miembro.
 */
export function buildAccessMessage(input: {
  businessName: string;
  link: string;
  /** El identificador que le va a resultar fácil. Null para quien no tiene. */
  pin: string | null;
  email: string;
  /** `welcomed_at` seteado: ya eligió contraseña alguna vez. */
  yaTienePassword: boolean;
}): string {
  const { businessName, link, pin, email, yaTienePassword } = input;

  // El PIN adelante cuando existe: son los 4 dígitos que ya usa para fichar, y
  // es lo único de todo esto que se va a acordar sin mirar el papel.
  const conQue = pin
    ? `tu PIN ${pin} (o tu email, ${email})`
    : `tu email, ${email}`;

  const cuerpo = yaTienePassword
    ? [
        `Hola! Este link te deja entrar directo al sistema de ${businessName}:`,
        "",
        link,
        "",
        `Después entrás con ${conQue} y tu contraseña de siempre.`,
      ]
    : [
        `Hola! Ya tenés acceso al sistema de ${businessName}.`,
        "",
        "Abrí este link y elegí tu contraseña:",
        "",
        link,
        "",
        `De ahí en más entrás con ${conQue} y esa contraseña.`,
      ];

  return [
    ...cuerpo,
    "",
    "El link vence en 1 hora — si te expira, pedime otro.",
  ].join("\n");
}
