import { Hono } from "hono";
import type { AppEnv } from "./types";

type Rule = { id: number; name: string; kind: string; params: string; enabled: number; created_at: string };
type Generated = { key: string; text: string; due_on?: string; links: { entity_type: string; entity_id: number }[] };

const iso = (d: Date) => d.toISOString().slice(0, 10);
const sk = (day: string) => day.slice(0, 10).split("-").reverse().map(Number).join(".");
const daysAgo = (n: number) => iso(new Date(Date.now() - n * 86400000));

const inDays = (n: number) => iso(new Date(Date.now() + n * 86400000));
const eur = (n: number) => `${Math.round(n * 100) / 100} €`;

// A parameter the user can set on a rule. The editor renders it from this description.
type ParamDef = {
  key: string;
  label: string;
  type: "number" | "select" | "boolean" | "sql";
  default: number | string | boolean;
  min?: number;
  unit?: string;
  options?: { value: string; label: string }[];
};
type Params = Record<string, number | string | boolean>;
type Kind = {
  label: string;
  description: string;
  params: ParamDef[];
  // Returns the todos the rule wants to exist; duplicates are ignored by source_key
  run: (db: D1Database, rule: Rule, p: Params) => Promise<Generated[]>;
};

const days = (label: string, def: number): ParamDef => ({ key: "days", label, type: "number", default: def, min: 0, unit: "dní" });
const minAmount: ParamDef = { key: "min_amount", label: "Iba od sumy", type: "number", default: 0, min: 0, unit: "€" };

