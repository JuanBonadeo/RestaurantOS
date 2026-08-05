"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm, useFormContext } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ChevronDown, ChevronUp, Plus, Trash2 } from "lucide-react";
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
import {
  addOption,
  moveCard,
  moveOption,
  normalize,
  pruneBlocks,
  removeGroup,
  toCards,
} from "@/lib/daily-menus/component-order";
import {
  DailyMenuInput,
  type DailyMenuComponentInput,
} from "@/lib/daily-menus/schemas";

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
          // `normalize` deja las opciones de cada grupo contiguas (spec 076,
          // FR-005). Los menús cargados antes pueden tenerlas intercaladas
          // —agregar una opción hacía `append` al final del menú—, y con el
          // array desordenado los índices de las tarjetas no coincidirían con
          // los del form. No cambia nada de lo que se ve: el agrupado siempre
          // fue por `choice_group_id`.
          components: normalize(
            menu.components.map((c) => ({
              id: c.id,
              label: c.label,
              description: c.description ?? undefined,
              kind: c.kind ?? "text",
              product_id: c.product_id,
              choice_group_id: c.choice_group_id,
              choice_group_label: c.choice_group_label,
              // Centavos en datos → pesos en el form (igual que price_cents).
              extra_price_cents: (c.extra_price_cents ?? 0) / 100,
            })),
          ),
          // El nombre y la condición del grupo salen de su fila, no de las
          // opciones (spec 087).
          choice_groups: menu.choice_groups.map((g) => ({
            id: g.id,
            name: g.name,
            applies_when_group_id: g.applies_when_group_id,
            applies_when_product_ids: g.applies_when_product_ids,
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
          choice_groups: [],
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

/** El nombre de un grupo/opción no es obligatorio: sin esto los avisos quedan
 *  con comillas vacías. */
const nombreODefault = (label: string) => label.trim() || "sin nombre";

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
  const { control, watch, setValue, getValues, reset } =
    useFormContext<DailyMenuInput>();
  const components = watch("components");

  // Tarjetas: un componente suelto, o un grupo de opciones entero. Es la unidad
  // que se mueve (spec 076). El array del form está normalizado —`defaultValues`
  // lo normaliza y todas las operaciones lo mantienen así—, con lo cual la
  // posición plana de cada tarjeta es la suma de los tamaños de las anteriores.
  const cards = toCards(components);
  const cardStart: number[] = [];
  let flatIndex = 0;
  for (const card of cards) {
    cardStart.push(flatIndex);
    flatIndex += card.kind === "single" ? 1 : card.options.length;
  }

  // Grupos en el orden en que se van a decidir, con sus opciones: es lo que
  // necesita el selector de condición de cada grupo (spec 087).
  const orderedGroups = cards.flatMap((card, cardIndex) =>
    card.kind === "group"
      ? [
          {
            id: card.groupId,
            label: card.label,
            cardIndex,
            options: card.options.flatMap((o) =>
              o.product_id ? [{ product_id: o.product_id, label: o.label }] : [],
            ),
          },
        ]
      : [],
  );

  const choiceGroups = watch("choice_groups") ?? [];
  const conditionOf = (groupId: string) => {
    const g = choiceGroups.find((x) => x.id === groupId);
    return {
      applies_when_group_id: g?.applies_when_group_id ?? null,
      applies_when_product_ids: g?.applies_when_product_ids ?? [],
    };
  };

  /** El nombre y la condición del grupo viven en `choice_groups`, una sola vez. */
  const setGroup = (
    groupId: string,
    patch: Partial<{
      name: string;
      applies_when_group_id: string | null;
      applies_when_product_ids: string[];
    }>,
  ) => {
    const actual = choiceGroups.find((g) => g.id === groupId);
    const siguiente = actual
      ? choiceGroups.map((g) => (g.id === groupId ? { ...g, ...patch } : g))
      : [
          ...choiceGroups,
          {
            id: groupId,
            name: "",
            applies_when_group_id: null,
            applies_when_product_ids: [],
            ...patch,
          },
        ];
    setValue("choice_groups", siguiente, { shouldDirty: true });
  };

  // Después de mover, el foco vuelve al botón equivalente de la nueva posición
  // (FR-007): bajar dos lugares es Enter, Enter. Se pide por id porque el
  // `replace` re-renderiza la lista entera.
  const pendingFocus = useRef<string | null>(null);
  useEffect(() => {
    const id = pendingFocus.current;
    if (!id) return;
    pendingFocus.current = null;
    // Sin `requestAnimationFrame`: el efecto corre después del commit, así que
    // el botón de la nueva posición ya está en el DOM.
    document.getElementById(id)?.focus();
  });

  /**
   * Único punto por donde pasan **todos** los cambios a la lista de componentes
   * —mover, agregar, borrar—. Hace dos cosas:
   *
   * 1. Limpia las reglas que quedaron inválidas (FR-004). Si no, una regla que
   *    mira hacia atrás queda **invisible** —los checks sólo dibujan los grupos
   *    posteriores— y el menú no se puede guardar nunca más.
   * 2. Escribe con `reset` en vez de con `replace` de `useFieldArray`.
   *
   * Lo segundo no es capricho: con `replace`, los `Controller` de cada campo
   * (el `+$` de la opción, el label del componente) **no se re-sincronizan** si
   * React no los remonta, y como las tarjetas conservan su posición en el DOM
   * los valores quedan pegados al índice viejo. Se veía feo y mentiroso: mover
   * la opción de arriba dejaba su `+$` en la que ocupó su lugar. Los errores de
   * validación quedaban igual de desfasados. `reset` reconstruye el estado del
   * form entero, así que valores y errores viajan con la tarjeta.
   */
  const applyComponents = (
    next: DailyMenuComponentInput[],
    focusId?: string,
  ) => {
    const { components: cleaned, dropped } = pruneBlocks(next);
    reset(
      { ...getValues(), components: cleaned },
      { keepDefaultValues: true },
    );
    for (const d of dropped) {
      // Los grupos pueden no tener nombre (el label no es obligatorio), y sin
      // el fallback el aviso quedaba «… ya no condiciona a «»: ahora  se
      // decide antes que …».
      const bloqueado = nombreODefault(d.blockedLabel);
      toast.warning(
        `«${nombreODefault(d.optionLabel)}» ya no condiciona a «${bloqueado}»: ahora ${bloqueado} se decide antes que ${nombreODefault(d.ownerLabel)}.`,
      );
    }
    if (focusId) pendingFocus.current = focusId;
  };

  /** Borrar un componente por su índice plano (una opción o una tarjeta suelta). */
  const removeAt = (idx: number) =>
    applyComponents(components.filter((_, i) => i !== idx));

  /** Mover una tarjeta. En los extremos el botón que se usó queda
   *  deshabilitado, así que el foco pasa al otro. */
  const moveCardTo = (from: number, to: number, dir: "up" | "down") => {
    const focusDir =
      to === 0 ? "down" : to === cards.length - 1 ? "up" : dir;
    applyComponents(moveCard(components, from, to), `card-${to}-${focusDir}`);
  };

  const moveOptionTo = (
    groupId: string,
    from: number,
    to: number,
    total: number,
    dir: "up" | "down",
  ) => {
    const focusDir = to === 0 ? "down" : to === total - 1 ? "up" : dir;
    applyComponents(
      moveOption(components, groupId, from, to),
      `opt-${groupId}-${to}-${focusDir}`,
    );
  };

  const addChoiceOption = (groupId: string, groupLabel: string) => {
    applyComponents(
      addOption(components, groupId, {
        label: "",
        kind: "choice",
        choice_group_id: groupId,
        choice_group_label: groupLabel,
        extra_price_cents: 0,
        blocks_choice_group_ids: [],
      }),
    );
  };

  const deleteGroup = (groupId: string, label: string, count: number) => {
    const ok = window.confirm(
      `¿Borrar el grupo «${nombreODefault(label)}» y ${
        count === 1 ? "su única opción" : `sus ${count} opciones`
      }?`,
    );
    if (!ok) return;
    applyComponents(removeGroup(components, groupId));
  };

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
            onClick={() =>
              applyComponents([
                ...components,
                { label: "", kind: "text", extra_price_cents: 0 },
              ])
            }
          >
            <Plus className="size-3.5" /> Componente
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() =>
              applyComponents([
                ...components,
                {
                  label: "",
                  kind: "choice",
                  choice_group_id: crypto.randomUUID(),
                  choice_group_label: "",
                  extra_price_cents: 0,
                  blocks_choice_group_ids: [],
                },
              ])
            }
          >
            <Plus className="size-3.5" /> Grupo de opciones
          </Button>
        </div>
      </div>

      <div className="space-y-3">
        {cards.map((card, cardIndex) => {
          const start = cardStart[cardIndex];
          // Sin nombre, la posición desambigua: dos componentes recién
          // agregados tienen los dos el label vacío y quedarían con el mismo
          // `aria-label`.
          const posicion = `${cardIndex + 1}º`;
          const move = (
            <CardMoveButtons
              id={`card-${cardIndex}`}
              label={
                card.kind === "group"
                  ? `el grupo ${card.label || `sin nombre (${posicion})`}`
                  : `el componente ${card.component.label || `sin nombre (${posicion})`}`
              }
              isFirst={cardIndex === 0}
              isLast={cardIndex === cards.length - 1}
              onUp={() => moveCardTo(cardIndex, cardIndex - 1, "up")}
              onDown={() => moveCardTo(cardIndex, cardIndex + 1, "down")}
            />
          );

          if (card.kind === "group") {
            const indices = card.options.map((_, i) => start + i);
            return (
              <ChoiceGroupCard
                key={card.groupId}
                businessId={businessId}
                groupId={card.groupId}
                groupLabel={card.label}
                indices={indices}
                moveButtons={move}
                // Un grupo sólo se puede condicionar desde uno ANTERIOR: uno
                // posterior todavía no se decidió cuando llegaría la regla.
                earlierGroups={orderedGroups.filter(
                  (g) => g.cardIndex < cardIndex,
                )}
                condition={conditionOf(card.groupId)}
                onConditionChange={(next) => setGroup(card.groupId, next)}
                control={control}
                productNames={productNames}
                onLabelChange={(label) => {
                  setGroup(card.groupId, { name: label });
                  // Se sigue escribiendo en las opciones mientras la columna
                  // exista; la fuente de verdad ya es `choice_groups`.
                  for (const i of indices) {
                    setValue(`components.${i}.choice_group_label`, label);
                  }
                }}
                onAddOption={() => addChoiceOption(card.groupId, card.label)}
                onRemoveOption={(i) => removeAt(i)}
                onMoveOption={(from, to, dir) =>
                  moveOptionTo(
                    card.groupId,
                    from,
                    to,
                    card.options.length,
                    dir,
                  )
                }
                onDeleteGroup={() =>
                  deleteGroup(card.groupId, card.label, card.options.length)
                }
              />
            );
          }

          return (
            <SingleComponentCard
              // La posición como key: sin estado local propio, reordenar mueve
              // el nodo en vez de remontarlo (y el `replace` cambia los ids de
              // `useFieldArray`, así que tampoco servirían de key estable).
              key={`card-${cardIndex}`}
              idx={start}
              kind={card.component.kind ?? "text"}
              businessId={businessId}
              control={control}
              productNames={productNames}
              moveButtons={move}
              onKindChange={(newKind) => {
                setValue(`components.${start}.kind`, newKind);
                if (newKind === "text") {
                  setValue(`components.${start}.product_id`, null);
                  setValue(`components.${start}.choice_group_id`, null);
                  setValue(`components.${start}.choice_group_label`, null);
                }
              }}
              onRemove={() => removeAt(start)}
            />
          );
        })}
      </div>
    </section>
  );
}

