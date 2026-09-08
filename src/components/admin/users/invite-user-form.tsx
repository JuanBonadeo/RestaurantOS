"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import {
  Check,
  Copy,
  Eye,
  EyeOff,
  KeyRound,
  Link2,
  MessageCircle,
  RefreshCw,
  UserPlus,
} from "lucide-react";

import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  createBusinessMemberWithPassword,
  inviteBusinessMemberByAdmin,
  type CreateMemberPayload,
  type InvitePayload,
} from "@/lib/admin/members-actions";
import {
  BUSINESS_ROLES,
  ROLE_META,
  type BusinessRoleInput,
} from "@/lib/admin/roles";
import { cn } from "@/lib/utils";

type Mode = "password" | "link";

function RoleSelect({
  value,
  onChange,
  excluir = [],
}: {
  value: BusinessRoleInput;
  onChange: (v: BusinessRoleInput) => void;
  /**
   * Roles que este formulario no puede dar de alta (issue #271).
   *
   * El alta ahora exige PIN para `personal` —es lo único que ese rol usa para
   * entrar, y sin PIN la persona queda dada de alta sin poder fichar—, pero el
   * tab de link no tiene dónde pedirlo. Ofrecer la opción ahí es un callejón:
   * el server la rechaza siempre y la pantalla no da forma de cumplir. Se saca
   * del combo en vez de dibujar un campo más, porque el link existe justamente
   * para que la persona complete sus datos del otro lado.
   */
  excluir?: readonly BusinessRoleInput[];
}) {
  const roles = BUSINESS_ROLES.filter((r) => !excluir.includes(r));
  return (
    <Select value={value} onValueChange={(v) => onChange(v as BusinessRoleInput)}>
      <SelectTrigger>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {roles.map((r) => (
          <SelectItem key={r} value={r}>
            <div className="flex flex-col gap-0.5 py-0.5">
              <span className="font-medium">{ROLE_META[r].label}</span>
              <span className="text-xs text-zinc-500">
                {ROLE_META[r].description}
              </span>
            </div>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function InviteUserForm({
  slug,
  businessName,
}: {
  slug: string;
  businessName?: string;
}) {
  const [mode, setMode] = useState<Mode>("password");
  const [inviteResult, setInviteResult] = useState<InvitePayload | null>(null);
  const [createResult, setCreateResult] = useState<CreateMemberPayload | null>(
    null,
  );

  const dismiss = () => {
    setInviteResult(null);
    setCreateResult(null);
  };

  return (
    <div className="space-y-4">
      <nav
        aria-label="Modo de alta"
        className="inline-flex rounded-full bg-zinc-100 p-1"
      >
        <TabChip
          active={mode === "password"}
          onClick={() => {
            setMode("password");
            dismiss();
          }}
        >
          <KeyRound className="size-3.5" /> Crear con contraseña
        </TabChip>
        <TabChip
          active={mode === "link"}
          onClick={() => {
            setMode("link");
            dismiss();
          }}
        >
          <Link2 className="size-3.5" /> Mandar link
        </TabChip>
      </nav>

      {mode === "password" ? (
        <CreateWithPasswordForm
          slug={slug}
          onResult={(r) => setCreateResult(r)}
        />
      ) : (
        <LinkInviteForm slug={slug} onResult={(r) => setInviteResult(r)} />
      )}

      {createResult ? (
        <CreatedCredentialsCard
          result={createResult}
          businessName={businessName}
          onDismiss={dismiss}
        />
      ) : null}
      {inviteResult ? (
        <InviteResultCard result={inviteResult} onDismiss={dismiss} />
      ) : null}
    </div>
  );
}

function TabChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition",
        active
          ? "bg-white text-zinc-900 shadow-sm ring-1 ring-zinc-200"
          : "text-zinc-600 hover:text-zinc-900",
      )}
    >
      {children}
    </button>
  );
}

// ——— Create with password ———

const CreateSchema = z.object({
  email: z.string().max(200).optional(),
  password: z.string().max(72).optional(),
  role: z.enum(BUSINESS_ROLES),
  full_name: z
    .string()
    .trim()
    .min(1, "El nombre es obligatorio.")
    .max(80, "Nombre demasiado largo."),
  phone: z.string().trim().max(40, "Teléfono demasiado largo."),
  pin: z.string().trim().max(4).optional(),
});
type CreateValues = z.infer<typeof CreateSchema>;

function generatePassword(): string {
  const alphabet =
    "abcdefghijkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const len = 10;
  const bytes = new Uint32Array(len);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < len; i++) {
    out += alphabet[bytes[i] % alphabet.length];
  }
  return out;
}

