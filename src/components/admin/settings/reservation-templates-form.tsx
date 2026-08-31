"use client";

import { useEffect, useState } from "react";
import { Loader2, Save } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  listReservationTemplates,
  setReservationTemplate,
} from "@/lib/notifications/actions";
import {
  DEFAULT_RESERVATION_TEMPLATES,
  RESERVATION_EVENT_LABELS,
  RESERVATION_NOTIFY_EVENTS,
  type ReservationNotifyEvent,
} from "@/lib/notifications/reservation-templates";

type Row = {
  body: string;
  enabled: boolean;
  templateName: string;
  saving: boolean;
};

const PLACEHOLDERS = [
  "{cliente}",
  "{negocio}",
  "{fecha}",
  "{hora}",
  "{personas}",
];

/** Spec 132 — los cuatro avisos del ciclo de una solicitud de reserva. */
export function ReservationTemplatesForm({ slug }: { slug: string }) {
  const [rows, setRows] = useState<Record<string, Row>>(() =>
    Object.fromEntries(
      RESERVATION_NOTIFY_EVENTS.map((e) => [
        e,
        {
          body: DEFAULT_RESERVATION_TEMPLATES[e],
          enabled: true,
          templateName: "",
          saving: false,
        },
      ]),
    ),
  );
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await listReservationTemplates(slug);
      if (!cancelled && res.ok) {
        setRows((prev) => {
          const next = { ...prev };
          for (const t of res.data) {
            if (next[t.event]) {
              next[t.event] = {
                body: t.body,
                enabled: t.enabled,
                templateName: t.template_name ?? "",
                saving: false,
              };
            }
          }
          return next;
        });
      }
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [slug]);

  const patch = (event: string, partial: Partial<Row>) =>
    setRows((p) => ({ ...p, [event]: { ...p[event], ...partial } }));

  const save = async (event: ReservationNotifyEvent) => {
    const row = rows[event];
    if (!row || !row.body.trim()) {
      toast.error("El mensaje no puede estar vacío.");
      return;
    }
    patch(event, { saving: true });
    const res = await setReservationTemplate({
      businessSlug: slug,
      event,
      body: row.body,
      enabled: row.enabled,
      templateName: row.templateName.trim() || undefined,
    });
    patch(event, { saving: false });
    if (res.ok) {
      toast.success(`Plantilla "${RESERVATION_EVENT_LABELS[event]}" guardada`);
    } else {
      toast.error(res.error ?? "No pude guardar la plantilla");
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-zinc-500">
        <Loader2 className="size-4 animate-spin" /> Cargando plantillas…
      </div>
    );
  }

  return (
    <div className="grid gap-5">
      <p className="text-xs text-zinc-500">
        Variables disponibles:{" "}
        {PLACEHOLDERS.map((p) => (
          <code
            key={p}
            className="mr-1 rounded bg-zinc-100 px-1 py-0.5 text-[0.7rem]"
          >
            {p}
          </code>
        ))}
        <code className="mr-1 rounded bg-zinc-100 px-1 py-0.5 text-[0.7rem]">
          {"{motivo}"}
        </code>
        (sólo en el rechazo)
      </p>

      {RESERVATION_NOTIFY_EVENTS.map((event) => {
        const row = rows[event];
        return (
          <div
            key={event}
            className="grid gap-2 rounded-xl border border-zinc-200 p-4"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-zinc-900">
                {RESERVATION_EVENT_LABELS[event]}
              </h3>
              <label className="flex items-center gap-1.5 text-xs text-zinc-600">
                <input
                  type="checkbox"
                  checked={row.enabled}
                  onChange={(e) => patch(event, { enabled: e.target.checked })}
                  className="size-3.5"
                />
                Enviar este aviso
              </label>
            </div>
            <Textarea
              value={row.body}
              onChange={(e) => patch(event, { body: e.target.value })}
              rows={2}
              className="text-sm"
            />
            <Input
              value={row.templateName}
              onChange={(e) => patch(event, { templateName: e.target.value })}
              placeholder="Nombre del template aprobado en Meta (ej: reserva_confirmada)"
              className="text-xs"
            />
            <div className="flex justify-end">
              <Button
                size="sm"
                className="h-8 gap-1.5"
                onClick={() => save(event)}
                disabled={row.saving}
              >
                {row.saving ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Save className="size-3.5" />
                )}
                Guardar
              </Button>
            </div>
          </div>
        );
      })}
      <p className="text-xs text-zinc-400">
        Destildar «Enviar este aviso» apaga ese evento en{" "}
        <strong>todos</strong> los canales, también el mail.
      </p>
      <p className="text-xs text-zinc-400">
        Sin nombre de <strong>template aprobado en Meta</strong> el aviso sale
        sólo por mail: un mensaje proactivo de WhatsApp fuera de la ventana de
        24&nbsp;h necesita template. Sus parámetros son posicionales:{" "}
        <code>{"{{1}}"}</code> = cliente, <code>{"{{2}}"}</code> = día y hora.
      </p>
    </div>
  );
}
