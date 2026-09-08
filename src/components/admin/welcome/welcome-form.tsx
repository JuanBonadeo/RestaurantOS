"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { ArrowRight, Check, Eye, EyeOff, ShieldCheck } from "lucide-react";

import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { completeWelcome } from "@/lib/admin/welcome-actions";
import { cn } from "@/lib/utils";

const Schema = z
  .object({
    full_name: z
      .string()
      .trim()
      .max(80, "Máximo 80 caracteres.")
      .optional(),
    password: z
      .string()
      .min(8, "Mínimo 8 caracteres.")
      .max(72, "Máximo 72 caracteres."),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, {
    path: ["confirm"],
    message: "Las contraseñas no coinciden.",
  });

type Values = z.infer<typeof Schema>;

function initials(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((s) => s[0]?.toUpperCase() ?? "")
      .join("") || "?"
  );
}

function strength(pass: string): {
  level: 0 | 1 | 2 | 3 | 4;
  label: string;
} {
  let score = 0;
  if (pass.length >= 8) score++;
  if (pass.length >= 12) score++;
  if (/[a-z]/.test(pass) && /[A-Z]/.test(pass)) score++;
  if (/\d/.test(pass) || /[^a-zA-Z0-9]/.test(pass)) score++;
  const labels = [
    "Muy corta",
    "Débil",
    "Aceptable",
    "Fuerte",
    "Muy fuerte",
  ] as const;
  return { level: score as 0 | 1 | 2 | 3 | 4, label: labels[score] };
}

export function WelcomeForm({
  businessName,
  businessSlug,
  businessLogoUrl,
  email,
  displayName,
  destino,
}: {
  businessName: string;
  businessSlug: string;
  businessLogoUrl: string | null;
  email: string;
  displayName: string;
  /** Dónde cae al terminar. Lo calcula el server, que es el único que sabe el
   *  rol y, con él, cuál es el primer tema del recorrido (spec 169 · D1). */
  destino: string;
}) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [showPass, setShowPass] = useState(false);
  const form = useForm<Values>({
    resolver: zodResolver(Schema),
    defaultValues: {
      full_name: displayName,
      password: "",
      confirm: "",
    },
  });

  const pass = form.watch("password");
  const s = strength(pass ?? "");

  const onSubmit = async (values: Values) => {
    setSubmitting(true);
    try {
      const r = await completeWelcome({
        password: values.password,
        full_name: values.full_name,
      });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success("Listo, bienvenido.");
      // Spec 142 · D4 — recién creó su contraseña: lo que necesita no es el
      // panel vacío sino saber qué hacer con él. Sólo acá, al terminar la
      // bienvenida; en los logins siguientes entra derecho a lo suyo.
      //
      // Spec 169 · D1 — y no cae en el índice sino en el PRIMER TEMA. Un índice
      // de veinte tarjetas es para volver, no para empezar: el que llega por
      // primera vez no sabe cuál de las veinte le toca.
      router.replace(destino);
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto grid w-full max-w-lg gap-6">
      <div className="flex items-center gap-3">
        <span
          className="relative flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-2xl ring-1 ring-black/10 shadow-[inset_0_1px_0_rgba(255,255,255,0.14)]"
          style={{
            background: "var(--brand)",
            color: "var(--brand-foreground)",
          }}
        >
          {businessLogoUrl ? (
            <Image
              src={businessLogoUrl}
              alt={businessName}
              fill
              sizes="56px"
              className="object-cover"
            />
          ) : (
            <span className="text-sm font-bold tracking-tight">
              {initials(businessName)}
            </span>
          )}
        </span>
        <div className="min-w-0">
          <p className="text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-zinc-500">
            {businessName}
          </p>
          <h1 className="mt-0.5 text-3xl font-semibold tracking-tight text-zinc-900">
            Bienvenida · elegí tu contraseña
          </h1>
        </div>
      </div>

      <p className="text-sm text-zinc-600">
        Ya te dimos acceso al panel. Para poder volver a entrar más adelante,
        necesitás fijar una contraseña. Usamos{" "}
        <code className="rounded bg-zinc-100 px-1.5 py-0.5 text-zinc-700">
          {email}
        </code>{" "}
        como tu email de login.
      </p>

      <Form {...form}>
        <form
          onSubmit={form.handleSubmit(onSubmit)}
          className="rounded-2xl bg-white p-6 ring-1 ring-zinc-200/70"
        >
          <div className="grid gap-5">
            <FormField
              control={form.control}
              name="full_name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Tu nombre</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="Cómo querés que te llamemos"
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
              name="password"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Contraseña</FormLabel>
                  <FormControl>
                    <div className="relative">
                      <Input
                        type={showPass ? "text" : "password"}
                        autoComplete="new-password"
                        placeholder="Mínimo 8 caracteres"
                        className="pr-10"
                        {...field}
                      />
                      <button
                        type="button"
                        aria-label={showPass ? "Ocultar" : "Mostrar"}
                        onClick={() => setShowPass((v) => !v)}
                        className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900"
                      >
                        {showPass ? (
                          <EyeOff className="size-4" />
                        ) : (
                          <Eye className="size-4" />
                        )}
                      </button>
                    </div>
                  </FormControl>
                  <FormMessage />
                  {pass && (
                    <div className="mt-1 flex items-center gap-2">
                      <div className="flex h-1 flex-1 gap-1">
                        {[1, 2, 3, 4].map((lvl) => (
                          <span
                            key={lvl}
                            className={cn(
                              "flex-1 rounded-full transition",
                              s.level >= lvl
                                ? lvl <= 1
                                  ? "bg-rose-400"
                                  : lvl === 2
                                    ? "bg-amber-400"
                                    : "bg-emerald-500"
                                : "bg-zinc-200",
                            )}
                          />
                        ))}
                      </div>
                      <span className="w-20 text-right text-[0.7rem] font-medium text-zinc-500">
                        {s.label}
                      </span>
                    </div>
                  )}
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="confirm"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Confirmar contraseña</FormLabel>
                  <FormControl>
                    <Input
                      type={showPass ? "text" : "password"}
                      autoComplete="new-password"
                      placeholder="Repetí la contraseña"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <button
              type="submit"
              disabled={submitting}
              className="mt-2 inline-flex h-11 items-center justify-center gap-2 rounded-full px-5 text-sm font-semibold transition-all hover:brightness-95 active:translate-y-px disabled:pointer-events-none disabled:opacity-50"
              style={{
                background: "var(--brand)",
                color: "var(--brand-foreground)",
                boxShadow: "0 10px 24px -14px var(--brand)",
              }}
            >
              {submitting ? "Guardando…" : "Entrar al panel"}
              <ArrowRight className="size-4" />
            </button>
          </div>
        </form>
      </Form>

      <ul className="grid gap-2 text-xs text-zinc-500">
        <li className="flex items-start gap-2">
          <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-emerald-500" />
          Tu contraseña se guarda hasheada en Supabase Auth, no la vemos en
          texto plano.
        </li>
        <li className="flex items-start gap-2">
          <Check className="mt-0.5 size-3.5 shrink-0 text-emerald-500" />
          A partir de ahora entrás desde{" "}
          <code className="rounded bg-zinc-100 px-1 py-0.5 text-zinc-700">
            /{businessSlug}/admin/login
          </code>{" "}
          con este email y la contraseña que elijas.
        </li>
      </ul>
    </div>
  );
}