function CreateWithPasswordForm({
  slug,
  onResult,
}: {
  slug: string;
  onResult: (r: CreateMemberPayload) => void;
}) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [showPass, setShowPass] = useState(false);
  const form = useForm<CreateValues>({
    resolver: zodResolver(CreateSchema),
    defaultValues: {
      email: "",
      password: generatePassword(),
      role: "admin",
      full_name: "",
      phone: "",
      pin: "",
    },
  });

  const watchedRole = form.watch("role");

  const onSubmit = async (values: CreateValues) => {
    setSubmitting(true);
    try {
      const r = await createBusinessMemberWithPassword({
        business_slug: slug,
        ...values,
      });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      onResult(r.data);
      toast.success(
        r.data.wasCreated
          ? "Usuario creado. Compartile las credenciales."
          : "Contraseña actualizada. Compartíla con el miembro.",
      );
      form.reset({
        email: "",
        password: generatePassword(),
        role: "admin",
        full_name: "",
        phone: "",
        pin: "",
      });
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        className="grid gap-4 rounded-2xl bg-white p-4 ring-1 ring-zinc-200/70"
      >
        <div className="grid gap-4 sm:grid-cols-2">
          {watchedRole !== "personal" && (
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Email</FormLabel>
                  <FormControl>
                    <Input
                      type="email"
                      placeholder="miembro@ejemplo.com"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          )}
          <FormField
            control={form.control}
            name="full_name"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Nombre completo</FormLabel>
                <FormControl>
                  <Input
                    placeholder="María López"
                    {...field}
                    value={field.value ?? ""}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="phone"
            render={({ field }) => (
              <FormItem>
                <FormLabel>
                  Teléfono{" "}
                  <span className="font-normal text-zinc-500">(opcional)</span>
                </FormLabel>
                <FormControl>
                  <Input
                    type="tel"
                    placeholder="+54 9 11 1234 5678"
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
            name="pin"
            render={({ field }) => (
              <FormItem>
                <FormLabel>
                  PIN de fichada{" "}
                  {watchedRole !== "personal" && (
                    <span className="font-normal text-zinc-500">(opcional)</span>
                  )}
                </FormLabel>
                <FormControl>
                  <Input
                    type="text"
                    inputMode="numeric"
                    maxLength={4}
                    placeholder="4 dígitos"
                    {...field}
                    value={field.value ?? ""}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_160px]">
          {watchedRole !== "personal" && (
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
                        className="pr-20 font-mono"
                        {...field}
                      />
                      <div className="absolute right-1 top-1/2 flex -translate-y-1/2 gap-1">
                        <button
                          type="button"
                          aria-label="Generar aleatoria"
                          onClick={() =>
                            form.setValue("password", generatePassword(), {
                              shouldDirty: true,
                            })
                          }
                          className="rounded-md p-1.5 text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900"
                          title="Generar aleatoria"
                        >
                          <RefreshCw className="size-4" />
                        </button>
                        <button
                          type="button"
                          aria-label={showPass ? "Ocultar" : "Mostrar"}
                          onClick={() => setShowPass((v) => !v)}
                          className="rounded-md p-1.5 text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900"
                        >
                          {showPass ? (
                            <EyeOff className="size-4" />
                          ) : (
                            <Eye className="size-4" />
                          )}
                        </button>
                      </div>
                    </div>
                  </FormControl>
                  <FormMessage />
                  <p className="text-xs text-zinc-500">
                    La compartís vos. El miembro la puede cambiar después.
                  </p>
                </FormItem>
              )}
            />
          )}
          <FormField
            control={form.control}
            name="role"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Rol</FormLabel>
                <FormControl>
                  <RoleSelect value={field.value} onChange={field.onChange} />
                </FormControl>
                <p className="text-xs text-zinc-500">
                  {ROLE_META[field.value].description}
                </p>
              </FormItem>
            )}
          />
        </div>

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={submitting}
            className="inline-flex h-10 items-center gap-2 rounded-full px-5 text-sm font-semibold transition-all hover:brightness-95 active:translate-y-px disabled:pointer-events-none disabled:opacity-50"
            style={{
              background: "var(--brand)",
              color: "var(--brand-foreground)",
              boxShadow: "0 10px 24px -14px var(--brand)",
            }}
          >
            <UserPlus className="size-4" strokeWidth={1.75} />
            {submitting ? "Creando…" : "Crear miembro"}
          </button>
        </div>
      </form>
    </Form>
  );
}

