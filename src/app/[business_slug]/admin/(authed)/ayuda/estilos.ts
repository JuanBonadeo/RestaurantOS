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
//   - 60-70 caracteres por línea
//
// OJO CON LA DIFERENCIA ENTRE LOS DOS ANCHOS (D20). Durante tres versiones el
// límite de lectura estuvo puesto en el CONTENEDOR, así que también achicaba
// las capturas: una pantalla de 1160 px entraba en 490 y no se leía un rótulo.
// Ahora:
//
//   PAGINA → el ancho de la página. Amplio, para que la captura entre grande.
//   TEXTO  → el ancho de LECTURA. Se le pone a cada párrafo, no al bloque.
//
// Si algún día alguien vuelve a envolver todo en TEXTO, las imágenes se
// achican otra vez y la guía vuelve a ser un muro de texto con estampillas.
export const PROSA = "text-[18px] leading-[1.6] text-zinc-800";
export const SECUNDARIO = "text-[18px] leading-[1.6] text-zinc-600";
export const H1 = "text-[30px] font-semibold leading-tight tracking-tight text-zinc-900 sm:text-[36px]";
export const H2 = "text-[22px] font-semibold leading-snug text-zinc-900 sm:text-[24px]";

/** Ancho de LECTURA: 60-70 caracteres. Va en los párrafos y los títulos. */
export const TEXTO = "max-w-[68ch]";

/** Ancho de la PÁGINA. La captura llega hasta acá. */
export const PAGINA = "mx-auto w-full max-w-[1180px]";
