"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import {
  AlertTriangle,
  Clock,
  Globe,
  Hash,
  Mail,
  MapPin,
  Phone,
  Store,
  Truck,
} from "lucide-react";

import { SettingsSection } from "@/components/admin/settings/settings-section";
import {
  CurrencyInput,
  InputWithIcon,
  MinutesInput,
  SaveBar,
} from "@/components/admin/settings/settings-form-primitives";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { updateBusinessProfile } from "@/lib/admin/business-actions";
import { SLUG_PATTERN, slugify } from "@/lib/reserved-slugs";

const Schema = z.object({
  slug: z
    .string()
    .trim()
    .min(2, "Mínimo 2 caracteres.")
    .max(60, "Máximo 60 caracteres.")
    .regex(SLUG_PATTERN, "Sólo minúsculas, números y guiones."),
  name: z.string().min(1, "Requerido.").max(120),
  phone: z.string().max(40).optional(),
  email: z.string().max(120).optional(),
  address: z.string().max(200).optional(),
  timezone: z.string().min(1, "Requerido."),
  delivery_fee_cents: z.coerce
    .number()
    .int("Tiene que ser un número entero.")
    .min(0, "No puede ser negativo."),
  min_order_cents: z.coerce
    .number()
    .int("Tiene que ser un número entero.")
    .min(0, "No puede ser negativo."),
  estimated_delivery_minutes: z
    .union([z.coerce.number().int().min(0), z.literal("")])
    .transform((v) => (v === "" ? null : v))
    .nullable(),
  // Spec 133: el piso del estimado de retiro. Vacío = default del producto (40).
  estimated_pickup_minutes: z
    .union([z.coerce.number().int().min(0), z.literal("")])
    .transform((v) => (v === "" ? null : v))
    .nullable(),
  // Spec 061: cuánto antes de la hora pedida sale la comanda de un programado.
  // El techo (240) es el mismo check que la migración 0027.
  scheduled_march_lead_pickup_min: z.coerce
    .number()
    .int("Tiene que ser un número entero.")
    .min(0, "No puede ser negativo.")
    .max(240, "Máximo 240 minutos."),
  scheduled_march_lead_delivery_min: z.coerce
    .number()
    .int("Tiene que ser un número entero.")
    .min(0, "No puede ser negativo.")
    .max(240, "Máximo 240 minutos."),
});

type Values = z.infer<typeof Schema>;

