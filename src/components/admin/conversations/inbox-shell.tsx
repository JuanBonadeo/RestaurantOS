"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { formatInTimeZone } from "date-fns-tz";
import { es } from "date-fns/locale";
import { Bot, Hand } from "lucide-react";

import type { InboxListItem } from "@/lib/chatbot/inbox-query";
import { cn } from "@/lib/utils";

import { getInitials } from "./wa-thread";
import { AyudaChip } from "@/components/admin/ayuda-chip";

const POLL_MS = 10_000;

// Bandeja estilo "WhatsApp Web" dentro del panel (spec 32): lista a la
// izquierda, conversación a la derecha. Refresca por polling (`router.refresh`
// re-ejecuta los server components de la ruta y baja datos frescos sin Realtime
// — las tablas chatbot_* siguen service-role-only). En mobile colapsa a una
// sola columna según haya o no conversación abierta.
export function InboxShell({
  slug,
  timezone,
  conversations,
  children,
}: {
  slug: string;
  timezone: string;
  conversations: InboxListItem[];
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    const id = setInterval(() => router.refresh(), POLL_MS);
    return () => clearInterval(id);
  }, [router]);

  const base = `/${slug}/admin/conversaciones`;
  const activeId = pathname.startsWith(`${base}/`)
    ? pathname.slice(base.length + 1).split("/")[0]
    : null;
  const hasDetail = Boolean(activeId);

  return (
    <div className="flex h-[100dvh] overflow-hidden bg-white">
      <aside
        className={cn(
          "w-full flex-col border-r border-zinc-200 md:flex md:w-80 lg:w-96",
          hasDetail ? "hidden md:flex" : "flex",
        )}
      >
        <header className="flex shrink-0 items-center justify-between border-b border-zinc-200 px-4 py-3">
          <h1 className="flex items-center gap-1 text-base font-semibold text-zinc-900">
            Conversaciones
            <AyudaChip slug={slug} tema="conversaciones" />
          </h1>
          <span className="text-[0.7rem] text-zinc-400">{conversations.length}</span>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {conversations.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-zinc-500">
              No hay conversaciones todavía.
            </p>
          ) : (
            <ul>
              {conversations.map((c) => (
                <ConversationRow
                  key={c.conversation_id}
                  base={base}
                  timezone={timezone}
                  conv={c}
                  active={c.conversation_id === activeId}
                />
              ))}
            </ul>
          )}
        </div>
      </aside>

      <main
        className={cn(
          "min-w-0 flex-1",
          hasDetail ? "flex" : "hidden md:flex",
        )}
      >
        {children}
      </main>
    </div>
  );
}

function ConversationRow({
  base,
  timezone,
  conv,
  active,
}: {
  base: string;
  timezone: string;
  conv: InboxListItem;
  active: boolean;
}) {
  const title = conv.contact_display_name?.trim() || conv.contact_identifier;
  const when = formatInTimeZone(conv.updated_at, timezone, "d/MM HH:mm", {
    locale: es,
  });
  const previewPrefix =
    conv.last_message_role === "assistant"
      ? conv.last_message_sent_by === "staff"
        ? "Vos: "
        : "Bot: "
      : "";

  return (
    <li>
      <Link
        href={`${base}/${conv.conversation_id}`}
        className={cn(
          "flex items-center gap-3 border-b border-zinc-100 px-4 py-3 transition",
          active ? "bg-zinc-100" : "hover:bg-zinc-50",
        )}
      >
        <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-zinc-200 text-sm font-semibold text-zinc-600">
          {getInitials(title)}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <p className="truncate text-sm font-medium text-zinc-900">{title}</p>
            <span className="shrink-0 text-[0.65rem] text-zinc-400">{when}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <p className="min-w-0 flex-1 truncate text-xs text-zinc-500">
              {conv.last_message_preview
                ? `${previewPrefix}${conv.last_message_preview}`
                : "Sin mensajes"}
            </p>
            <AgentBadge enabled={conv.agent_enabled} />
          </div>
        </div>
      </Link>
    </li>
  );
}

function AgentBadge({ enabled }: { enabled: boolean }) {
  return enabled ? (
    <span
      title="El agente (bot) atiende esta conversación"
      className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-emerald-50 px-1.5 py-0.5 text-[0.6rem] font-medium text-emerald-700"
    >
      <Bot className="size-3" /> Bot
    </span>
  ) : (
    <span
      title="La atiende un humano"
      className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-amber-50 px-1.5 py-0.5 text-[0.6rem] font-medium text-amber-700"
    >
      <Hand className="size-3" /> Humano
    </span>
  );
}