export const kinds: Record<string, Kind> = {
  missing_attendance: {
    label: "Chýbajúca dochádzka",
    description: "Pripomenie deň, za ktorý nie je zapísaná dochádzka.",
    params: [
      { key: "lookback_days", label: "Kontrolovať posledných", type: "number", default: 14, min: 1, unit: "dní" },
      { key: "include_saturday", label: "Počítať aj soboty", type: "boolean", default: false },
    ],
    async run(db, rule, p) {
      const lookback = Number(p.lookback_days);
      const since = rule.created_at.slice(0, 10);
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
        if (wd === 0 || (wd === 6 && !p.include_saturday) || day < since || have.has(day)) continue;
        out.push({ key: `missing_attendance:${day}`, text: `Zapísať dochádzku za ${sk(day)}`, due_on: day, links: [] });
      }
      return out;
    },
  },
  overdue_invoice: {
    label: "Faktúra po splatnosti",
    description: "Vystavená faktúra, ktorá nie je uhradená ani po splatnosti.",
    params: [days("Dní po splatnosti", 7), minAmount],
    async run(db, _rule, p) {
      const rows = await db
        .prepare("SELECT id, number, customer_name, amount, due_on FROM v_invoice WHERE paid_on IS NULL AND due_on IS NOT NULL AND due_on < ? AND COALESCE(amount, 0) > 0 AND COALESCE(amount, 0) >= ?")
        .bind(daysAgo(Number(p.days)), Number(p.min_amount))
        .all<{ id: number; number: string; customer_name: string; amount: number; due_on: string }>();
      return rows.results.map((r) => ({
        key: `overdue_invoice:${r.id}`,
        text: `Faktúra ${r.number} (${r.customer_name ?? "?"}, ${eur(r.amount)}) je po splatnosti od ${sk(r.due_on)}`,
        links: [{ entity_type: "invoice", entity_id: r.id }],
      }));
    },
  },
  invoice_due_soon: {
    label: "Faktúra pred splatnosťou",
    description: "Neuhradená faktúra, ktorej sa blíži splatnosť. Vhodné na pripomenutie zákazníkovi.",
    params: [days("Dní pred splatnosťou", 3)],
    async run(db, _rule, p) {
      const rows = await db
        .prepare("SELECT id, number, customer_name, amount, due_on FROM v_invoice WHERE paid_on IS NULL AND due_on >= ? AND due_on <= ? AND COALESCE(amount, 0) > 0")
        .bind(iso(new Date()), inDays(Number(p.days)))
        .all<{ id: number; number: string; customer_name: string; amount: number; due_on: string }>();
      return rows.results.map((r) => ({
        key: `invoice_due_soon:${r.id}`,
        text: `Faktúra ${r.number} (${r.customer_name ?? "?"}, ${eur(r.amount)}) je splatná ${sk(r.due_on)}`,
        due_on: r.due_on,
        links: [{ entity_type: "invoice", entity_id: r.id }],
      }));
    },
  },
  unpaid_entry: {
    label: "Neuhradený účtovný záznam",
    description: "Príjem alebo výdaj, ktorý je stále evidovaný ako neuhradený (dlh).",
    params: [
      {
        key: "direction",
        label: "Sledovať",
        type: "select",
        default: "expense",
        options: [
          { value: "expense", label: "Výdaje (dlhujem ja)" },
          { value: "income", label: "Príjmy (dlhujú mne)" },
          { value: "both", label: "Oboje" },
        ],
      },
      days("Dní od dátumu záznamu", 14),
      minAmount,
    ],
    async run(db, _rule, p) {
      const rows = await db
        .prepare(
          `SELECT id, code, title, direction, amount, realized_on FROM v_ledger_entry
           WHERE paid_on IS NULL AND realized_on < ? AND amount >= ? AND (? = 'both' OR direction = ?)`
        )
        .bind(daysAgo(Number(p.days)), Number(p.min_amount), String(p.direction), String(p.direction))
        .all<{ id: number; code: string; title: string; direction: string; amount: number; realized_on: string }>();
      return rows.results.map((r) => ({
        key: `unpaid_entry:${r.id}`,
        text: `${r.direction === "income" ? "Neuhradený príjem" : "Neuhradený výdaj"} ${r.code} „${r.title}“ (${eur(r.amount)}) z ${sk(r.realized_on)}`,
        links: [{ entity_type: "ledger_entry", entity_id: r.id }],
      }));
    },
  },
  missing_receipt: {
    label: "Výdaj bez dokladu",
    description: "Výdaj, ku ktorému nie je nahratý účtovný doklad.",
    params: [days("Dní od dátumu záznamu", 7), minAmount],
    async run(db, _rule, p) {
      const rows = await db
        .prepare(
          `SELECT id, code, title, amount, realized_on FROM v_ledger_entry
           WHERE direction = 'expense' AND receipt_file_id IS NULL AND realized_on < ? AND amount >= ?`
        )
        .bind(daysAgo(Number(p.days)), Number(p.min_amount))
        .all<{ id: number; code: string; title: string; amount: number; realized_on: string }>();
      return rows.results.map((r) => ({
        key: `missing_receipt:${r.id}`,
        text: `Chýba doklad k výdaju ${r.code} „${r.title}“ (${eur(r.amount)}) z ${sk(r.realized_on)}`,
        links: [{ entity_type: "ledger_entry", entity_id: r.id }],
      }));
    },
  },
  stale_job: {
    label: "Zákazka bez pohybu",
    description: "Aktívna zákazka, na ktorej dlhšie nepribudla poznámka, dochádzka ani financie.",
    params: [
      days("Dní bez pohybu", 30),
      {
        key: "scope",
        label: "Sledovať",
        type: "select",
        default: "all",
        options: [
          { value: "all", label: "Všetky aktívne zákazky" },
          { value: "leads", label: "Iba leady" },
          { value: "jobs", label: "Iba zákazky (bez leadov)" },
        ],
      },
    ],
    async run(db, _rule, p) {
      const n = Math.max(1, Number(p.days));
      const scope = p.scope === "leads" ? "AND is_lead = 1" : p.scope === "jobs" ? "AND is_lead = 0" : "";
      const rows = await db
        .prepare(`SELECT id, title, customer_name, is_lead, last_activity_at FROM v_job WHERE is_active = 1 AND status_active = 1 AND last_activity_at < ? ${scope}`)
        .bind(daysAgo(n))
        .all<{ id: number; title: string; customer_name: string; is_lead: number; last_activity_at: string }>();
      // One todo per job per period, so it comes back if the job stays untouched
      const period = Math.floor(Date.now() / (n * 86400000));
      return rows.results.map((r) => ({
        key: `stale_job:${r.id}:${period}`,
        text: `${r.is_lead ? "Lead" : "Zákazka"} „${r.title}“ (${r.customer_name ?? "?"}) je bez pohybu od ${sk(r.last_activity_at)}`,
        links: [{ entity_type: "job", entity_id: r.id }],
      }));
    },
  },
  upcoming_inspection: {
    label: "Blížiaca sa obhliadka",
    description: "Pripomenie naplánovanú obhliadku vopred.",
    params: [days("Dní vopred", 1)],
    async run(db, _rule, p) {
      const rows = await db
        .prepare(
          `SELECT id, job_id, job_title, customer_name, scheduled_at FROM v_inspection
           WHERE scheduled_at IS NOT NULL AND substr(scheduled_at, 1, 10) >= ? AND substr(scheduled_at, 1, 10) <= ?`
        )
        .bind(iso(new Date()), inDays(Number(p.days)))
        .all<{ id: number; job_id: number; job_title: string; customer_name: string; scheduled_at: string }>();
      return rows.results.map((r) => {
        const day = r.scheduled_at.slice(0, 10);
        const time = r.scheduled_at.slice(11, 16);
        return {
          key: `upcoming_inspection:${r.id}:${day}`,
          text: `Obhliadka ${sk(day)}${time ? ` o ${time}` : ""}: ${r.job_title ?? "?"} (${r.customer_name ?? "?"})`,
          due_on: day,
          links: [
            { entity_type: "inspection", entity_id: r.id },
            { entity_type: "job", entity_id: r.job_id },
          ],
        };
      });
    },
  },
  inspection_without_quote: {
    label: "Obhliadka bez cenovej ponuky",
    description: "Po obhliadke aktívnej zákazky zatiaľ nevznikla cenová ponuka.",
    params: [days("Dní od obhliadky", 5)],
    async run(db, _rule, p) {
      const rows = await db
        .prepare(
          `SELECT i.id, i.job_id, i.job_title, i.customer_name, substr(i.scheduled_at, 1, 10) AS day FROM v_inspection i
           JOIN v_job j ON j.id = i.job_id
           WHERE i.scheduled_at IS NOT NULL AND substr(i.scheduled_at, 1, 10) < ? AND j.is_active = 1 AND j.status_active = 1
             AND NOT EXISTS (SELECT 1 FROM quote q WHERE q.job_id = i.job_id AND q.created_on >= substr(i.scheduled_at, 1, 10))`
        )
        .bind(daysAgo(Number(p.days)))
        .all<{ id: number; job_id: number; job_title: string; customer_name: string; day: string }>();
      return rows.results.map((r) => ({
        key: `inspection_without_quote:${r.id}`,
        text: `Poslať cenovú ponuku: ${r.job_title ?? "?"} (${r.customer_name ?? "?"}), obhliadka bola ${sk(r.day)}`,
        links: [{ entity_type: "job", entity_id: r.job_id }],
      }));
    },
  },
  quote_expiring: {
    label: "Končí platnosť cenovej ponuky",
    description: "Cenovej ponuke aktívnej zákazky sa blíži koniec platnosti. Vhodné na pripomenutie zákazníkovi.",
    params: [days("Dní pred koncom platnosti", 3)],
    async run(db, _rule, p) {
      const rows = await db
        .prepare(
          `SELECT q.id, q.job_id, q.job_title, q.customer_name, q.amount, q.valid_until FROM v_quote q
           JOIN v_job j ON j.id = q.job_id
           WHERE q.valid_until >= ? AND q.valid_until <= ? AND j.is_active = 1 AND j.status_active = 1`
        )
        .bind(iso(new Date()), inDays(Number(p.days)))
        .all<{ id: number; job_id: number; job_title: string; customer_name: string; amount: number | null; valid_until: string }>();
      return rows.results.map((r) => ({
        key: `quote_expiring:${r.id}`,
        text: `Ponuka pre ${r.job_title ?? "?"} (${r.customer_name ?? "?"}${r.amount ? `, ${eur(r.amount)}` : ""}) platí do ${sk(r.valid_until)}`,
        due_on: r.valid_until,
        links: [
          { entity_type: "quote", entity_id: r.id },
          { entity_type: "job", entity_id: r.job_id },
        ],
      }));
    },
  },
  sql: {
    label: "Vlastný SQL dotaz",
    description: "Pre pokročilých: vlastný dotaz nad databázou.",
    params: [{ key: "query", label: "SQL (iba SELECT)", type: "sql", default: "" }],
    // User-written query: SELECT returning title [, entity_type, entity_id, key, due_on]
    async run(db, rule, p) {
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
  },
};