/**
 * ▲/▼ para reordenar (spec 076). Botones y no drag & drop: acá hay dos niveles
 * anidados —tarjetas y opciones dentro de un grupo— y esto se opera con el
 * teclado y con el dedo sin sensores extra. Los ids son por posición, que es lo
 * que permite devolver el foco después de mover (FR-007).
 */
function CardMoveButtons({
  id,
  label,
  isFirst,
  isLast,
  onUp,
  onDown,
}: {
  /** Prefijo del id: se le agrega `-up` / `-down`. */
  id: string;
  /** Qué se mueve, para el `aria-label`: "el grupo Guarnición". */
  label: string;
  isFirst: boolean;
  isLast: boolean;
  onUp: () => void;
  onDown: () => void;
}) {
  return (
    <div className="flex shrink-0 flex-col">
      <Button
        type="button"
        id={`${id}-up`}
        size="icon-sm"
        variant="ghost"
        className="h-5"
        disabled={isFirst}
        onClick={onUp}
        aria-label={`Subir ${label}`}
      >
        <ChevronUp className="size-3.5" />
      </Button>
      <Button
        type="button"
        id={`${id}-down`}
        size="icon-sm"
        variant="ghost"
        className="h-5"
        disabled={isLast}
        onClick={onDown}
        aria-label={`Bajar ${label}`}
      >
        <ChevronDown className="size-3.5" />
      </Button>
    </div>
  );
}

