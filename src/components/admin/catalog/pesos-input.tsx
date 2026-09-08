"use client";

import { useState } from "react";
import type { Control, FieldPath, FieldValues } from "react-hook-form";

import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { formatPesosInput, parsePesos } from "@/lib/catalog/money-input";

/**
 * El campo de plata del catálogo (P14 · hallazgo 3).
 *
 * Antes era un `<input type="number">` con `parseInt(e.target.value) || 0`.
 * Dos formas de perder plata, las dos calladas: pegando «18.500» el parseInt
 * cortaba en el punto y guardaba $18; tipeándolo, el navegador devuelve ""
 * mientras el número está incompleto y el `|| 0` lo mandaba a $0. Y como el
 * input era controlado por react-hook-form, la caja se reescribía sola: el
 * dueño veía «18» donde había tecleado «18.500».
 *
 * Ahora el input es de TEXTO y guarda lo tipeado tal cual; el número sale de
 * `parsePesos`, que sabe leer los separadores como se escriben acá. Lo que no
 * se puede leer sin adivinar no se guarda: manda NaN al formulario para que el
 * zod frene el submit, y muestra el motivo debajo del campo.
 *
 * Se pierden dos comodidades del `type="number"`: las flechitas de spinner y el
 * teclado numérico puro del celular (queda `inputMode="decimal"`, que en iOS y
 * Android abre el teclado con separadores — que es justo lo que hace falta).
 */
export function PesosInput({
  valueCents,
  onChangeCents,
  onErrorChange,
  ...rest
}: {
  /** Valor guardado, en CENTAVOS. */
  valueCents: number;
  /** Devuelve centavos, o NaN si lo tipeado no es un importe. */
  onChangeCents: (cents: number) => void;
  onErrorChange?: (error: string | null) => void;
} & Omit<
  React.ComponentProps<typeof Input>,
  "value" | "onChange" | "type" | "defaultValue"
>) {
  // El texto crudo es el estado que manda mientras se edita. Se siembra una
  // sola vez con el valor de la base, ya formateado («10.000»): así lo que el
  // campo muestra es exactamente lo que el parser sabe releer.
  const [raw, setRaw] = useState(() =>
    Number.isFinite(valueCents) ? formatPesosInput(valueCents) : "",
  );
  const [error, setError] = useState<string | null>(null);

  return (
    <Input
      type="text"
      inputMode="decimal"
      autoComplete="off"
      aria-invalid={error ? true : undefined}
      {...rest}
      value={raw}
      onChange={(e) => {
        const next = e.target.value;
        setRaw(next);
        const parsed = parsePesos(next);
        const msg = parsed.ok ? null : parsed.error;
        setError(msg);
        onErrorChange?.(msg);
        onChangeCents(parsed.ok ? parsed.cents : Number.NaN);
      }}
    />
  );
}

/**
 * El campo completo (label + input + el motivo del rechazo). El mensaje se
 * renderiza acá y no con `<FormMessage />` a propósito: el zod sólo sabe decir
 * «se esperaba un número», y el que tipeó «18.5001» necesita que le digan qué
 * tiene de malo.
 */
export function PrecioField<T extends FieldValues>({
  control,
  name,
  label,
  hint,
  className,
  prefix,
  inputProps,
}: {
  control: Control<T>;
  name: FieldPath<T>;
  label?: string;
  hint?: React.ReactNode;
  className?: string;
  /** Adorno pegado al campo (ej: «+$» en el adicional). Sólo decorativo. */
  prefix?: string;
  inputProps?: Omit<
    React.ComponentProps<typeof Input>,
    "value" | "onChange" | "type" | "defaultValue"
  >;
}) {
  const [error, setError] = useState<string | null>(null);

  return (
    <FormField
      control={control}
      name={name}
      render={({ field, fieldState }) => {
        const input = (
          <PesosInput
            valueCents={field.value as number}
            onChangeCents={field.onChange}
            onErrorChange={setError}
            onBlur={field.onBlur}
            {...inputProps}
            className={prefix ? "pl-8" : inputProps?.className}
          />
        );

        return (
          <FormItem className={className}>
            {label && <FormLabel>{label}</FormLabel>}
            {/*
            Sin adorno el input va directo adentro de FormControl: es un Slot y
            le pasa el `id` a su hijo, así que meter un div en el medio rompería
            el vínculo con el label (y con quien lo busca por su nombre).
          */}
            <FormControl>
              {prefix ? (
                <div className="relative">
                  <span
                    aria-hidden
                    className="text-muted-foreground pointer-events-none absolute inset-y-0 left-2.5 flex items-center text-sm font-medium"
                  >
                    {prefix}
                  </span>
                  {input}
                </div>
              ) : (
                input
              )}
            </FormControl>
            {/*
            Nuestro mensaje gana; si no hay, cae el del zod. El del zod importa
            en el alta: el campo arranca VACÍO a propósito (un producto nuevo
            sin precio guardaba $0 sin decir nada), así que el submit sin tocar
            el campo tiene que explicar por qué no guardó.
          */}
            {(error ?? fieldState.error?.message) ? (
              <p className="text-destructive text-xs">
                {error ?? fieldState.error?.message}
              </p>
            ) : (
              hint
            )}
          </FormItem>
        );
      }}
    />
  );
}