function CreatedCredentialsCard({
  result,
  businessName,
  onDismiss,
}: {
  result: CreateMemberPayload;
  businessName?: string;
  onDismiss: () => void;
}) {
  const [copied, setCopied] = useState<null | "email" | "password" | "both">(
    null,
  );

  const loginUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}${window.location.pathname.replace(/\/(empleados|usuarios)$/, "/login")}`
      : "";

  const copy = async (text: string, which: "email" | "password" | "both") => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(which);
      toast.success("Copiado");
      setTimeout(() => setCopied(null), 1800);
    } catch {
      toast.error("No pudimos copiar. Seleccioná manual.");
    }
  };

  const whatsappBody = [
    `Ya te dimos acceso al panel${businessName ? ` de ${businessName}` : ""}.`,
    "",
    `Email: ${result.email}`,
    `Contraseña: ${result.password}`,
    loginUrl ? `Entrá desde: ${loginUrl}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const waHref = `https://wa.me/?text=${encodeURIComponent(whatsappBody)}`;

  return (
    <div className="overflow-hidden rounded-2xl bg-white ring-1 ring-zinc-200/70">
      <div
        className="flex items-center gap-3 px-4 py-3"
        style={{
          background: `color-mix(in srgb, var(--brand) 8%, white)`,
        }}
      >
        <span
          className="flex size-8 shrink-0 items-center justify-center rounded-full"
          style={{
            background: "var(--brand)",
            color: "var(--brand-foreground)",
          }}
        >
          <KeyRound className="size-4" strokeWidth={1.75} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-zinc-900">
            {result.wasCreated
              ? "Credenciales listas"
              : "Contraseña actualizada"}
          </p>
          <p className="text-xs text-zinc-600">
            Compartilas por WhatsApp o el canal que prefieras.{" "}
            <strong>No vas a poder verlas de nuevo.</strong>
          </p>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          className="text-xs font-medium text-zinc-500 hover:text-zinc-900"
        >
          Cerrar
        </button>
      </div>

      <div className="grid gap-3 p-4">
        <CredField
          label="Email"
          value={result.email}
          copied={copied === "email"}
          onCopy={() => copy(result.email, "email")}
        />
        <CredField
          label="Contraseña"
          value={result.password}
          mono
          copied={copied === "password"}
          onCopy={() => copy(result.password, "password")}
        />
        <div className="flex flex-wrap gap-2 pt-1">
          <a
            href={waHref}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 rounded-full bg-emerald-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-600"
          >
            <MessageCircle className="size-3.5" strokeWidth={2} />
            Compartir por WhatsApp
          </a>
          <button
            type="button"
            onClick={() => copy(whatsappBody, "both")}
            className={cn(
              "inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition",
              copied === "both"
                ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200"
                : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200",
            )}
          >
            {copied === "both" ? (
              <Check className="size-3.5" />
            ) : (
              <Copy className="size-3.5" />
            )}
            {copied === "both" ? "Copiado" : "Copiar mensaje completo"}
          </button>
        </div>
      </div>
    </div>
  );
}