// Stored params are completed with defaults and forced to the declared type and range
function cleanParams(kind: Kind, raw: Record<string, unknown>): Params {
  const out: Params = {};
  for (const d of kind.params) {
    const v = raw[d.key] ?? d.default;
    if (d.type === "number") {
      const n = Number(v);
      out[d.key] = Math.max(d.min ?? 0, Number.isFinite(n) ? n : Number(d.default));
    } else if (d.type === "boolean") out[d.key] = v === true || v === 1 || v === "true";
    else if (d.type === "select") out[d.key] = d.options!.some((o) => o.value === v) ? String(v) : String(d.default);
    else out[d.key] = String(v ?? "");
  }
  return out;
}

export async function runRules(db: D1Database, onlyId?: number) {
  const rules = await db.prepare(`SELECT * FROM notification_rule WHERE enabled = 1 ${onlyId ? "AND id = ?" : ""}`)
    .bind(...(onlyId ? [onlyId] : []))
    .all<Rule>();
  // matched = records the rule applies to now; created = those that did not have a todo yet
  const report: { rule: string; matched: number; created: number; error?: string }[] = [];
  for (const rule of rules.results) {
    const kind = kinds[rule.kind];
    if (!kind) continue;
    try {
      const items = await kind.run(db, rule, cleanParams(kind, JSON.parse(rule.params || "{}")));
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
      report.push({ rule: rule.name, matched: items.length, created });
    } catch (e) {
      report.push({ rule: rule.name, matched: 0, created: 0, error: String(e instanceof Error ? e.message : e) });
    }
  }
  return report;
}

