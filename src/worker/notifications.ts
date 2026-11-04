import { Hono } from "hono";
import type { AppEnv } from "./types";

type Rule = { id: number; name: string; kind: string; params: string; enabled: number; created_at: string };
type Generated = { key: string; text: string; due_on?: string; links: { entity_type: string; entity_id: number }[] };

const iso = (d: Date) => d.toISOString().slice(0, 10);
const sk = (day: string) => day.slice(0, 10).split("-").reverse().map(Number).join(".");
const daysAgo = (n: number) => iso(new Date(Date.now() - n * 86400000));

// Each rule kind returns the todos it wants to exist; duplicates are ignored by source_key
const generators: Record<string, (db: D1Database, rule: Rule, p: Record<string, unknown>) => Promise<Generated[]>> = {
  async missing_attendance(db, rule, p) {
    const lookback = Number(p.lookback_days ?? 14);
    const since = String(p.since ?? rule.created_at.slice(0, 10));
    const me = await db.prepare("SELECT value FROM setting WHERE key = 'self_person_id'").first<{ value: string }>();
    const rows = await db
      .prepare(`SELECT DISTINCT realized_on FROM attendance WHERE realized_on >= ? ${me?.value ? "AND (person_id = ? OR person_id IS NULL)" : ""}`)
      .bind(...[daysAgo(lookback), ...(me?.value ? [me.value] : [])])
      .all<{ realized_on: string }>();
    const have = new Set(rows.results.map((r) => r.realized_on));
    const out: Generated[] = [];
    for (let i = 1; i <= lookback; i++) {
      const d = new Date(Date.now() - i * 86400000);
      const day = iso(d);
      const wd = d.getUTCDay();
      if (wd === 0 || wd === 6 || day < since || have.has(day)) continue;
      out.push({ key: `missing_attendance:${day}`, text: `Zapísať dochádzku za ${sk(day)}`, due_on: day, links: [] });
    }
    return out;
  },
  async overdue_invoice(db, _rule, p) {
    const days = Number(p.days ?? 7);
    const rows = await db
      .prepare("SELECT id, number, customer_name, amount, due_on FROM v_invoice WHERE paid_on IS NULL AND due_on IS NOT NULL AND due_on < ? AND COALESCE(amount, 0) > 0")
      .bind(daysAgo(days))
      .all<{ id: number; number: string; customer_name: string; amount: number; due_on: string }>();
    return rows.results.map((r) => ({
      key: `overdue_invoice:${r.id}`,
      text: `Faktúra ${r.number} (${r.customer_name ?? "?"}, ${r.amount} €) je po splatnosti od ${sk(r.due_on)}`,
      links: [{ entity_type: "invoice", entity_id: r.id }],
    }));
  },
  async stale_job(db, _rule, p) {
    const days = Number(p.days ?? 30);
    const cutoff = daysAgo(days);
    const rows = await db
      .prepare("SELECT id, title, customer_name, last_activity_at FROM v_job WHERE is_active = 1 AND status_active = 1 AND last_activity_at < ?")
      .bind(cutoff)
      .all<{ id: number; title: string; customer_name: string; last_activity_at: string }>();
    // One todo per job per period, so it comes back if the job stays untouched
    const period = Math.floor(Date.now() / (days * 86400000));
    return rows.results.map((r) => ({
      key: `stale_job:${r.id}:${period}`,
      text: `Zákazka „${r.title}“ (${r.customer_name ?? "?"}) je bez pohybu od ${sk(r.last_activity_at)}`,
      links: [{ entity_type: "job", entity_id: r.id }],
    }));
  },
  // User-written query: SELECT returning title [, entity_type, entity_id, key, due_on]
  async sql(db, rule, p) {
    const q = String(p.query ?? "").trim().replace(/;+\s*$/, "");
    if (!/^(select|with)\b/i.test(q) || q.includes(";")) throw new Error("Dotaz musí byť jeden SELECT");
    const rows = await db.prepare(q).all<Record<string, unknown>>();
    return rows.results.map((r) => ({
      key: `sql:${rule.id}:${r.key ?? (r.entity_type ? `${r.entity_type}:${r.entity_id}` : r.title)}`,
      text: String(r.title ?? r.text ?? JSON.stringify(r)),
      due_on: r.due_on ? String(r.due_on) : undefined,
      links: r.entity_type && r.entity_id ? [{ entity_type: String(r.entity_type), entity_id: Number(r.entity_id) }] : [],
    }));
  },
};

