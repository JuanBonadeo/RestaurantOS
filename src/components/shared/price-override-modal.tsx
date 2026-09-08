"use client";

import { RotateCcw, Tag } from "lucide-react";
import { useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatCurrency } from "@/lib/currency";
import { parsePesos } from "@/lib/catalog/money-input";

/**
 * Spec 069 — cambiar el precio de UNA línea, sólo para ese pedido, con motivo.
 *
 * No toca el servidor: devuelve el par (centavos, motivo) para que el carrito
 * lo guarde y viaje con el envío. La validación real (rol + motivo) la rehace
 * el server en `validatePriceOverride` — acá sólo evitamos que el encargado
 * llegue al botón con el formulario a medias.
 *
 * Mobile-first (principio 2): el precio entra por teclado numérico, en PESOS
 * como en el resto del admin, y se convierte a centavos al confirmar.
 */
export function PriceOverrideModal({
  productName,
  catalogPriceCents,
  currentOverrideCents,
  currentReason,
  onConfirm,
  onClear,
  onClose,
}: {
  productName: string;
  /** Precio de lista, para que el encargado vea contra qué está decidiendo. */
  catalogPriceCents: number;
  currentOverrideCents?: number | null;
  currentReason?: string | null;
  onConfirm: (cents: number, reason: string) => void;
  /** Volver al precio de catálogo. Sin motivo: no es un cambio, es deshacer. */
  onClear: () => void;
  onClose: () => void;
}) {
  const hasOverride = currentOverrideCents != null;
  const [pesos, setPesos] = useState(
    hasOverride ? String(currentOverrideCents / 100) : "",
  );
  const [motivo, setMotivo] = useState(currentReason ?? "");

  // issue #269 — el mismo parser que el resto de los campos de plata.
  //
  // Acá había `Number(pesos.replace(",", "."))`, que tiene dos agujeros y éste
  // es el campo donde más duelen, porque no fija un precio de carta: **cobra**
  // una línea de la mesa. «18.500» daba 18.5 → 1.850 centavos, o sea que la
  // línea se cobraba a $18,50 en vez de $18.500. Y el `replace` reemplaza sólo
  // la PRIMERA coma, así que «18.500,50» daba NaN.
  //
  // `parsePesos` centraliza el criterio: tres dígitos detrás del separador son
  // miles, uno o dos son centavos, y lo ambiguo se rechaza en vez de adivinar.
  const parsedPesos = parsePesos(pesos);
  const priceOk = parsedPesos.ok;
  const cents = parsedPesos.ok ? parsedPesos.cents : 0;
  const canConfirm = priceOk && motivo.trim() !== "";

  const delta = cents - catalogPriceCents;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cambiar el precio</DialogTitle>
        </DialogHeader>

        <p className="text-muted-foreground text-sm">
          <span className="text-foreground font-semibold">{productName}</span> —
          sólo para este pedido. El precio de la carta no se toca.
        </p>

        <div className="bg-muted/50 flex items-center justify-between rounded-lg px-3 py-2 text-sm">
          <span className="text-muted-foreground">Precio de la carta</span>
          <span className="font-semibold">
            {formatCurrency(catalogPriceCents)}
          </span>
        </div>

        <label className="block space-y-1.5">
          <span className="text-sm font-medium">Precio a cobrar ($)</span>
          <input
            type="number"
            inputMode="decimal"
            min={0}
            step="any"
            value={pesos}
            onChange={(e) => setPesos(e.target.value)}
            autoFocus
            placeholder="0"
            className="border-input bg-background focus-visible:ring-ring h-12 w-full rounded-lg border px-3 text-lg font-semibold outline-none focus-visible:ring-2"
          />
        </label>

        {priceOk && delta !== 0 && (
          <p
            className={`text-xs font-medium ${
              delta < 0 ? "text-amber-600" : "text-sky-600"
            }`}
          >
            {delta < 0
              ? `Se resigna ${formatCurrency(-delta)} respecto de la carta.`
              : `Se cobra ${formatCurrency(delta)} por encima de la carta.`}
          </p>
        )}

        <label className="block space-y-1.5">
          <span className="text-sm font-medium">Motivo</span>
          <textarea
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            rows={2}
            placeholder="Ej: cortesía por demora, plato fuera de carta, media porción"
            className="border-input bg-background focus-visible:ring-ring w-full rounded-lg border px-3 py-2 text-sm outline-none focus-visible:ring-2"
          />
          <span className="text-muted-foreground block text-xs">
            Queda registrado con tu nombre en el reporte de precios modificados.
          </span>
        </label>

        <DialogFooter className="gap-2 sm:justify-between">
          {hasOverride ? (
            <button
              type="button"
              onClick={onClear}
              className="text-muted-foreground ring-border/70 hover:bg-muted/60 inline-flex h-9 items-center justify-center gap-1.5 rounded-lg px-3 text-sm font-semibold ring-1 transition"
            >
              <RotateCcw className="size-4" strokeWidth={2.5} />
              Volver al precio de la carta
            </button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="text-muted-foreground ring-border/70 hover:bg-muted/60 inline-flex h-9 items-center justify-center rounded-lg px-4 text-sm font-semibold ring-1 transition"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={() => onConfirm(cents, motivo.trim())}
              disabled={!canConfirm}
              className="bg-primary text-primary-foreground hover:bg-primary/90 inline-flex h-9 items-center justify-center gap-1.5 rounded-lg px-4 text-sm font-semibold transition disabled:opacity-50"
            >
              <Tag className="size-4" strokeWidth={2.5} />
              Aplicar
            </button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