function SingleComponentCard({
  idx,
  kind,
  businessId,
  control,
  productNames,
  moveButtons,
  onKindChange,
  onRemove,
}: {
  idx: number;
  kind: string;
  businessId: string;
  control: ReturnType<typeof useFormContext<DailyMenuInput>>["control"];
  productNames: Map<string, string>;
  moveButtons: React.ReactNode;
  onKindChange: (kind: "text" | "product") => void;
  onRemove: () => void;
}) {
  const { watch, setValue } = useFormContext<DailyMenuInput>();
  const productId = watch(`components.${idx}.product_id`);

  return (
    <div className="bg-card space-y-2 rounded-xl border p-3">
      <div className="flex items-start gap-2">
        {moveButtons}
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
  earlierGroups,
  condition,
  onConditionChange,
  control,
  productNames,
  moveButtons,
  onLabelChange,
  onAddOption,
  onRemoveOption,
  onMoveOption,
  onDeleteGroup,
}: {
  businessId: string;
  groupId: string;
  groupLabel: string;
  indices: number[];
  /** Grupos que se deciden ANTES: los únicos que pueden condicionar a éste. */
  earlierGroups: {
    id: string;
    label: string;
    options: { product_id: string; label: string }[];
  }[];
  condition: {
    applies_when_group_id: string | null;
    applies_when_product_ids: string[];
  };
  onConditionChange: (next: {
    applies_when_group_id: string | null;
    applies_when_product_ids: string[];
  }) => void;
  control: ReturnType<typeof useFormContext<DailyMenuInput>>["control"];
  productNames: Map<string, string>;
  moveButtons: React.ReactNode;
  onLabelChange: (label: string) => void;
  onAddOption: () => void;
  onRemoveOption: (idx: number) => void;
  /** Mover una opción dentro del grupo: posiciones relativas al grupo. */
  onMoveOption: (from: number, to: number, dir: "up" | "down") => void;
  onDeleteGroup: () => void;
}) {
  const { watch, setValue } = useFormContext<DailyMenuInput>();

  return (
    <div className="bg-card space-y-3 rounded-xl border-2 border-dashed border-amber-300 p-3">
      <div className="flex items-center gap-2">
        {moveButtons}
        <span className="bg-amber-100 text-amber-800 rounded px-2 py-0.5 text-[0.65rem] font-bold uppercase tracking-wider">
          Elegir una
        </span>
        <Input
          placeholder="Ej: Bebida"
          value={groupLabel}
          onChange={(e) => onLabelChange(e.target.value)}
          className="flex-1"
        />
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          onClick={onDeleteGroup}
          aria-label={`Borrar el grupo ${groupLabel || "sin nombre"}`}
        >
          <Trash2 className="size-3.5" />
        </Button>
      </div>

      <div className="space-y-2 pl-3">
        {indices.map((idx, optIndex) => {
          const productId = watch(`components.${idx}.product_id`);
          return (
            <div key={idx} className="space-y-1.5">
            <div className="flex items-center gap-2">
              <CardMoveButtons
                id={`opt-${groupId}-${optIndex}`}
                label={`la opción ${optIndex + 1} de ${groupLabel || `el grupo sin nombre ${groupId.slice(0, 4)}`}`}
                isFirst={optIndex === 0}
                isLast={optIndex === indices.length - 1}
                onUp={() => onMoveOption(optIndex, optIndex - 1, "up")}
                onDown={() => onMoveOption(optIndex, optIndex + 1, "down")}
              />
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

      {/* Cuándo aparece este grupo (spec 087). Una regla, en el grupo, en
          positivo — antes eran N casillas «Lleva X» repartidas por opción. */}
      <GroupCondition
        groupId={groupId}
        groupLabel={groupLabel}
        earlierGroups={earlierGroups}
        condition={condition}
        onChange={onConditionChange}
      />
    </div>
  );
}

/**
 * «¿Cuándo aparece este paso?» — la condición del grupo (spec 087).
 *
 * Reemplaza a la grilla de casillas «Lleva X» que vivía en cada opción. La
 * diferencia no es de tamaño sino de dirección: la regla se lee y se edita
 * donde se pregunta, y se escribe en positivo («aplica si eligieron…») en vez
 * de por doble negación («destildá lo que NO lleva»).
 *
 * Sólo se ofrecen grupos ANTERIORES: uno posterior todavía no se decidió cuando
 * llegaría la regla. Antes eso era una restricción a explicar en un párrafo;
 * ahora es simplemente lo que hay en el desplegable.
 */
function GroupCondition({
  groupId,
  groupLabel,
  earlierGroups,
  condition,
  onChange,
}: {
  groupId: string;
  groupLabel: string;
  earlierGroups: { id: string; label: string; options: { product_id: string; label: string }[] }[];
  condition: { applies_when_group_id: string | null; applies_when_product_ids: string[] };
  onChange: (next: {
    applies_when_group_id: string | null;
    applies_when_product_ids: string[];
  }) => void;
}) {
  if (earlierGroups.length === 0) return null;

  const fuente = earlierGroups.find(
    (g) => g.id === condition.applies_when_group_id,
  );
  const condicionado = !!fuente;

  return (
    <div className="ml-3 space-y-2 border-t pt-3">
      <p className="text-xs font-medium">¿Cuándo aparece este grupo?</p>

      <label className="flex items-center gap-2 text-xs">
        <input
          type="radio"
          name={`cond-${groupId}`}
          className="size-3.5"
          checked={!condicionado}
          onChange={() =>
            onChange({ applies_when_group_id: null, applies_when_product_ids: [] })
          }
        />
        <span>Siempre</span>
      </label>

      <div className="flex flex-wrap items-center gap-2 text-xs">
        <label className="flex items-center gap-2">
          <input
            type="radio"
            name={`cond-${groupId}`}
            className="size-3.5"
            checked={condicionado}
            onChange={() => {
              const primero = earlierGroups[0];
              onChange({
                applies_when_group_id: primero.id,
                // Arranca con todas tildadas: el encargado destilda las pocas
                // que no lo llevan, que es como piensa el caso real.
                applies_when_product_ids: primero.options.map((o) => o.product_id),
              });
            }}
          />
          <span>Sólo si en</span>
        </label>
        <select
          value={condition.applies_when_group_id ?? ""}
          disabled={!condicionado}
          onChange={(e) => {
            const elegido = earlierGroups.find((g) => g.id === e.target.value);
            if (!elegido) return;
            onChange({
              applies_when_group_id: elegido.id,
              applies_when_product_ids: elegido.options.map((o) => o.product_id),
            });
          }}
          className="border-input bg-background h-8 rounded-md border px-2 text-xs disabled:opacity-50"
          aria-label={`Grupo del que depende ${groupLabel || "este grupo"}`}
        >
          {earlierGroups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.label || "(grupo sin nombre)"}
            </option>
          ))}
        </select>
        <span className={condicionado ? "" : "text-muted-foreground"}>
          eligieron:
        </span>
      </div>

      {condicionado && fuente && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pl-6">
          {fuente.options.map((o) => (
            <label key={o.product_id} className="flex items-center gap-1.5 text-xs">
              <input
                type="checkbox"
                className="size-3.5"
                checked={condition.applies_when_product_ids.includes(o.product_id)}
                onChange={(e) =>
                  onChange({
                    applies_when_group_id: fuente.id,
                    applies_when_product_ids: e.target.checked
                      ? [...condition.applies_when_product_ids, o.product_id]
                      : condition.applies_when_product_ids.filter(
                          (id) => id !== o.product_id,
                        ),
                  })
                }
              />
              <span>{o.label || "(sin producto)"}</span>
            </label>
          ))}
          {fuente.options.length === 0 && (
            <span className="text-muted-foreground">
              Ese grupo todavía no tiene opciones con producto.
            </span>
          )}
        </div>
      )}

      {condicionado && condition.applies_when_product_ids.length === 0 && (
        <p className="text-xs text-amber-700">
          Sin ninguna tildada, este grupo no va a aparecer nunca.
        </p>
      )}
    </div>
  );
}
