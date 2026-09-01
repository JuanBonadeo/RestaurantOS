import { notFound } from "next/navigation";

import { CustomersListClient } from "@/components/admin/customers/customers-list-client";
import { AyudaChip } from "@/components/admin/ayuda-chip";
import { PageShell } from "@/components/admin/shell/page-shell";
import { ensureAdminAccess } from "@/lib/admin/context";
import {
  listCustomers,
  type CustomerListSort,
} from "@/lib/admin/customers-query";
import type { CustomerSegment } from "@/lib/customers/segments";
import { getBusiness } from "@/lib/tenant";

export const dynamic = "force-dynamic";

const VALID_SEGMENTS: (CustomerSegment | "all")[] = [
  "all",
  "new",
  "frequent",
  "top",
  "inactive",
  "lost",
  "regular",
];
const VALID_SORTS: CustomerListSort[] = ["spent", "orders", "recent", "name"];

function pickEnum<T extends string>(
  value: string | undefined,
  allowed: readonly T[],
  fallback: T,
): T {
  if (!value) return fallback;
  return (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

export default async function CustomersPage({
  params,
  searchParams,
}: {
  params: Promise<{ business_slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { business_slug } = await params;
  const business = await getBusiness(business_slug);
  if (!business) notFound();
  await ensureAdminAccess(business.id, business_slug);

  const sp = await searchParams;
  const get = (k: string) => {
    const v = sp[k];
    return Array.isArray(v) ? v[0] : v;
  };

  const segment = pickEnum(get("segment"), VALID_SEGMENTS, "all");
  const sort = pickEnum(get("sort"), VALID_SORTS, "spent");
  const search = (get("q") ?? "").trim();
  const pageRaw = Number(get("page") ?? 1);
  const page = Number.isFinite(pageRaw) && pageRaw > 0 ? Math.floor(pageRaw) : 1;

  const result = await listCustomers(business.id, {
    segment,
    sort,
    search,
    page,
    limit: 24,
  });

  return (
    <PageShell width="wide" className="space-y-6">
      <header className="flex flex-col gap-2">
        <p className="text-[0.65rem] font-semibold uppercase tracking-[0.18em] text-zinc-500">
          Clientes
        </p>
        <div className="flex items-center gap-1">
          <h1 className="text-3xl font-semibold tracking-tight text-zinc-900">
            Tus clientes
          </h1>
          <AyudaChip slug={business_slug} tema="clientes" />
        </div>
        <p className="text-sm text-zinc-600">
          Quién compra, cuánto gasta y cuándo fue su último pedido. Los segmentos se calculan automáticamente.
        </p>
      </header>

      <CustomersListClient
        slug={business_slug}
        initialResult={result}
        initialFilters={{ segment, sort, search }}
      />
    </PageShell>
  );
}
