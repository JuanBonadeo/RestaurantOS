import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { createSupabaseServiceClient } from "@/lib/supabase/service";

// Post-migration types not yet regenerated; cast to bypass strict table checks.
// Remove after running `pnpm db:types` against a DB with 0045_rrhh applied.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>;
const db = () => createSupabaseServiceClient() as unknown as AnyClient;

export type ClockEntry = {
  id: string;
  userId: string;
  name: string;
  role: string;
  clockIn: string;
  clockOut: string | null;
  durationMinutes: number | null;
};

export async function getClockHistory(
  businessId: string,
  opts?: { from?: string; to?: string; userId?: string; limit?: number },
): Promise<ClockEntry[]> {
  const service = db();

  let query = service
    .from("clock_entries")
    .select("id, user_id, clock_in, clock_out, duration_minutes")
    .eq("business_id", businessId)
    .order("clock_in", { ascending: false })
    .limit(opts?.limit ?? 100);

  if (opts?.from) query = query.gte("clock_in", opts.from);
  if (opts?.to) query = query.lte("clock_in", opts.to);
  if (opts?.userId) query = query.eq("user_id", opts.userId);

  const { data: entries } = await query;
  if (!entries || entries.length === 0) return [];

  const userIds = [...new Set(entries.map((e) => e.user_id))];
  const { data: members } = await service
    .from("business_users")
    .select("user_id, full_name, role")
    .eq("business_id", businessId)
    .in("user_id", userIds);

  const memberMap = new Map(
    (members ?? []).map((m) => [m.user_id, m]),
  );

  return entries.map((e) => {
    const m = memberMap.get(e.user_id);
    return {
      id: e.id,
      userId: e.user_id,
      name: m?.full_name ?? "—",
      role: m?.role ?? "personal",
      clockIn: e.clock_in,
      clockOut: e.clock_out,
      durationMinutes: e.duration_minutes,
    };
  });
}

export type TodaySummary = {
  present: ClockEntry[];
  finished: ClockEntry[];
  absent: { userId: string; name: string; role: string }[];
};

export async function getTodaySummary(
  businessId: string,
  timezone: string = "America/Argentina/Buenos_Aires",
): Promise<TodaySummary> {
  const service = db();

  const now = new Date();
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const todayStr = formatter.format(now);
  const dayStart = new Date(`${todayStr}T00:00:00`);

  const { data: entries } = await service
    .from("clock_entries")
    .select("id, user_id, clock_in, clock_out, duration_minutes")
    .eq("business_id", businessId)
    .gte("clock_in", dayStart.toISOString())
    .order("clock_in", { ascending: true });

  const { data: allMembers } = await service
    .from("business_users")
    .select("user_id, full_name, role")
    .eq("business_id", businessId)
    .is("disabled_at", null);

  const memberMap = new Map(
    (allMembers ?? []).map((m) => [m.user_id, m]),
  );

  const present: ClockEntry[] = [];
  const finished: ClockEntry[] = [];
  const clockedUserIds = new Set<string>();

  for (const e of entries ?? []) {
    const m = memberMap.get(e.user_id);
    const entry: ClockEntry = {
      id: e.id,
      userId: e.user_id,
      name: m?.full_name ?? "—",
      role: m?.role ?? "personal",
      clockIn: e.clock_in,
      clockOut: e.clock_out,
      durationMinutes: e.duration_minutes,
    };
    clockedUserIds.add(e.user_id);
    if (!e.clock_out) present.push(entry);
    else finished.push(entry);
  }

  // La `terminal` (spec 140) no ficha: es la PC compartida del salón, no una
  // persona. Listarla en «sin fichar» sería pedirle asistencia a un mueble —
  // los que fichan desde ella son los mozos, cada uno con su PIN.
  const absent = (allMembers ?? [])
    .filter((m) => m.role !== "terminal")
    .filter((m) => !clockedUserIds.has(m.user_id))
    .map((m) => ({
      userId: m.user_id,
      name: m.full_name ?? "—",
      role: m.role ?? "personal",
    }));

  return { present, finished, absent };
}

export type MonthlySummaryRow = {
  userId: string;
  name: string;
  role: string;
  totalMinutes: number;
  daysWorked: number;
  avgMinutesPerDay: number;
  lastClockIn: string | null;
};

export type MonthlyDailyTotal = {
  date: string;
  totalMinutes: number;
  employeesCount: number;
};

export type MonthlyOverview = {
  rangeStart: string;
  rangeEnd: string;
  totalMinutes: number;
  activeEmployees: number;
  daysWithActivity: number;
  perEmployee: MonthlySummaryRow[];
  dailyTotals: MonthlyDailyTotal[];
};

