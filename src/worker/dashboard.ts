import { Hono } from "hono";
import type { AppEnv } from "./types";

type Trip = { id: number; date_from: string; date_to: string; km: number | null; job_id: number | null; car_id: number | null };

const dayMs = 86400000;
const toDay = (s: string) => Date.parse(s.slice(0, 10) + "T00:00:00Z");

// km of a trip that falls inside [from, to], spread evenly over the trip's days
function kmInPeriod(t: Trip, from: string, to: string) {
  if (!t.km) return 0;
  const a = toDay(t.date_from);
  const b = toDay(t.date_to || t.date_from);
  const days = Math.round((b - a) / dayMs) + 1;
  const lo = Math.max(a, toDay(from));
  const hi = Math.min(b, toDay(to));
  if (hi < lo) return 0;
  return (t.km * (Math.round((hi - lo) / dayMs) + 1)) / days;
}

export const dashboardRoutes = new Hono<AppEnv>();

// /api/dashboard?from=2026-10-01&to=2026-10-31
dashboardRoutes.get("/", async (c) => {
  const db = c.env.DB;
  const from = c.req.query("from") ?? "0000-01-01";
  const to = c.req.query("to") ?? "9999-12-31";

  const [money, debts, perJobMoney, perJobHours, attendance, trips, fuelIn, carTrips, counts] = await db.batch([
    db.prepare(
      `SELECT direction, SUM(amount) AS total FROM ledger_entry WHERE realized_on BETWEEN ? AND ? GROUP BY direction`
    ).bind(from, to),
    db.prepare(
      `SELECT direction, SUM(amount) AS total, COUNT(*) AS n FROM ledger_entry WHERE paid_on IS NULL GROUP BY direction`
    ),
    db.prepare(
      `SELECT s.job_id, e.direction, SUM(s.amount) AS total FROM ledger_split s JOIN ledger_entry e ON e.id = s.entry_id
       WHERE e.realized_on BETWEEN ? AND ? GROUP BY s.job_id, e.direction`
    ).bind(from, to),
    db.prepare(
      `SELECT job_id, SUM(hours) AS hours FROM attendance WHERE realized_on BETWEEN ? AND ? GROUP BY job_id`
    ).bind(from, to),
    db.prepare(
      `SELECT person_id, person_name, job_id, job_title, activity_type, SUM(hours) AS hours, COUNT(DISTINCT realized_on) AS days
       FROM v_attendance WHERE realized_on BETWEEN ? AND ? GROUP BY person_id, job_id, activity_type ORDER BY person_name, job_title`
    ).bind(from, to),
    db.prepare(`SELECT id, date_from, date_to, km, job_id, car_id FROM trip WHERE date_from <= ? AND date_to >= ?`).bind(to, from),
    db.prepare(`SELECT car_id, SUM(km_range) AS km FROM refuel GROUP BY car_id`),
    db.prepare(`SELECT car_id, SUM(km) AS km FROM trip GROUP BY car_id`),
    db.prepare(
      `SELECT
         (SELECT COUNT(*) FROM job WHERE is_active = 1) AS active_jobs,
         (SELECT COUNT(*) FROM todo WHERE done = 0) AS open_todos,
         (SELECT COUNT(*) FROM invoice WHERE paid_on IS NULL AND due_on < date('now')) AS overdue_invoices`
    ),
  ]);

  type R = Record<string, number | string | null>;
  const jobIds = new Set<number>();
  const perJob = new Map<number | null, { income: number; expense: number; hours: number; km: number }>();
  const get = (id: number | null) => {
    if (!perJob.has(id)) perJob.set(id, { income: 0, expense: 0, hours: 0, km: 0 });
    if (id) jobIds.add(id);
    return perJob.get(id)!;
  };
  for (const r of perJobMoney.results as R[]) get(r.job_id as number | null)[r.direction as "income" | "expense"] += Number(r.total);
  for (const r of perJobHours.results as R[]) get(r.job_id as number | null).hours += Number(r.hours);
  let kmTotal = 0;
  for (const t of trips.results as Trip[]) {
    const km = kmInPeriod(t, from, to);
    kmTotal += km;
    get(t.job_id).km += km;
  }

  const jobs = jobIds.size
    ? (
        await db
          .prepare(`SELECT id, title, customer_name, status, status_color, is_active FROM v_job WHERE id IN (${[...jobIds].join(",")})`)
          .all<R>()
      ).results
    : [];
  const jobById = new Map(jobs.map((j) => [j.id as number, j]));

  const cars = (await db.prepare("SELECT id, label FROM codelist WHERE type = 'car'").all<{ id: number; label: string }>()).results;
  const fuel = cars.map((car) => {
    const added = Number((fuelIn.results as R[]).find((r) => r.car_id === car.id)?.km ?? 0);
    const used = Number((carTrips.results as R[]).find((r) => r.car_id === car.id)?.km ?? 0);
    return { car_id: car.id, car: car.label, added, used, balance: added - used };
  });

  const sum = (rows: R[], dir: string) => Number(rows.find((r) => r.direction === dir)?.total ?? 0);
  return c.json({
    from,
    to,
    totals: {
      income: sum(money.results as R[], "income"),
      expense: sum(money.results as R[], "expense"),
      receivable: sum(debts.results as R[], "income"),
      payable: sum(debts.results as R[], "expense"),
      hours: [...perJob.values()].reduce((a, v) => a + v.hours, 0),
      km: Math.round(kmTotal * 10) / 10,
      ...(counts.results[0] as R),
    },
    per_job: [...perJob.entries()]
      .map(([id, v]) => ({
        job_id: id,
        title: id ? (jobById.get(id)?.title ?? `#${id}`) : "(bez zákazky)",
        customer_name: id ? jobById.get(id)?.customer_name : null,
        status: id ? jobById.get(id)?.status : null,
        status_color: id ? jobById.get(id)?.status_color : null,
        ...v,
        km: Math.round(v.km * 10) / 10,
        profit: v.income - v.expense,
      }))
      .sort((a, b) => b.hours + b.income - (a.hours + a.income)),
    attendance: attendance.results,
    fuel,
  });
});

// All active jobs and leads with their latest comment, regardless of the period
dashboardRoutes.get("/active", async (c) => {
  const jobs = await c.env.DB.prepare(
    `SELECT id, title, customer_name, status, status_color, is_lead, last_activity_at,
       (SELECT text FROM comment WHERE entity_type = 'job' AND entity_id = v_job.id ORDER BY created_at DESC LIMIT 1) AS last_comment,
       (SELECT created_at FROM comment WHERE entity_type = 'job' AND entity_id = v_job.id ORDER BY created_at DESC LIMIT 1) AS last_comment_at
     FROM v_job WHERE is_active = 1 AND status_active = 1 ORDER BY created_at DESC`
  ).all<{ is_lead: number }>();
  return c.json({
    active_jobs: jobs.results.filter((j) => !j.is_lead),
    active_leads: jobs.results.filter((j) => j.is_lead),
  });
});
