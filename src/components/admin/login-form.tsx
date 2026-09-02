"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
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
import { signIn } from "@/lib/auth/sign-in";

const Schema = z.object({
  // Spec 142: email o PIN de 4 dígitos. El formato lo decide
  // `parseIdentificador` en el server; acá sólo se exige que haya algo, para
  // que un PIN no rebote antes de salir del navegador.
  email: z.string().min(1, "Poné tu email o tu PIN."),
  password: z.string().min(1, "Ingresá la contraseña."),
});

type Values = z.infer<typeof Schema>;

export function LoginForm({ slug }: { slug: string }) {
  const [submitting, setSubmitting] = useState(false);
  const form = useForm<Values>({
    resolver: zodResolver(Schema),
    defaultValues: { email: "", password: "" },
  });

  const onSubmit = async (values: Values) => {
    setSubmitting(true);
    try {
      const result = await signIn({ business_slug: slug, ...values });
      // signIn redirects on success; reaching here means failure
      if (result && !result.ok) toast.error(result.error);
    } catch (err) {
      // Next.js throws a redirect error on success — rethrow it.
      if (
        err instanceof Error &&
        "digest" in err &&
        typeof err.digest === "string" &&
        err.digest.startsWith("NEXT_REDIRECT")
      ) {
        throw err;
      }
      console.error(err);
      toast.error("No pudimos iniciar sesión.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-5">
        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Email o PIN</FormLabel>
              <FormControl>
                {/* `type="text"`, no `email`: el navegador rechazaría "1234"
                    por no tener arroba. `autoComplete="username"` porque eso
                    es lo que es ahora — un identificador, no una casilla. */}
                <Input
                  type="text"
                  inputMode="text"
                  autoComplete="username"
                  autoFocus
                  placeholder="tu@email.com o tus 4 dígitos"
                  {...field}
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
                <Input
                  type="password"
                  autoComplete="current-password"
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button type="submit" size="lg" disabled={submitting}>
          {submitting ? "Entrando…" : "Entrar"}
        </Button>
      </form>
    </Form>
  );
}
