"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm, useFieldArray, useFormContext } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, Trash2, GripVertical } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ImageUploader } from "@/components/admin/catalog/image-uploader";
import { ProductPicker } from "@/components/admin/daily-menus/product-picker";
import type { AdminDailyMenu } from "@/lib/admin/daily-menu-query";
import {
  createDailyMenu,
  updateDailyMenu,
} from "@/lib/daily-menus/daily-menu-actions";
import { DailyMenuInput } from "@/lib/daily-menus/schemas";

// Orden L..D para que la lectura sea natural (empezar por Lunes).
const DAY_OPTIONS: { dow: number; label: string }[] = [
  { dow: 1, label: "Lun" },
  { dow: 2, label: "Mar" },
  { dow: 3, label: "Mié" },
  { dow: 4, label: "Jue" },
  { dow: 5, label: "Vie" },
  { dow: 6, label: "Sáb" },
  { dow: 0, label: "Dom" },
];

export function DailyMenuForm({
  slug,
  businessId,
  menu,
}: {
  slug: string;
  businessId: string;
  menu?: AdminDailyMenu;
}) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);

  const [productNames] = useState(() => {
    const map = new Map<string, string>();
    if (menu) {
      for (const c of menu.components) {
        if (c.product_id && c.product_name) {
          map.set(c.product_id, c.product_name);
        }
      }
    }
    return map;
  });

  const form = useForm<DailyMenuInput>({
    resolver: zodResolver(DailyMenuInput),
    defaultValues: menu
      ? {
          name: menu.name,
          slug: menu.slug,
          description: menu.description ?? undefined,
          price_cents: menu.price_cents / 100,
          image_url: menu.image_url,
          available_days: menu.available_days,
          is_active: menu.is_active,
          is_available: menu.is_available,
          sort_order: menu.sort_order,
          display_context: menu.display_context,
          is_suggestion: menu.is_suggestion,
          components: menu.components.map((c) => ({
            id: c.id,
            label: c.label,
            description: c.description ?? undefined,
            kind: c.kind ?? "text",
            product_id: c.product_id,
            choice_group_id: c.choice_group_id,
            choice_group_label: c.choice_group_label,
            // Centavos en datos → pesos en el form (igual que price_cents).
            extra_price_cents: (c.extra_price_cents ?? 0) / 100,
            blocks_choice_group_ids: c.blocks_choice_group_ids ?? [],
          })),
        }
      : {
          name: "",
          slug: "",
          price_cents: 0,
          available_days: [1, 2, 3, 4, 5],
          is_active: true,
          is_available: true,
          sort_order: 0,
          display_context: "both" as const,
          is_suggestion: false,
          components: [{ label: "", kind: "text" as const }],
        },
  });

  const onSubmit = async (values: DailyMenuInput) => {
    setSubmitting(true);
    try {
      // El input de precio está en unidades de $, persistimos en cents. Ídem
      // el adicional por opción (spec 29): pesos en el form, centavos en datos.
      const payload: DailyMenuInput = {
        ...values,
        price_cents: Math.round(values.price_cents * 100),
        components: values.components.map((c) => ({
          ...c,
          extra_price_cents: Math.round((c.extra_price_cents ?? 0) * 100),
        })),
      };
      const result = menu
        ? await updateDailyMenu(slug, menu.id, payload)
        : await createDailyMenu(slug, payload);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(menu ? "Actualizado." : "Creado.");
      router.push(`/${slug}/admin/menu-del-dia`);
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        <FormField
          control={form.control}
          name="image_url"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Imagen</FormLabel>
              <FormControl>
                <ImageUploader
                  businessId={businessId}
                  value={field.value ?? null}
                  onChange={(url) => field.onChange(url)}
                  pathPrefix="daily-menu"
                />
              </FormControl>
            </FormItem>
          )}
        />

        <div className="grid grid-cols-2 gap-3">
          <FormField
            control={form.control}
            name="name"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Nombre</FormLabel>
                <FormControl>
                  <Input placeholder="Menú Ejecutivo" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="slug"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Slug</FormLabel>
                <FormControl>
                  <Input placeholder="menu-ejecutivo" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <FormField
          control={form.control}
          name="description"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Descripción (opcional)</FormLabel>
              <FormControl>
                <Textarea
                  rows={3}
                  placeholder="Texto breve que ve el cliente al abrir el menú."
                  {...field}
                  value={field.value ?? ""}
                />
              </FormControl>
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="price_cents"
          render={({ field }) => (
            <FormItem className="max-w-[200px]">
              <FormLabel>Precio ($)</FormLabel>
              <FormControl>
                <Input
                  type="number"
                  min={0}
                  {...field}
                  onChange={(e) => field.onChange(parseInt(e.target.value) || 0)}
                />
              </FormControl>
              <p className="text-muted-foreground text-xs">
                Precio único del combo. No se suman adicionales.
              </p>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="available_days"
          render={({ field }) => {
            const selected = new Set(field.value);
            const toggle = (dow: number) => {
              const next = new Set(selected);
              if (next.has(dow)) next.delete(dow);
              else next.add(dow);
              field.onChange([...next].sort((a, b) => a - b));
            };
            return (
              <FormItem>
                <FormLabel>Días disponibles</FormLabel>
                <FormControl>
                  <div className="flex flex-wrap gap-2">
                    {DAY_OPTIONS.map((d) => {
                      const on = selected.has(d.dow);
                      return (
                        <button
                          key={d.dow}
                          type="button"
                          onClick={() => toggle(d.dow)}
                          className={
                            on
                              ? "rounded-full border border-primary bg-primary px-3 py-1 text-sm font-semibold text-primary-foreground transition-colors"
                              : "border-border hover:bg-muted rounded-full border px-3 py-1 text-sm font-medium transition-colors"
                          }
                        >
                          {d.label}
                        </button>
                      );
                    })}
                  </div>
                </FormControl>
                <p className="text-muted-foreground text-xs">
                  El menú solo va a aparecer en el catálogo esos días.
                </p>
                <FormMessage />
              </FormItem>
            );
          }}
        />

        <div className="flex flex-wrap gap-4">
          <FormField
            control={form.control}
            name="is_available"
            render={({ field }) => (
              <FormItem>
                <FormControl>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      className="size-4"
                      checked={field.value}
                      onChange={(e) => field.onChange(e.target.checked)}
                    />
                    <span>Disponible ahora</span>
                  </label>
                </FormControl>
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="is_active"
            render={({ field }) => (
              <FormItem>
                <FormControl>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      className="size-4"
                      checked={field.value}
                      onChange={(e) => field.onChange(e.target.checked)}
                    />
                    <span>Activo (publicado)</span>
                  </label>
                </FormControl>
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="is_suggestion"
            render={({ field }) => (
              <FormItem>
                <FormControl>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      className="size-4"
                      checked={field.value}
                      onChange={(e) => field.onChange(e.target.checked)}
                    />
                    <span>Sugerencia del día</span>
                  </label>
                </FormControl>
              </FormItem>
            )}
          />
        </div>

        <FormField
          control={form.control}
          name="display_context"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Visible en</FormLabel>
              <FormControl>
                <select
                  value={field.value}
                  onChange={(e) => field.onChange(e.target.value)}
                  className="border-input bg-background h-9 rounded-md border px-3 text-sm"
                >
                  <option value="both">Delivery y salón</option>
                  <option value="delivery">Solo delivery</option>
                  <option value="salon">Solo salón</option>
                </select>
              </FormControl>
              <p className="text-muted-foreground text-xs">
                En qué superficie se muestra este menú.
              </p>
            </FormItem>
          )}
        />

        <ComponentsEditor businessId={businessId} productNames={productNames} />

        <div className="flex gap-2">
          <Button type="submit" disabled={submitting}>
            {submitting ? "Guardando…" : menu ? "Guardar" : "Crear"}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => router.back()}
          >
            Cancelar
          </Button>
        </div>
      </form>
    </Form>
  );
}

const KIND_OPTIONS = [
  { value: "text", label: "Texto" },
  { value: "product", label: "Producto fijo" },
  { value: "choice", label: "Elegir una de:" },
] as const;

function ComponentsEditor({
  businessId,
  productNames,
}: {
  businessId: string;
  productNames: Map<string, string>;
}) {
  const { control, watch, setValue } = useFormContext<DailyMenuInput>();
  const { fields, append, remove } = useFieldArray({
    control,
    name: "components",
  });
  const components = watch("components");

  const choiceGroups = new Map<string, number[]>();
  components.forEach((c, idx) => {
    if (c.kind === "choice" && c.choice_group_id) {
      const arr = choiceGroups.get(c.choice_group_id) ?? [];
      arr.push(idx);
      choiceGroups.set(c.choice_group_id, arr);
    }
  });

  // Grupos en el orden en que se van a decidir (spec 074). La posición de un
  // grupo es la de su primera opción, porque `sort_order` se persiste como el
  // índice en este array (ver `syncComponents`).
  const orderedGroups = [...choiceGroups.entries()]
    .map(([id, idxs]) => ({
      id,
      firstIndex: Math.min(...idxs),
      label: components[idxs[0]]?.choice_group_label ?? "",
    }))
    .sort((a, b) => a.firstIndex - b.firstIndex);

  const addChoiceOption = (groupId: string, groupLabel: string) => {
    append({
      label: "",
      kind: "choice",
      choice_group_id: groupId,
      choice_group_label: groupLabel,
      extra_price_cents: 0,
      blocks_choice_group_ids: [],
    });
  };

  const rendered = new Set<string>();

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold">Componentes del menú</h3>
          <p className="text-muted-foreground mt-0.5 text-xs">
            Lo que incluye el combo. Cada componente puede ser texto, un
            producto fijo, o un grupo de opciones donde el cliente elige.
          </p>
        </div>
        <div className="flex gap-1.5">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => append({ label: "", kind: "text", extra_price_cents: 0 })}
          >
            <Plus className="size-3.5" /> Componente
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => {
              const groupId = crypto.randomUUID();
              append({
                label: "",
                kind: "choice",
                choice_group_id: groupId,
                choice_group_label: "",
                extra_price_cents: 0,
                blocks_choice_group_ids: [],
              });
            }}
          >
            <Plus className="size-3.5" /> Grupo de opciones
          </Button>
        </div>
      </div>

      <div className="space-y-3">
        {fields.map((field, idx) => {
          const kind = components[idx]?.kind ?? "text";
          const groupId = components[idx]?.choice_group_id;

          if (kind === "choice" && groupId) {
            if (rendered.has(groupId)) return null;
            rendered.add(groupId);
            const groupIndices = choiceGroups.get(groupId) ?? [idx];
            const groupLabel = components[groupIndices[0]]?.choice_group_label ?? "";

            return (
              <ChoiceGroupCard
                key={groupId}
                businessId={businessId}
                groupId={groupId}
                groupLabel={groupLabel}
                indices={groupIndices}
                // Sólo los grupos POSTERIORES se pueden condicionar (FR-002):
                // uno anterior ya está decidido cuando llegaría la regla.
                laterGroups={orderedGroups.filter(
                  (g) => g.firstIndex > Math.min(...groupIndices),
                )}
                control={control}
                productNames={productNames}
                onLabelChange={(label) => {
                  for (const i of groupIndices) {
                    setValue(`components.${i}.choice_group_label`, label);
                  }
                }}
                onAddOption={() => addChoiceOption(groupId, groupLabel)}
                onRemoveOption={(i) => remove(i)}
              />
            );
          }

          return (
            <SingleComponentCard
              key={field.id}
              idx={idx}
              kind={kind}
              businessId={businessId}
              control={control}
              productNames={productNames}
              onKindChange={(newKind) => {
                setValue(`components.${idx}.kind`, newKind);
                if (newKind === "text") {
                  setValue(`components.${idx}.product_id`, null);
                  setValue(`components.${idx}.choice_group_id`, null);
                  setValue(`components.${idx}.choice_group_label`, null);
                }
              }}
              onRemove={() => remove(idx)}
            />
          );
        })}
      </div>
    </section>
  );
}