export async function runRules(db: D1Database, onlyId?: number) {
  const rules = await db.prepare(`SELECT * FROM notification_rule WHERE enabled = 1 ${onlyId ? "AND id = ?" : ""}`)
    .bind(...(onlyId ? [onlyId] : []))
    .all<Rule>();
  const report: { rule: string; created: number; error?: string }[] = [];
  for (const rule of rules.results) {
    const gen = generators[rule.kind];
    if (!gen) continue;
    try {
      const items = await gen(db, rule, JSON.parse(rule.params || "{}"));
      let created = 0;
      for (const it of items) {
        const row = await db
          .prepare("INSERT INTO todo (text, due_on, source_key, rule_id) VALUES (?, ?, ?, ?) ON CONFLICT(source_key) DO NOTHING RETURNING id")
          .bind(it.text, it.due_on ?? null, it.key, rule.id)
          .first<{ id: number }>();
        if (!row) continue;
        created++;
        for (const l of it.links)
          await db.prepare("INSERT OR IGNORE INTO todo_link (todo_id, entity_type, entity_id) VALUES (?, ?, ?)").bind(row.id, l.entity_type, l.entity_id).run();
      }
      await db.prepare("UPDATE notification_rule SET last_run_at = ? WHERE id = ?").bind(new Date().toISOString(), rule.id).run();
      report.push({ rule: rule.name, created });
    } catch (e) {
      report.push({ rule: rule.name, created: 0, error: String(e instanceof Error ? e.message : e) });
    }
  }
  return report;
}

export const notificationRoutes = new Hono<AppEnv>();

notificationRoutes.get("/rules", async (c) => {
  const rows = await c.env.DB.prepare("SELECT * FROM notification_rule ORDER BY id").all<Rule>();
  return c.json(rows.results.map((r) => ({ ...r, params: JSON.parse(r.params || "{}") })));
});

notificationRoutes.post("/rules", async (c) => {
  const d = await c.req.json<{ name: string; kind: string; params?: unknown }>();
  if (!generators[d.kind]) return c.json({ error: "Neznámy typ pravidla" }, 400);
  const row = await c.env.DB.prepare("INSERT INTO notification_rule (name, kind, params) VALUES (?, ?, ?) RETURNING id")
    .bind(d.name, d.kind, JSON.stringify(d.params ?? {}))
    .first();
  return c.json(row, 201);
});

notificationRoutes.patch("/rules/:id", async (c) => {
  const d = await c.req.json<{ name?: string; params?: unknown; enabled?: boolean }>();
  const id = c.req.param("id");
  if (d.name !== undefined) await c.env.DB.prepare("UPDATE notification_rule SET name = ? WHERE id = ?").bind(d.name, id).run();
  if (d.params !== undefined) await c.env.DB.prepare("UPDATE notification_rule SET params = ? WHERE id = ?").bind(JSON.stringify(d.params), id).run();
  if (d.enabled !== undefined) await c.env.DB.prepare("UPDATE notification_rule SET enabled = ? WHERE id = ?").bind(d.enabled ? 1 : 0, id).run();
  return c.json({ ok: true });
});

notificationRoutes.delete("/rules/:id", async (c) => {
  await c.env.DB.prepare("DELETE FROM notification_rule WHERE id = ?").bind(c.req.param("id")).run();
  return c.json({ ok: true });
});

notificationRoutes.post("/run", async (c) => {
  const id = c.req.query("rule_id");
  return c.json(await runRules(c.env.DB, id ? Number(id) : undefined));
});

// Information panels: active jobs and active leads with their latest comment
notificationRoutes.get("/overview", async (c) => {
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