function CredField({
  label,
  value,
  mono = false,
  copied,
  onCopy,
}: {
  label: string;
  value: string;
  mono?: boolean;
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <div className="grid gap-1">
      <p className="text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-zinc-500">
        {label}
      </p>
      <div className="flex items-center gap-2">
        <code
          className={cn(
            "flex-1 overflow-hidden truncate rounded-xl bg-zinc-50 px-3 py-2.5 text-sm ring-1 ring-zinc-200/60",
            mono ? "font-mono" : "",
          )}
        >
          {value}
        </code>
        <button
          type="button"
          onClick={onCopy}
          className={cn(
            "inline-flex h-auto items-center gap-1.5 rounded-xl px-3 py-2.5 text-xs font-semibold transition",
            copied
              ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200"
              : "bg-zinc-900 text-zinc-50 hover:bg-zinc-800",
          )}
        >
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          {copied ? "Copiado" : "Copiar"}
        </button>
      </div>
    </div>
  );
}

// ——— Link invite (secondary option) ———

const LinkSchema = z.object({
  email: z.string().email("Email inválido."),
  role: z.enum(BUSINESS_ROLES),
  full_name: z
    .string()
    .trim()
    .min(1, "El nombre es obligatorio.")
    .max(80, "Nombre demasiado largo."),
  phone: z.string().trim().max(40, "Teléfono demasiado largo."),
  pin: z.string().trim().max(4).optional(),
});
type LinkValues = z.infer<typeof LinkSchema>;

function LinkInviteForm({
  slug,
  onResult,
}: {
  slug: string;
  onResult: (r: InvitePayload) => void;
}) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const form = useForm<LinkValues>({
    resolver: zodResolver(LinkSchema),
    defaultValues: { email: "", role: "admin", full_name: "", phone: "", pin: "" },
  });

  const onSubmit = async (values: LinkValues) => {
    setSubmitting(true);
    try {
      const r = await inviteBusinessMemberByAdmin({
        business_slug: slug,
        ...values,
      });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      onResult(r.data);
      if (r.data.inviteLink) {
        toast.success(
          r.data.isNewUser
            ? "Invitación lista. Copiala y mandásela."
            : "Acceso actualizado. Tenés un link para que entre directo.",
        );
      } else {
        toast.success(`${values.email} ya tiene acceso.`);
      }
      form.reset({ email: "", role: "admin", full_name: "", phone: "", pin: "" });
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        className="grid gap-3 rounded-2xl bg-white p-4 ring-1 ring-zinc-200/70"
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="full_name"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Nombre completo</FormLabel>
                <FormControl>
                  <Input placeholder="María López" {...field} />
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
                  <Input
                    type="email"
                    placeholder="empleado@ejemplo.com"
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_180px]">
          <FormField
            control={form.control}
            name="phone"
            render={({ field }) => (
              <FormItem>
                <FormLabel>
                  Teléfono{" "}
                  <span className="font-normal text-zinc-500">(opcional)</span>
                </FormLabel>
                <FormControl>
                  <Input
                    type="tel"
                    placeholder="+54 9 11 1234 5678"
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
            name="role"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Rol</FormLabel>
                <FormControl>
                  <RoleSelect
                    value={field.value}
                    onChange={field.onChange}
                    excluir={["personal"]}
                  />
                </FormControl>
              </FormItem>
            )}
          />
        </div>
        <div className="flex justify-end">
          <button
          type="submit"
          disabled={submitting}
          className="inline-flex h-10 items-center gap-2 rounded-full px-5 text-sm font-semibold transition-all hover:brightness-95 active:translate-y-px disabled:pointer-events-none disabled:opacity-50"
          style={{
            background: "var(--brand)",
            color: "var(--brand-foreground)",
            boxShadow: "0 10px 24px -14px var(--brand)",
          }}
        >
          <Link2 className="size-4" strokeWidth={1.75} />
          {submitting ? "Generando…" : "Generar link"}
        </button>
        </div>
      </form>
    </Form>
  );
}

