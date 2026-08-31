// D6 de la spec 134: la legibilidad es EL requisito, no un detalle de estilo.
//
// El panel está hecho para nosotros y usa 13-14 px con `text-zinc-500`. Para
// esta guía nada de eso sirve: la lee un encargado de 55 años, parado, con el
// salón lleno y el celular en una mano.
//
//   - cuerpo 18 px, interlineado 1.6
//   - contraste ≥ 7:1  →  zinc-800 (#27272a, ~14:1) y zinc-600 (#52525b, ~7.4:1).
//     zinc-500 da 4.8:1 y queda PROHIBIDO para texto que haya que leer, por más
//     que sea el gris que usa el resto del panel.
//   - 60-70 caracteres por línea → max-w-[68ch]
//
// Sobre `--brand`: se usa sólo para RELLENOS (el círculo del número, el fondo
// del ícono), nunca para texto. El color es configurable por negocio y puede
// venir claro; un local con la marca amarilla tendría los links a 2:1 y toda
// la decisión de contraste de arriba se caería sola. El texto se queda en zinc.
export const PROSA = "text-[18px] leading-[1.6] text-zinc-800";
export const SECUNDARIO = "text-[18px] leading-[1.6] text-zinc-600";
export const H1 = "text-[30px] font-semibold leading-tight tracking-tight text-zinc-900";
export const H2 = "text-[22px] font-semibold leading-snug text-zinc-900";
export const ANCHO = "mx-auto w-full max-w-[68ch]";
