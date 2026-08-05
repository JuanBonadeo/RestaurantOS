import { z } from "zod";

export const DailyMenuComponentInput = z
  .object({
    id: z.string().uuid().optional(),
    label: z.string().min(1, "Requerido.").max(120),
    description: z.string().max(280).optional().nullable(),
    kind: z.enum(["text", "product", "choice"]),
    product_id: z.string().uuid().optional().nullable(),
    choice_group_id: z.string().uuid().optional().nullable(),
    choice_group_label: z.string().max(80).optional().nullable(),
    // Adicional de la opción (spec 29). Sólo aplica a `choice`; pesos→centavos
    // en el form. Nunca negativo (también `check` en DB). Opcional —no
    // `.default()`— para no divergir input/output de Zod y romper la inferencia
    // de react-hook-form; el default 0 lo aplica la columna DB y los consumidores.
    extra_price_cents: z.number().int().min(0).optional(),
    // Grupos que esta opción NO habilita (spec 074). Sólo aplica a `choice`.
    // La regla de "sólo hacia adelante" no se puede validar acá —es una regla
    // entre componentes—, va en el `superRefine` de `DailyMenuInput`.
    blocks_choice_group_ids: z.array(z.string().uuid()).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.kind === "product" && !data.product_id) {
      ctx.addIssue({
        code: "custom",
        message: "Seleccioná un producto.",
        path: ["product_id"],
      });
    }
    if (data.kind === "choice") {
      if (!data.product_id) {
        ctx.addIssue({
          code: "custom",
          message: "Seleccioná un producto.",
          path: ["product_id"],
        });
      }
      if (!data.choice_group_id) {
        ctx.addIssue({
          code: "custom",
          message: "Falta el grupo de opciones.",
          path: ["choice_group_id"],
        });
      }
    }
  });
export type DailyMenuComponentInput = z.infer<typeof DailyMenuComponentInput>;

export const DisplayContext = z.enum(["delivery", "salon", "both"]);
export type DisplayContext = z.infer<typeof DisplayContext>;

/**
 * Un grupo de opciones (spec 087). Antes no existía como dato: el nombre se
 * repetía en cada opción y la condición vivía en la opción, en negativo. Ahora
 * el grupo se manda entero y una sola vez.
 */
export const DailyMenuChoiceGroupInput = z.object({
  id: z.string().uuid(),
  name: z.string().min(1, "Poné un nombre al grupo.").max(80),
  /** NULL = el grupo aplica siempre. */
  applies_when_group_id: z.string().uuid().nullable().optional(),
  /** Las opciones (por producto) del grupo fuente que habilitan a éste. */
  applies_when_product_ids: z.array(z.string().uuid()).optional(),
});
export type DailyMenuChoiceGroupInput = z.infer<typeof DailyMenuChoiceGroupInput>;

export const DailyMenuInput = z.object({
  name: z.string().min(1, "Requerido.").max(80),
  slug: z
    .string()
    .min(1)
    .max(80)
    .regex(/^[a-z0-9-]+$/, "Sólo minúsculas, números y guiones."),
  description: z.string().max(500).optional().nullable(),
  price_cents: z.number().int().min(0),
  image_url: z.string().url().nullable().optional(),
  available_days: z
    .array(z.number().int().min(0).max(6))
    .min(1, "Elegí al menos un día."),
  is_active: z.boolean(),
  is_available: z.boolean(),
  sort_order: z.number().int().min(0),
  display_context: DisplayContext,
  is_suggestion: z.boolean(),
  components: z
    .array(DailyMenuComponentInput)
    .min(1, "Agregá al menos un componente."),
  /** Los grupos de opciones del menú (spec 087). */
  choice_groups: z.array(DailyMenuChoiceGroupInput).optional(),
}).superRefine((data, ctx) => {
  // Un grupo sólo puede condicionarse desde un grupo ANTERIOR: si «Guarnición»
  // se decide antes que «Principal», el mozo ya la eligió cuando llegaría la
  // regla. Sobrevive de D-GCM-3, pero ahora es UNA condición por grupo en vez
  // de N por opción, y el editor sólo ofrece grupos anteriores — esto es la red.
  const posicion = new Map<string, number>();
  data.components.forEach((c, idx) => {
    if (c.kind !== "choice" || !c.choice_group_id) return;
    if (!posicion.has(c.choice_group_id)) posicion.set(c.choice_group_id, idx);
  });

  const nombre = new Map(
    (data.choice_groups ?? []).map((g) => [g.id, g.name] as const),
  );

  (data.choice_groups ?? []).forEach((g, idx) => {
    const fuente = g.applies_when_group_id;
    if (!fuente) return;
    if (fuente === g.id) {
      ctx.addIssue({
        code: "custom",
        message: "Un grupo no puede depender de sí mismo.",
        path: ["choice_groups", idx, "applies_when_group_id"],
      });
      return;
    }
    const propia = posicion.get(g.id);
    const suya = posicion.get(fuente);
    // Un grupo que ya no existe no es un error del encargado: la action limpia
    // esas referencias al guardar.
    if (propia === undefined || suya === undefined) return;
    if (suya > propia) {
      ctx.addIssue({
        code: "custom",
        message: `"${nombre.get(fuente) ?? "Ese grupo"}" se decide después que "${g.name}" — movelo antes para poder condicionar con él.`,
        path: ["choice_groups", idx, "applies_when_group_id"],
      });
    }
  });
});
export type DailyMenuInput = z.infer<typeof DailyMenuInput>;