export function BusinessProfileForm({
  slug,
  initial,
}: {
  slug: string;
  initial: Values;
}) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const form = useForm<Values>({
    resolver: zodResolver(Schema) as unknown as Resolver<Values>,
    defaultValues: initial,
  });

  const onSubmit = async (values: Values) => {
    setSubmitting(true);
    try {
      const r = await updateBusinessProfile({
        business_slug: slug,
        ...values,
        delivery_fee_cents: Math.round(values.delivery_fee_cents * 100),
        min_order_cents: Math.round(values.min_order_cents * 100),
      });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      const newSlug = r.data.slug;
      if (newSlug !== slug) {
        toast.success("Configuración guardada. URL actualizada.");
        router.replace(`/${newSlug}/admin/configuracion`);
        router.refresh();
        return;
      }
      toast.success("Configuración guardada.");
      form.reset(values);
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  };

  const nameValue = form.watch("name");

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-6">
        {/* Datos del negocio */}
        <SettingsSection
          icon={<Store className="size-5" strokeWidth={1.75} />}
          title="Datos del negocio"
          description="Nombre y dirección pública de tu local en la plataforma."
        >
          <div className="grid items-start gap-4 sm:grid-cols-2">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <div className="flex h-5 items-baseline justify-between gap-2">
                    <FormLabel>Nombre del negocio</FormLabel>
                  </div>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="slug"
              render={({ field }) => {
                const initialSlug = initial.slug;
                const currentName = nameValue ?? "";
                const suggested = slugify(currentName);
                const canSuggest =
                  suggested.length >= 2 && suggested !== field.value;
                const changed = field.value !== initialSlug;
                return (
                  <FormItem>
                    <div className="flex h-5 items-baseline justify-between gap-2">
                      <FormLabel>Slug (URL)</FormLabel>
                      {canSuggest && (
                        <button
                          type="button"
                          onClick={() =>
                            field.onChange(suggested, { shouldDirty: true })
                          }
                          className="text-xs font-medium underline-offset-2 hover:underline"
                          style={{ color: "var(--brand)" }}
                        >
                          Usar nombre → {suggested}
                        </button>
                      )}
                    </div>
                    <FormControl>
                      <div className="relative">
                        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs text-zinc-400">
                          <Hash className="size-3.5" />
                        </span>
                        <Input
                          placeholder="pizzanapoli"
                          className="pl-8"
                          {...field}
                        />
                      </div>
                    </FormControl>
                    <FormMessage />
                    <p className="text-xs text-zinc-500">
                      URL pública:{" "}
                      <code className="rounded bg-zinc-100 px-1.5 py-0.5 text-zinc-700">
                        /{field.value || "…"}
                      </code>
                    </p>
                    {changed && (
                      <p className="flex gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[0.7rem] leading-snug text-amber-900">
                        <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                        <span>
                          Al cambiar el slug, la URL vieja deja de funcionar.
                          QRs, bookmarks y links con <code>/{initialSlug}</code>{" "}
                          van a dar 404.
                        </span>
                      </p>
                    )}
                  </FormItem>
                );
              }}
            />
          </div>
        </SettingsSection>

        {/* Contacto */}
        <SettingsSection
          icon={<Phone className="size-5" strokeWidth={1.75} />}
          title="Contacto"
          description="Datos visibles en el menú y notificaciones del pedido."
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField
              control={form.control}
              name="phone"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Teléfono</FormLabel>
                  <FormControl>
                    <InputWithIcon
                      icon={<Phone className="size-3.5" />}
                      placeholder="+54 11 5555-1234"
                      {...field}
                      value={field.value ?? ""}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Email</FormLabel>
                  <FormControl>
                    <InputWithIcon
                      icon={<Mail className="size-3.5" />}
                      type="email"
                      placeholder="hola@negocio.com"
                      {...field}
                      value={field.value ?? ""}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          <FormField
            control={form.control}
            name="address"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Dirección</FormLabel>
                <FormControl>
                  <InputWithIcon
                    icon={<MapPin className="size-3.5" />}
                    placeholder="Av. Corrientes 1234, CABA"
                    {...field}
                    value={field.value ?? ""}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="timezone"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Zona horaria</FormLabel>
                <FormControl>
                  <InputWithIcon
                    icon={<Globe className="size-3.5" />}
                    {...field}
                  />
                </FormControl>
                <FormMessage />
                <p className="text-xs text-zinc-500">
                  Formato IANA, ej:{" "}
                  <code className="rounded bg-zinc-100 px-1.5 py-0.5 text-zinc-700">
                    America/Argentina/Buenos_Aires
                  </code>
                </p>
              </FormItem>
            )}
          />
        </SettingsSection>

        {/* Envío */}
        <SettingsSection
          icon={<Truck className="size-5" strokeWidth={1.75} />}
          title="Envío"
          description="Retiro en el local es siempre gratis. Delivery cobra un envío único."
        >
          <div className="grid gap-4 sm:grid-cols-3">
            <FormField
              control={form.control}
              name="delivery_fee_cents"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Costo de envío</FormLabel>
                  <FormControl>
                    <CurrencyInput
                      placeholder="1500"
                      {...field}
                      value={field.value ?? 0}
                    />
                  </FormControl>
                  <FormMessage />
                  <p className="text-xs text-zinc-500">0 = envío gratis.</p>
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="min_order_cents"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Pedido mínimo</FormLabel>
                  <FormControl>
                    <CurrencyInput
                      placeholder="0"
                      {...field}
                      value={field.value ?? 0}
                    />
                  </FormControl>
                  <FormMessage />
                  <p className="text-xs text-zinc-500">0 = sin mínimo.</p>
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="estimated_delivery_minutes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Estimado de envío</FormLabel>
                  <FormControl>
                    <MinutesInput
                      placeholder="60"
                      {...field}
                      value={field.value ?? ""}
                    />
                  </FormControl>
                  <FormMessage />
                  <p className="text-xs text-zinc-500">
                    Vacío = 60 min. Al cliente se le muestra hasta la media hora
                    siguiente: 60 → «1 h – 1 h 30».
                  </p>
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="estimated_pickup_minutes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Estimado de retiro</FormLabel>
                  <FormControl>
                    <MinutesInput
                      placeholder="40"
                      {...field}
                      value={field.value ?? ""}
                    />
                  </FormControl>
                  <FormMessage />
                  <p className="text-xs text-zinc-500">
                    Vacío = 40 min → «40 min – 1 h».
                  </p>
                </FormItem>
              )}
            />
          </div>
        </SettingsSection>

        {/* Pedidos programados (spec 061) */}
        <SettingsSection
          icon={<Clock className="size-5" strokeWidth={1.75} />}
          title="Pedidos programados"
          description="Cuánto antes de la hora pedida sale sola la comanda a cocina. El delivery necesita más: además de cocinar, hay que viajar."
        >
          <div className="grid gap-4 sm:grid-cols-3">
            <FormField
              control={form.control}
              name="scheduled_march_lead_pickup_min"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Anticipación · retiro</FormLabel>
                  <FormControl>
                    <MinutesInput
                      placeholder="40"
                      {...field}
                      value={field.value ?? 40}
                    />
                  </FormControl>
                  <FormMessage />
                  <p className="text-xs text-zinc-500">
                    Un retiro para las 21:00 imprime a las 20:20.
                  </p>
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="scheduled_march_lead_delivery_min"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Anticipación · delivery</FormLabel>
                  <FormControl>
                    <MinutesInput
                      placeholder="60"
                      {...field}
                      value={field.value ?? 60}
                    />
                  </FormControl>
                  <FormMessage />
                  <p className="text-xs text-zinc-500">
                    Un delivery para las 21:00 imprime a las 20:00.
                  </p>
                </FormItem>
              )}
            />
          </div>
        </SettingsSection>

        <SaveBar
          dirty={form.formState.isDirty}
          submitting={submitting}
          onDiscard={() => form.reset(initial)}
        />
      </form>
    </Form>
  );
}
