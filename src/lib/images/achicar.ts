/**
 * Achicar una foto antes de subirla — spec 172.
 *
 * No es una mejora de UX: es precondición de poder leer la factura.
 *
 * · El `ImageUploader` corta en 5 MB (`image-uploader.tsx`) y una foto de un
 *   celular moderno pesa 4-6 MB. La primera foto real de una factura rebota.
 * · La API de visión acepta `image/jpeg|png|gif|webp` y **no HEIC**, que es lo
 *   que sale de un iPhone por default.
 * · La imagen viaja al modelo en base64, que infla 4/3 sobre un techo de 5 MB
 *   por imagen: el archivo tiene que quedar por debajo de ~3,6 MB.
 *
 * El lado largo va a 2200 px porque la API reescala a 1568 de todos modos: más
 * resolución no le sirve al modelo, y menos le saca detalle al humano que
 * después abre la foto para contrastarla contra la pantalla.
 */
export const LADO_LARGO_DEFAULT = 2200;

/**
 * Las dimensiones de destino conservando la proporción.
 *
 * Nunca agranda: una foto ya chica se deja como está. Devolver el mismo tamaño
 * es lo que permite al llamador saltear el redibujado.
 */
export function calcularDimensiones(
  ancho: number,
  alto: number,
  ladoLargo = LADO_LARGO_DEFAULT,
): { ancho: number; alto: number } {
  const mayor = Math.max(ancho, alto);
  if (mayor <= ladoLargo || mayor === 0) return { ancho, alto };

  const escala = ladoLargo / mayor;
  return {
    // `round` y no `floor`: con floor, una imagen de 1 px de lado en la
    // dimensión chica se iría a 0 y el canvas tira `IndexSizeError`.
    ancho: Math.max(1, Math.round(ancho * escala)),
    alto: Math.max(1, Math.round(alto * escala)),
  };
}

/** Sólo en el browser: usa `createImageBitmap` y `<canvas>`. */
export async function achicarImagen(
  file: File,
  ladoLargo = LADO_LARGO_DEFAULT,
): Promise<File> {
  // `createImageBitmap` y no `new Image()` con object URL: decodifica fuera del
  // hilo principal y, en Safari, es el camino que entiende HEIC. Si el browser
  // no puede con el formato, tira y devolvemos el original — que fallará más
  // adelante con un mensaje propio, no con una pantalla trabada acá.
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return file;
  }

  try {
    const destino = calcularDimensiones(bitmap.width, bitmap.height, ladoLargo);

    // Ya entra y ya es un formato que el modelo lee: no se toca. Redibujar una
    // foto que no lo necesita sólo le saca calidad.
    const yaSirve =
      destino.ancho === bitmap.width &&
      destino.alto === bitmap.height &&
      (file.type === "image/jpeg" || file.type === "image/png") &&
      file.size <= 3_600_000;
    if (yaSirve) return file;

    const canvas = document.createElement("canvas");
    canvas.width = destino.ancho;
    canvas.height = destino.alto;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, destino.ancho, destino.alto);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.85),
    );
    if (!blob) return file;

    const nombre = file.name.replace(/\.[^.]+$/, "") || "comprobante";
    return new File([blob], `${nombre}.jpg`, { type: "image/jpeg" });
  } finally {
    bitmap.close();
  }
}
