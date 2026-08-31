"use client";

import * as React from "react";

import { maskTime24, normalizeTime24 } from "@/lib/hora-24";
import { cn } from "@/lib/utils";

/**
 * Campo de hora en 24 h (spec 133).
 *
 * Reemplaza a `<input type="time">`, que saca el formato del locale del
 * navegador —no del `lang` de la página— y en una máquina en inglés le muestra
 * al encargado «06:00 PM» donde el resto del sistema dice «18:00».
 *
 * Se escriben los cuatro dígitos y los dos puntos los pone el campo: `2130` →
 * `21:30`. Hacia afuera el valor es siempre `HH:MM` (o `""` mientras está
 * incompleto), igual que el input nativo, así los formularios que ya guardaban
 * "HH:MM" no cambian.
 */
export function TimeField24({
  value,
  onChange,
  className,
  ...props
}: {
  /** `HH:MM` o `""`. */
  value: string;
  /** Recibe `HH:MM` cuando la hora está completa, `""` mientras no. */
  onChange: (value: string) => void;
} & Omit<
  React.ComponentProps<"input">,
  "value" | "onChange" | "type" | "inputMode"
>) {
  // Lo que se ve mientras se tipea. Puede ser un estado intermedio («21:»)
  // que todavía no es una hora, y por eso no vive en el form del padre.
  const [text, setText] = React.useState(value);
  const [focused, setFocused] = React.useState(false);

  // Si el valor cambia desde afuera (abrir el panel de edición con otra
  // reserva, resetear el formulario) el campo lo sigue — salvo mientras se
  // está escribiendo, que sería pisarle la mano al usuario.
  React.useEffect(() => {
    if (!focused) setText(value);
  }, [value, focused]);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const raw = e.target.value;
    const deleting = raw.length < text.length;
    const masked = maskTime24(raw, deleting);
    setText(masked);
    const normalized = normalizeTime24(masked);
    // Vacío también se propaga: borrar la hora es una acción válida.
    if (normalized !== value) onChange(normalized ?? "");
  }

  function handleBlur(e: React.FocusEvent<HTMLInputElement>) {
    setFocused(false);
    const normalized = normalizeTime24(text);
    if (normalized) {
      setText(normalized);
      if (normalized !== value) onChange(normalized);
      return;
    }
    // Incompleto o imposible: vuelve a lo último que sí era una hora.
    setText(value);
    props.onBlur?.(e);
  }

  return (
    <input
      {...props}
      type="text"
      inputMode="numeric"
      autoComplete="off"
      maxLength={5}
      placeholder={props.placeholder ?? "HH:MM"}
      value={text}
      onChange={handleChange}
      onFocus={(e) => {
        setFocused(true);
        props.onFocus?.(e);
      }}
      onBlur={handleBlur}
      className={cn("tabular-nums", className)}
    />
  );
}