export const notificationRoutes = new Hono<AppEnv>();

// Rule types the editor offers, with their parameters
notificationRoutes.get("/kinds", (c) =>
  c.json(Object.entries(kinds).map(([kind, k]) => ({ kind, label: k.label, description: k.description, params: k.params })))
);

notificationRoutes.get("/rules", async (c) => {
  const rows = await c.env.DB.prepare("SELECT * FROM notification_rule ORDER BY id").all<Rule>();
  return c.json(
    rows.results.map((r) => {
      const raw = JSON.parse(r.params || "{}");
      return { ...r, params: kinds[r.kind] ? cleanParams(kinds[r.kind], raw) : raw };
    })
  );
});

notificationRoutes.post("/rules", async (c) => {
  const d = await c.req.json<{ name: string; kind: string; params?: unknown }>();
  const kind = kinds[d.kind];
  if (!kind) return c.json({ error: "Neznámy typ pravidla" }, 400);
  const row = await c.env.DB.prepare("INSERT INTO notification_rule (name, kind, params) VALUES (?, ?, ?) RETURNING id")
    .bind(d.name, d.kind, JSON.stringify(cleanParams(kind, (d.params ?? {}) as Record<string, unknown>)))
    .first();
  return c.json(row, 201);
});

notificationRoutes.patch("/rules/:id", async (c) => {
  const d = await c.req.json<{ name?: string; params?: unknown; enabled?: boolean }>();
  const id = c.req.param("id");
  if (d.name !== undefined) await c.env.DB.prepare("UPDATE notification_rule SET name = ? WHERE id = ?").bind(d.name, id).run();
  if (d.params !== undefined) {
    const rule = await c.env.DB.prepare("SELECT kind FROM notification_rule WHERE id = ?").bind(id).first<{ kind: string }>();
    const kind = rule && kinds[rule.kind];
    const params = kind ? cleanParams(kind, d.params as Record<string, unknown>) : d.params;
    await c.env.DB.prepare("UPDATE notification_rule SET params = ? WHERE id = ?").bind(JSON.stringify(params), id).run();
  }
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