function InviteResultCard({
  result,
  onDismiss,
}: {
  result: InvitePayload;
  onDismiss: () => void;
}) {
  const [copied, setCopied] = useState(false);

  if (!result.inviteLink) {
    return (
      <div className="flex items-start gap-3 rounded-2xl bg-emerald-50 p-4 ring-1 ring-emerald-200/70">
        <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-white ring-1 ring-emerald-200">
          <Check className="size-4 text-emerald-600" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-emerald-900">
            {result.email} ya tiene acceso
          </p>
          <p className="mt-0.5 text-xs text-emerald-800/80">
            Puede entrar con su contraseña actual en la pantalla de login.
          </p>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          className="text-xs font-semibold text-emerald-800 hover:underline"
        >
          OK
        </button>
      </div>
    );
  }

  const link = result.inviteLink;
  const headline = result.isNewUser
    ? `Link listo para ${result.email}`
    : `${result.email} ya tenía cuenta`;
  const subtitle = result.isNewUser
    ? "Al abrirlo, el miembro crea su contraseña y entra al panel."
    : "Generamos un magic link para que entre directo, aunque nunca se haya logueado.";
  const waBody = result.isNewUser
    ? `Te invito a entrar al panel de Pedidos. Abrí este link para crear tu contraseña:\n\n${link}`
    : `Ya tenés acceso al panel de Pedidos. Abrí este link para entrar directo:\n\n${link}`;
  const waHref = `https://wa.me/?text=${encodeURIComponent(waBody)}`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      toast.success("Link copiado");
      setTimeout(() => setCopied(false), 1800);
    } catch {
      toast.error("No pudimos copiar automáticamente. Seleccioná manual.");
    }
  };

  return (
    <div className="overflow-hidden rounded-2xl bg-white ring-1 ring-zinc-200/70">
      <div
        className="flex items-center gap-3 px-4 py-3"
        style={{
          background: `color-mix(in srgb, var(--brand) 8%, white)`,
        }}
      >
        <span
          className="flex size-8 shrink-0 items-center justify-center rounded-full"
          style={{
            background: "var(--brand)",
            color: "var(--brand-foreground)",
          }}
        >
          <Link2 className="size-4" strokeWidth={1.75} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-zinc-900">{headline}</p>
          <p className="text-xs text-zinc-600">{subtitle}</p>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Cerrar"
          className="text-xs font-medium text-zinc-500 hover:text-zinc-900"
        >
          Cerrar
        </button>
      </div>

      <div className="grid gap-3 p-4">
        <div className="flex items-stretch gap-2">
          <code className="flex-1 overflow-hidden truncate rounded-xl bg-zinc-50 px-3 py-2.5 font-mono text-xs text-zinc-700 ring-1 ring-zinc-200/60">
            {link}
          </code>
          <button
            type="button"
            onClick={copy}
            className={cn(
              "inline-flex h-auto items-center gap-2 rounded-xl px-4 text-sm font-semibold transition",
              copied
                ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200"
                : "bg-zinc-900 text-zinc-50 hover:bg-zinc-800",
            )}
          >
            {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
            {copied ? "Copiado" : "Copiar"}
          </button>
        </div>
        <div className="flex flex-wrap gap-2">
          <a
            href={waHref}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 rounded-full bg-emerald-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-600"
          >
            <MessageCircle className="size-3.5" strokeWidth={2} />
            Compartir por WhatsApp
          </a>
        </div>
        <p className="text-[0.7rem] text-zinc-500">
          El link expira en unas horas. Si vence, generá otro.
        </p>
      </div>
    </div>
  );
}
