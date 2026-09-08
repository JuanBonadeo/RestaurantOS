"use client";

import { useRef, useState } from "react";
import Image from "next/image";
import { ImageIcon, ImagePlus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { achicarImagen } from "@/lib/images/achicar";

export function ImageUploader({
  businessId,
  value,
  onChange,
  bucket = "products",
  pathPrefix,
  variant = "avatar-square",
  layout = "auto",
  returnPath = false,
  maxEdgePx,
}: {
  businessId: string;
  value: string | null;
  onChange: (url: string | null) => void;
  bucket?: string;
  pathPrefix?: string;
  variant?: "avatar-square" | "avatar-circle" | "cover";
  layout?: "auto" | "stacked";
  returnPath?: boolean;
  /**
   * spec 172 · si viene, la imagen se achica a ese lado largo y se convierte a
   * JPEG antes de subir. Sin la prop no cambia nada: el catálogo, el branding y
   * el plano de salón siguen subiendo el archivo tal cual.
   */
  maxEdgePx?: number;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  /**
   * Preview local de lo recién subido — spec 163.
   *
   * Con `returnPath` (el bucket es privado, como el de comprobantes) sólo
   * tenemos la ruta, no una URL que `<Image>` pueda pintar, y la rama que la
   * manejaba mostraba **el mismo ícono que el estado vacío**: no había forma de
   * saber si la foto quedó. Ya falló en el negocio real — dos objetos huérfanos
   * en el bucket de golf-jcr, subidos con 15 s de diferencia contra 0
   * comprobantes: alguien subió, no vio nada, y volvió a subir.
   *
   * El `objectURL` del archivo elegido resuelve el caso que importa (acabás de
   * subirla y la ves); si el valor viene de la base, al menos se distingue
   * «hay una foto» de «no hay».
   */
  const [localPreview, setLocalPreview] = useState<string | null>(null);

  const handleFile = async (original: File) => {
    if (!original.type.startsWith("image/")) {
      toast.error("Solo imágenes.");
      return;
    }
    setUploading(true);
    try {
      /**
       * El achicado va ANTES del control de tamaño — spec 172.
       *
       * Con el orden al revés, una foto de celular de 12 MP (4-6 MB) rebota
       * contra el tope de 5 MB sin que el resize llegue a correr nunca, que es
       * justo el caso para el que existe. Y de paso pasa el HEIC del iPhone a
       * JPEG, que es lo único que el lector de facturas sabe leer.
       *
       * Es opt-in por `maxEdgePx`: sin la prop, este uploader se comporta igual
       * que antes para el catálogo, el branding y el plano de salón.
       */
      const file = maxEdgePx ? await achicarImagen(original, maxEdgePx) : original;

      if (file.size > 5 * 1024 * 1024) {
        toast.error("Máximo 5MB.");
        return;
      }

      const supabase = createSupabaseBrowserClient();
      const ext = file.name.split(".").pop() ?? "jpg";
      const prefix = pathPrefix ? `${pathPrefix}-` : "";
      const path = `${businessId}/${prefix}${crypto.randomUUID()}.${ext}`;
      const { error } = await supabase.storage
        .from(bucket)
        .upload(path, file, { cacheControl: "3600", upsert: false });
      if (error) {
        console.error(error);
        toast.error("No pudimos subir la imagen.");
        return;
      }
      if (returnPath) {
        setLocalPreview((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          return URL.createObjectURL(file);
        });
        onChange(path);
      } else {
        const { data } = supabase.storage.from(bucket).getPublicUrl(path);
        onChange(data.publicUrl);
      }
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const isCover = variant === "cover";
  const stacked = layout === "stacked" || isCover;
  const previewClass = isCover
    ? "relative aspect-[16/9] w-full overflow-hidden rounded-xl bg-muted"
    : stacked
      ? `bg-muted relative mx-auto aspect-square w-full max-w-[160px] overflow-hidden ${variant === "avatar-circle" ? "rounded-full" : "rounded-xl"}`
      : `bg-muted relative size-24 shrink-0 overflow-hidden ${variant === "avatar-circle" ? "rounded-full" : "rounded-lg"}`;
  const sizes = isCover ? "(max-width: 768px) 100vw, 520px" : "160px";
  const wrapperClass = stacked
    ? "flex flex-col gap-3"
    : "flex items-center gap-4";
  const buttonsClass = stacked
    ? "flex items-center justify-center gap-2"
    : "flex flex-col gap-2";

  return (
    <div className={wrapperClass}>
      <div className={previewClass}>
        {value && !returnPath ? (
          <Image
            src={value}
            alt="Imagen"
            fill
            sizes={sizes}
            className="object-cover"
          />
        ) : value && returnPath && localPreview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={localPreview}
            alt="Comprobante recién subido"
            className="size-full object-cover"
          />
        ) : value && returnPath ? (
          <div className="text-muted-foreground flex size-full flex-col items-center justify-center gap-1">
            <ImageIcon className={isCover ? "size-8" : "size-6"} />
            <span className="text-[10px] font-medium">Cargada</span>
          </div>
        ) : (
          <div className="text-muted-foreground flex size-full items-center justify-center">
            <ImagePlus className={isCover ? "size-8" : "size-6"} />
          </div>
        )}
      </div>
      <div className={isCover ? "flex items-center gap-2" : buttonsClass}>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
          }}
        />
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={uploading}
          onClick={() => inputRef.current?.click()}
        >
          {uploading ? "Subiendo…" : value ? "Cambiar" : "Subir imagen"}
        </Button>
        {value && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => onChange(null)}
            disabled={uploading}
          >
            <Trash2 className="size-3" />
            Quitar
          </Button>
        )}
      </div>
    </div>
  );
}
