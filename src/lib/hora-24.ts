/**
 * Campo de hora en 24 h (spec 133) — máscara y validación puras.
 *
 * `<input type="time">` no sirve para esto: Chrome ignora el `lang` del
 * documento y del propio input, y saca el formato del locale del navegador. En
 * una máquina en `en-US` el encargado ve «06:00 PM» mientras el resto del
 * sistema —la lista de reservas, la comanda, el ticket— dice «18:00». A las 2
 * de la mañana esa diferencia se lee mal.
 *
 * Acá vive lo que se puede testear sin DOM: cómo se ve lo que se va tipeando
 * (`maskTime24`) y qué es una hora válida (`normalizeTime24`).
 */

/** Sólo los dígitos, hasta 4 (HHMM). */
function digits(raw: string): string {
  return raw.replace(/\D/g, "").slice(0, 4);
}

/**
 * Da forma a lo que el usuario está escribiendo. Se tipea `2130` y queda
 * `21:30`; los dos puntos los pone el campo.
 *
 * `deleting` = el usuario está borrando. Sin ese dato, un campo que auto-cierra
 * la hora con `:` es imposible de borrar: al sacar el `:` de «12:» la máscara
 * lo volvería a poner. Mientras borra, no se agrega nada.
 */
export function maskTime24(raw: string, deleting = false): string {
  const d = digits(raw);
  if (d === "") return "";

  // Un primer dígito de 3 en adelante no puede abrir una hora de dos cifras
  // (no hay 30 h): es «9» = 09, y pasamos derecho a los minutos.
  if (d.length === 1) {
    if (Number(d) >= 3) return deleting ? d : `0${d}:`;
    return d;
  }

  let hh = d.slice(0, 2);
  let rest = d.slice(2);
  // «29» tampoco es hora: el 2 era la hora y el 9 abre los minutos.
  if (Number(hh) > 23) {
    hh = `0${d[0]}`;
    rest = d.slice(1, 3);
  }

  if (rest === "") return deleting ? hh : `${hh}:`;
  return `${hh}:${rest.slice(0, 2)}`;
}

/**
 * La hora completa y válida, o `null` si todavía no lo es. `null` es también la
 * respuesta para lo incompleto («21:»), que es lo correcto: hasta que no está
 * entera, el campo no tiene hora.
 */
export function normalizeTime24(raw: string): string | null {
  const text = raw.trim();
  if (text === "") return null;

  let hh: string;
  let mm: string;
  if (text.includes(":")) {
    // Con separador la lectura es inequívoca: «9:30» son las nueve y media.
    // Los minutos van completos a propósito — «21:3» puede ser 21:03 o 21:30,
    // y adivinar ahí es peor que pedirle el dígito que falta.
    const [left, right = ""] = text.split(":");
    hh = digits(left);
    mm = digits(right);
    if (hh.length < 1 || hh.length > 2 || mm.length !== 2) return null;
  } else {
    const d = digits(text);
    if (d.length === 4) {
      hh = d.slice(0, 2);
      mm = d.slice(2);
    } else if (d.length === 3) {
      // «930» son las nueve y media, no las 93.
      hh = d.slice(0, 1);
      mm = d.slice(1);
    } else {
      return null;
    }
  }

  const h = Number(hh);
  const m = Number(mm);
  if (!Number.isInteger(h) || !Number.isInteger(m)) return null;
  if (h > 23 || m > 59) return null;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** ¿Este string ya es una hora `HH:MM` válida? */
export function isTime24(value: string): boolean {
  return normalizeTime24(value) === value;
}