function SingleComponentCard({
  idx,
  kind,
  businessId,
  control,
  productNames,
  onKindChange,
  onRemove,
}: {
  idx: number;
  kind: string;
  businessId: string;
  control: ReturnType<typeof useFormContext<DailyMenuInput>>["control"];
  productNames: Map<string, string>;
  onKindChange: (kind: "text" | "product") => void;
  onRemove: () => void;
}) {
  const { watch, setValue } = useFormContext<DailyMenuInput>();
  const productId = watch(`components.${idx}.product_id`);

  return (
    <div className="bg-card space-y-2 rounded-xl border p-3">
      <div className="flex items-start gap-2">
        <select
          value={kind === "choice" ? "text" : kind}
          onChange={(e) => onKindChange(e.target.value as "text" | "product")}
          className="border-input bg-background h-9 rounded-md border px-2 text-sm"
        >
          <option value="text">Texto</option>
          <option value="product">Producto fijo</option>
        </select>
        <FormField
          control={control}
          name={`components.${idx}.label`}
          render={({ field }) => (
            <FormItem className="flex-1">
              <FormControl>
                <Input
                  placeholder={
                    kind === "product"
                      ? "Ej: Principal"
                      : "Milanesa con puré"
                  }
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          onClick={onRemove}
          aria-label="Eliminar componente"
        >
          <Trash2 className="size-3.5" />
        </Button>
      </div>

      {kind === "product" && (
        <ProductPicker
          businessId={businessId}
          value={
            productId
              ? {
                  id: productId,
                  name: productNames.get(productId) ?? productId,
                  image_url: null,
                }
              : null
          }
          onChange={(p) => {
            setValue(`components.${idx}.product_id`, p?.id ?? null);
            if (p) productNames.set(p.id, p.name);
          }}
        />
      )}

      {kind === "text" && (
        <FormField
          control={control}
          name={`components.${idx}.description`}
          render={({ field }) => (
            <FormItem>
              <Label className="text-muted-foreground text-[0.65rem] font-medium uppercase tracking-wider">
                Detalle (opcional)
              </Label>
              <FormControl>
                <Input
                  placeholder="200g, con crema de papas"
                  {...field}
                  value={field.value ?? ""}
                />
              </FormControl>
            </FormItem>
          )}
        />
      )}
    </div>
  );
}

function ChoiceGroupCard({
  businessId,
  groupId,
  groupLabel,
  indices,
  laterGroups,
  control,
  productNames,
  onLabelChange,
  onAddOption,
  onRemoveOption,
}: {
  businessId: string;
  groupId: string;
  groupLabel: string;
  indices: number[];
  /** Grupos que se deciden DESPUÉS de éste: los únicos condicionables (FR-002). */
  laterGroups: { id: string; label: string }[];
  control: ReturnType<typeof useFormContext<DailyMenuInput>>["control"];
  productNames: Map<string, string>;
  onLabelChange: (label: string) => void;
  onAddOption: () => void;
  onRemoveOption: (idx: number) => void;
}) {
  const { watch, setValue } = useFormContext<DailyMenuInput>();

  /** Tildado = ese grupo aplica. Destildar lo agrega a los bloqueados. */
  const toggleBlocked = (idx: number, blockedId: string, lleva: boolean) => {
    const current = watch(`components.${idx}.blocks_choice_group_ids`) ?? [];
    setValue(
      `components.${idx}.blocks_choice_group_ids`,
      lleva
        ? current.filter((id) => id !== blockedId)
        : [...current, blockedId],
      { shouldDirty: true },
    );
  };

  // T9 · un grupo que TODAS las opciones de éste condicionan nunca va a
  // aparecer. No es un dato inválido —puede ser transitorio mientras se carga—
  // así que se avisa, no se bloquea. Mismo criterio que `warnGarnishModifierGroups`.
  const alwaysBlocked = laterGroups.filter((g) =>
    indices.every((idx) =>
      (watch(`components.${idx}.blocks_choice_group_ids`) ?? []).includes(g.id),
    ),
  );

  return (
    <div className="bg-card space-y-3 rounded-xl border-2 border-dashed border-amber-300 p-3">
      <div className="flex items-center gap-2">
        <span className="bg-amber-100 text-amber-800 rounded px-2 py-0.5 text-[0.65rem] font-bold uppercase tracking-wider">
          Elegir una
        </span>
        <Input
          placeholder="Ej: Bebida"
          value={groupLabel}
          onChange={(e) => onLabelChange(e.target.value)}
          className="flex-1"
        />
      </div>

      <div className="space-y-2 pl-3">
        {indices.map((idx) => {
          const productId = watch(`components.${idx}.product_id`);
          const blocked = watch(`components.${idx}.blocks_choice_group_ids`) ?? [];
          return (
            <div key={idx} className="space-y-1.5">
            <div className="flex items-center gap-2">
              <GripVertical className="text-muted-foreground size-3.5 shrink-0" />
              <div className="flex-1">
                <ProductPicker
                  businessId={businessId}
                  value={
                    productId
                      ? {
                          id: productId,
                          name:
                            productNames.get(productId) ?? productId,
                          image_url: null,
                        }
                      : null
                  }
                  onChange={(p) => {
                    setValue(
                      `components.${idx}.product_id`,
                      p?.id ?? null,
                    );
                    if (p) {
                      setValue(`components.${idx}.label`, p.name);
                      productNames.set(p.id, p.name);
                    }
                  }}
                />
              </div>
              <FormField
                control={control}
                name={`components.${idx}.extra_price_cents`}
                render={({ field }) => (
                  <div className="flex shrink-0 items-center gap-1">
                    <span className="text-muted-foreground text-xs">+$</span>
                    <Input
                      type="number"
                      min={0}
                      inputMode="numeric"
                      placeholder="0"
                      aria-label="Adicional en pesos"
                      className="w-16"
                      value={field.value ?? 0}
                      onChange={(e) =>
                        field.onChange(parseInt(e.target.value) || 0)
                      }
                    />
                  </div>
                )}
              />
              {indices.length > 1 && (
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  onClick={() => onRemoveOption(idx)}
                  aria-label="Quitar opción"
                >
                  <Trash2 className="size-3.5" />
                </Button>
              )}
            </div>

            {/* Qué OTROS grupos habilita esta opción (spec 074). El rótulo sale
                del nombre que puso el encargado: acá no hay ninguna palabra de
                dominio hardcodeada, sirve igual para «Guarnición» que para
                «Postre» o «Bebida». */}
            {laterGroups.length > 0 && (
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pl-6">
                {laterGroups.map((g) => (
                  <label
                    key={g.id}
                    className="text-muted-foreground flex items-center gap-1.5 text-xs"
                  >
                    <input
                      type="checkbox"
                      className="size-3.5"
                      checked={!blocked.includes(g.id)}
                      onChange={(e) =>
                        toggleBlocked(idx, g.id, e.target.checked)
                      }
                    />
                    <span>Lleva {g.label || "(grupo sin nombre)"}</span>
                  </label>
                ))}
              </div>
            )}
            </div>
          );
        })}
      </div>

      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={onAddOption}
        className="ml-3"
      >
        <Plus className="size-3.5" /> Opción
      </Button>

      <p className="text-muted-foreground ml-3 text-xs">
        <span className="font-medium">+$</span> = adicional sobre el combo. Dejá
        0 si la opción va incluida; lo que cargues se suma al precio cuando el
        cliente la elige.
      </p>

      {laterGroups.length > 0 && (
        <p className="text-muted-foreground ml-3 text-xs">
          Destildá un grupo en una opción si esa opción <strong>no</strong> lo
          lleva — ej. los ravioles no llevan guarnición. Al elegirla, ese paso
          se saltea y no se cobra su adicional. Sólo se pueden condicionar los
          grupos que van más abajo: los de arriba ya están decididos.
        </p>
      )}

      {alwaysBlocked.length > 0 && (
        <p className="ml-3 text-xs text-amber-700">
          Ojo: <strong>{alwaysBlocked.map((g) => g.label || "sin nombre").join(", ")}</strong>{" "}
          {alwaysBlocked.length === 1 ? "quedó destildado" : "quedaron destildados"} en
          todas las opciones de este grupo, así que{" "}
          {alwaysBlocked.length === 1 ? "nunca va" : "nunca van"} a aparecer.
        </p>
      )}
    </div>
  );
}
