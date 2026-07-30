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
}).superRefine((data, ctx) => {
  // FR-002 (spec 074) — una opción sólo puede condicionar un grupo POSTERIOR.
  // El `sort_order` que se persiste es la posición en el array (ver
  // `syncComponents`), así que el orden del array ES el orden de los grupos.
  // Si «Guarnición» va antes que «Principal», el mozo ya la eligió cuando
  // llegaría la regla: no hay forma de aplicarla.
  const groupPosition = new Map<string, number>();
  const groupLabel = new Map<string, string>();
  data.components.forEach((c, idx) => {
    if (c.kind !== "choice" || !c.choice_group_id) return;
    if (!groupPosition.has(c.choice_group_id)) {
      groupPosition.set(c.choice_group_id, idx);
      groupLabel.set(c.choice_group_id, c.choice_group_label || "Ese grupo");
    }
  });

  data.components.forEach((c, idx) => {
    if (c.kind !== "choice" || !c.choice_group_id) return;
    const ownPosition = groupPosition.get(c.choice_group_id) ?? idx;
    for (const blockedId of c.blocks_choice_group_ids ?? []) {
      if (blockedId === c.choice_group_id) {
        ctx.addIssue({
          code: "custom",
          message: "Un grupo no puede condicionarse a sí mismo.",
          path: ["components", idx, "blocks_choice_group_ids"],
        });
        continue;
      }
      const blockedPosition = groupPosition.get(blockedId);
      // Un grupo que ya no existe (lo borraron) no es un error del encargado:
      // `syncComponents` limpia esas referencias al guardar.
      if (blockedPosition === undefined) continue;
      if (blockedPosition < ownPosition) {
        ctx.addIssue({
          code: "custom",
          message: `"${groupLabel.get(blockedId)}" se decide antes que "${groupLabel.get(c.choice_group_id)}" — movelo después para poder condicionarlo.`,
          path: ["components", idx, "blocks_choice_group_ids"],
        });
      }
    }
  });
});
export type DailyMenuInput = z.infer<typeof DailyMenuInput>;