export async function getMonthlyOverview(
  businessId: string,
  monthStart: Date,
): Promise<MonthlyOverview> {
  const service = db();

  const monthEnd = new Date(monthStart);
  monthEnd.setMonth(monthEnd.getMonth() + 1);

  const { data: entries } = await service
    .from("clock_entries")
    .select("user_id, clock_in, clock_out, duration_minutes")
    .eq("business_id", businessId)
    .gte("clock_in", monthStart.toISOString())
    .lt("clock_in", monthEnd.toISOString())
    .order("clock_in", { ascending: true });

  const rangeStart = monthStart.toISOString();
  const rangeEnd = monthEnd.toISOString();

  if (!entries || entries.length === 0) {
    return {
      rangeStart,
      rangeEnd,
      totalMinutes: 0,
      activeEmployees: 0,
      daysWithActivity: 0,
      perEmployee: [],
      dailyTotals: [],
    };
  }

  const userIds = [...new Set(entries.map((e) => e.user_id))];
  const { data: members } = await service
    .from("business_users")
    .select("user_id, full_name, role")
    .eq("business_id", businessId)
    .in("user_id", userIds);

  const memberMap = new Map(
    (members ?? []).map((m) => [m.user_id, m]),
  );

  // Per-employee aggregation
  const empAgg = new Map<
    string,
    {
      totalMinutes: number;
      days: Set<string>;
      lastClockIn: string;
    }
  >();
  // Per-day aggregation (across all employees)
  const dayAgg = new Map<
    string,
    { totalMinutes: number; users: Set<string> }
  >();

  let grandTotalMinutes = 0;

  for (const e of entries) {
    // Use clock_in or fallback to wallclock duration (in-progress entries
    // count as zero for monthly view since clock_out is null).
    const minutes = e.duration_minutes ?? 0;
    const day = e.clock_in.slice(0, 10);

    grandTotalMinutes += minutes;

    const empExisting = empAgg.get(e.user_id) ?? {
      totalMinutes: 0,
      days: new Set<string>(),
      lastClockIn: e.clock_in,
    };
    empExisting.totalMinutes += minutes;
    empExisting.days.add(day);
    if (new Date(e.clock_in) > new Date(empExisting.lastClockIn)) {
      empExisting.lastClockIn = e.clock_in;
    }
    empAgg.set(e.user_id, empExisting);

    const dayExisting = dayAgg.get(day) ?? {
      totalMinutes: 0,
      users: new Set<string>(),
    };
    dayExisting.totalMinutes += minutes;
    dayExisting.users.add(e.user_id);
    dayAgg.set(day, dayExisting);
  }

  const perEmployee: MonthlySummaryRow[] = Array.from(empAgg.entries())
    .map(([userId, stats]) => {
      const m = memberMap.get(userId);
      return {
        userId,
        name: m?.full_name ?? "—",
        role: m?.role ?? "personal",
        totalMinutes: stats.totalMinutes,
        daysWorked: stats.days.size,
        avgMinutesPerDay:
          stats.days.size > 0
            ? Math.round(stats.totalMinutes / stats.days.size)
            : 0,
        lastClockIn: stats.lastClockIn,
      };
    })
    .sort((a, b) => b.totalMinutes - a.totalMinutes);

  const dailyTotals: MonthlyDailyTotal[] = Array.from(dayAgg.entries())
    .map(([date, stats]) => ({
      date,
      totalMinutes: stats.totalMinutes,
      employeesCount: stats.users.size,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return {
    rangeStart,
    rangeEnd,
    totalMinutes: grandTotalMinutes,
    activeEmployees: empAgg.size,
    daysWithActivity: dayAgg.size,
    perEmployee,
    dailyTotals,
  };
}

export type WeeklySummaryRow = {
  userId: string;
  name: string;
  role: string;
  totalMinutes: number;
  daysWorked: number;
};

export async function getWeeklySummary(
  businessId: string,
  weekStart: Date,
): Promise<WeeklySummaryRow[]> {
  const service = db();

  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 7);

  const { data: entries } = await service
    .from("clock_entries")
    .select("user_id, clock_in, duration_minutes")
    .eq("business_id", businessId)
    .gte("clock_in", weekStart.toISOString())
    .lt("clock_in", weekEnd.toISOString())
    .not("clock_out", "is", null);

  if (!entries || entries.length === 0) return [];

  const userIds = [...new Set(entries.map((e) => e.user_id))];
  const { data: members } = await service
    .from("business_users")
    .select("user_id, full_name, role")
    .eq("business_id", businessId)
    .in("user_id", userIds);

  const memberMap = new Map(
    (members ?? []).map((m) => [m.user_id, m]),
  );

  const agg = new Map<string, { totalMinutes: number; days: Set<string> }>();

  for (const e of entries) {
    const existing = agg.get(e.user_id) ?? {
      totalMinutes: 0,
      days: new Set<string>(),
    };
    existing.totalMinutes += e.duration_minutes ?? 0;
    existing.days.add(e.clock_in.slice(0, 10));
    agg.set(e.user_id, existing);
  }

  return Array.from(agg.entries()).map(([userId, stats]) => {
    const m = memberMap.get(userId);
    return {
      userId,
      name: m?.full_name ?? "—",
      role: m?.role ?? "personal",
      totalMinutes: stats.totalMinutes,
      daysWorked: stats.days.size,
    };
  });
}
