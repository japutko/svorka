import { Hono } from "hono";
import type { AppEnv } from "./types";
import { reindex, removeFromIndex } from "./search";
import { deleteEntityFiles } from "./files";

type Row = Record<string, unknown>;

// One entry per record type. Lists read from the view, writes go to the table.
type EntityConfig = {
  table: string;
  view: string;
  fields: string[]; // writable columns
  json?: string[]; // columns returned/stored as JSON
  required?: string[];
  defaultOrder: string;
  // Assigns year + per-year sequence number on insert (receipt / invoice numbers)
  sequence?: { dateField: string };
  // Called before insert/update to fill computed columns
  prepare?: (data: Row, db: D1Database) => Promise<void> | void;
  afterWrite?: (id: number, data: Row, db: D1Database) => Promise<void>;
  // Polymorphic rows (comments, files, todo links) cleaned up on delete
  polymorphic?: boolean;
};

const today = () => new Date().toISOString().slice(0, 10);

function hoursFromIntervals(intervals: string): number | null {
  // "8-12, 16-18:30" -> 6.5
  let total = 0;
  let found = false;
  for (const part of intervals.split(/[,;]/)) {
    const m = part.trim().match(/^(\d{1,2})(?:[:.](\d{2}))?\s*-\s*(\d{1,2})(?:[:.](\d{2}))?$/);
    if (!m) continue;
    const from = +m[1] + (+(m[2] ?? 0)) / 60;
    const to = +m[3] + (+(m[4] ?? 0)) / 60;
    if (to > from) {
      total += to - from;
      found = true;
    }
  }
  return found ? Math.round(total * 100) / 100 : null;
}

export const entities: Record<string, EntityConfig> = {
  person: {
    table: "person",
    view: "v_person",
    fields: ["name", "email", "phone", "billing_address", "lead_source_id", "first_contact_channel_id", "custom_fields"],
    json: ["billing_address", "custom_fields", "comments"],
    required: ["name"],
    defaultOrder: "created_at DESC",
    polymorphic: true,
    afterWrite: async (id, _d, db) => {
      await reindex(db, "person", id);
      const jobs = await db.prepare("SELECT id FROM job WHERE customer_id = ?").bind(id).all<{ id: number }>();
      for (const j of jobs.results) await reindex(db, "job", j.id);
    },
  },
  job: {
    table: "job",
    view: "v_job",
    fields: ["title", "status_id", "is_active", "customer_id", "type_id", "location_address", "billing_address", "custom_fields"],
    json: ["location_address", "billing_address", "custom_fields", "comments"],
    required: ["title"],
    defaultOrder: "status_active DESC, created_at DESC",
    polymorphic: true,
    afterWrite: async (id, _d, db) => reindex(db, "job", id),
  },
  ledger_entry: {
    table: "ledger_entry",
    view: "v_ledger_entry",
    fields: [
      "direction", "realized_on", "paid_on", "payment_method_id", "payment_note", "amount", "title",
      "description", "counterparty_id", "invoice_id", "document_note", "custom_fields",
    ],
    json: ["custom_fields", "splits"],
    required: ["direction", "title", "realized_on"],
    defaultOrder: "realized_on DESC, id DESC",
    sequence: { dateField: "realized_on" },
    polymorphic: true,
  },
  inspection: {
    table: "inspection",
    view: "v_inspection",
    fields: ["job_id", "scheduled_at", "status_id", "location", "phone", "note", "custom_fields"],
    json: ["location", "custom_fields"],
    required: ["job_id"],
    defaultOrder: "scheduled_at DESC",
    polymorphic: true,
  },
  quote: {
    table: "quote",
    view: "v_quote",
    fields: ["created_on", "job_id", "amount", "valid_until", "note", "custom_fields"],
    json: ["custom_fields"],
    required: ["job_id", "created_on"],
    defaultOrder: "created_on DESC, id DESC",
    polymorphic: true,
  },
  invoice: {
    table: "invoice",
    view: "v_invoice",
    fields: ["type_id", "created_on", "realized_on", "due_on", "paid_on", "job_id", "amount", "note", "custom_fields"],
    json: ["custom_fields"],
    required: ["created_on"],
    defaultOrder: "year DESC, seq DESC",
    sequence: { dateField: "created_on" },
    polymorphic: true,
  },
  attendance: {
    table: "attendance",
    view: "v_attendance",
    fields: ["realized_on", "intervals", "person_id", "job_id", "hours", "activity_type_id", "description", "custom_fields"],
    json: ["custom_fields"],
    required: ["realized_on"],
    defaultOrder: "realized_on DESC, id DESC",
    polymorphic: true,
    prepare: (d) => {
      if (typeof d.intervals === "string" && d.intervals.trim() && (d.hours === null || d.hours === undefined || d.hours === "")) {
        d.hours = hoursFromIntervals(d.intervals);
      }
    },
  },
  trip: {
    table: "trip",
    view: "v_trip",
    fields: ["date_from", "date_to", "car_id", "km_before", "km_after", "km", "attendance_id", "job_id", "note", "custom_fields"],
    json: ["custom_fields"],
    required: ["date_from"],
    defaultOrder: "date_from DESC, id DESC",
    prepare: async (d, db) => {
      if ("date_from" in d && !d.date_to) d.date_to = d.date_from;
      if (d.km_before != null && d.km_after != null && d.km_before !== "" && d.km_after !== "") {
        d.km = Number(d.km_after) - Number(d.km_before);
      }
      // Job comes from the attendance record when not set by hand
      if (d.attendance_id && !d.job_id) {
        const a = await db.prepare("SELECT job_id FROM attendance WHERE id = ?").bind(d.attendance_id).first<{ job_id: number }>();
        if (a?.job_id) d.job_id = a.job_id;
      }
    },
  },
  refuel: {
    table: "refuel",
    view: "v_refuel",
    fields: ["realized_on", "car_id", "liters", "km_range", "amount", "ledger_entry_id", "note", "custom_fields"],
    json: ["custom_fields"],
    required: ["realized_on"],
    defaultOrder: "realized_on DESC, id DESC",
  },
  todo: {
    table: "todo",
    view: "v_todo",
    fields: ["text", "due_on", "done", "custom_fields"],
    json: ["custom_fields", "links"],
    required: ["text"],
    defaultOrder: "done ASC, COALESCE(due_on, '9999') ASC, created_at DESC",
    prepare: (d) => {
      if (d.done !== undefined) d.closed_at = d.done ? new Date().toISOString() : null;
    },
  },
};

function parseRow(cfg: EntityConfig, row: Row | null): Row | null {
  if (!row) return row;
  for (const k of cfg.json ?? []) {
    const v = row[k];
    if (typeof v === "string") {
      try {
        row[k] = JSON.parse(v);
      } catch {
        /* leave as text */
      }
    }
  }
  return row;
}

function serialize(cfg: EntityConfig, data: Row): Row {
  const out: Row = {};
  for (const k of [...cfg.fields, "closed_at"]) {
    if (!(k in data)) continue;
    if (k === "closed_at" && cfg.table !== "todo") continue;
    let v = data[k];
    if (v === "" || v === undefined) v = null;
    if (typeof v === "boolean") v = v ? 1 : 0;
    if ((cfg.json ?? []).includes(k) && v !== null && typeof v !== "string") v = JSON.stringify(v);
    if (k === "custom_fields" && v === null) v = "{}";
    out[k] = v;
  }
  return out;
}

// Splits and links are stored in child tables
async function writeChildren(db: D1Database, entity: string, id: number, body: Row) {
  if (entity === "ledger_entry" && Array.isArray(body.splits)) {
    const splits = body.splits as Row[];
    const stmts = [db.prepare("DELETE FROM ledger_split WHERE entry_id = ?").bind(id)];
    splits.forEach((s, i) =>
      stmts.push(
        db
          .prepare("INSERT INTO ledger_split (entry_id, job_id, amount, title, description, sort_order) VALUES (?, ?, ?, ?, ?, ?)")
          .bind(id, s.job_id || null, Number(s.amount) || 0, s.title || null, s.description || null, i)
      )
    );
    await db.batch(stmts);
  }
  if (entity === "todo" && Array.isArray(body.links)) {
    const links = body.links as Row[];
    const stmts = [db.prepare("DELETE FROM todo_link WHERE todo_id = ?").bind(id)];
    for (const l of links)
      stmts.push(
        db.prepare("INSERT OR IGNORE INTO todo_link (todo_id, entity_type, entity_id) VALUES (?, ?, ?)").bind(id, l.entity_type, l.entity_id)
      );
    await db.batch(stmts);
  }
  if (typeof body.initial_comment === "string" && body.initial_comment.trim()) {
    await db
      .prepare("INSERT INTO comment (entity_type, entity_id, text) VALUES (?, ?, ?)")
      .bind(entity, id, body.initial_comment.trim())
      .run();
  }
}

// Simple equality filters from the query string: ?job_id=5&person_id=2
const FILTERABLE = /^[a-z_]+$/;

export const entityRoutes = new Hono<AppEnv>();

entityRoutes.get("/:entity", async (c) => {
  const cfg = entities[c.req.param("entity")];
  if (!cfg) return c.json({ error: "Unknown entity" }, 404);
  const where: string[] = [];
  const binds: unknown[] = [];
  for (const [k, v] of Object.entries(c.req.query())) {
    if (k === "limit" || !FILTERABLE.test(k)) continue;
    if (![...cfg.fields, "id", "customer_id", "done"].includes(k)) continue;
    where.push(`${k} = ?`);
    binds.push(v);
  }
  const limit = Math.min(Number(c.req.query("limit")) || 5000, 5000);
  const sql = `SELECT * FROM ${cfg.view} ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY ${cfg.defaultOrder} LIMIT ${limit}`;
  const rows = await c.env.DB.prepare(sql).bind(...binds).all<Row>();
  return c.json(rows.results.map((r) => parseRow(cfg, r)));
});

entityRoutes.get("/:entity/:id", async (c) => {
  const cfg = entities[c.req.param("entity")];
  if (!cfg) return c.json({ error: "Unknown entity" }, 404);
  const row = await c.env.DB.prepare(`SELECT * FROM ${cfg.view} WHERE id = ?`).bind(c.req.param("id")).first<Row>();
  if (!row) return c.json({ error: "Not found" }, 404);
  return c.json(parseRow(cfg, row));
});

entityRoutes.post("/:entity", async (c) => {
  const entity = c.req.param("entity");
  const cfg = entities[entity];
  if (!cfg) return c.json({ error: "Unknown entity" }, 404);
  const body = await c.req.json<Row>();
  await cfg.prepare?.(body, c.env.DB);
  const data = serialize(cfg, body);
  for (const r of cfg.required ?? []) if (data[r] == null) return c.json({ error: `Pole ${r} je povinné` }, 400);

  const cols = Object.keys(data);
  const vals = Object.values(data);
  let sql: string;
  if (cfg.sequence) {
    const year = Number(String(data[cfg.sequence.dateField] ?? today()).slice(0, 4));
    // Next number in the year's series, computed atomically in the same statement
    sql = `INSERT INTO ${cfg.table} (${[...cols, "year", "seq"].join(", ")})
           SELECT ${cols.map(() => "?").join(", ")}, ?, COALESCE(MAX(seq), 0) + 1 FROM ${cfg.table} WHERE year = ?
           RETURNING id`;
    vals.push(year, year);
  } else {
    sql = `INSERT INTO ${cfg.table} (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")}) RETURNING id`;
  }
  const res = await c.env.DB.prepare(sql).bind(...vals).first<{ id: number }>();
  const id = res!.id;
  await writeChildren(c.env.DB, entity, id, body);
  await cfg.afterWrite?.(id, data, c.env.DB);
  const row = await c.env.DB.prepare(`SELECT * FROM ${cfg.view} WHERE id = ?`).bind(id).first<Row>();
  return c.json(parseRow(cfg, row), 201);
});

entityRoutes.patch("/:entity/:id", async (c) => {
  const entity = c.req.param("entity");
  const cfg = entities[entity];
  if (!cfg) return c.json({ error: "Unknown entity" }, 404);
  const id = Number(c.req.param("id"));
  const body = await c.req.json<Row>();
  await cfg.prepare?.(body, c.env.DB);
  const data = serialize(cfg, body);
  const cols = Object.keys(data);
  if (cols.length) {
    await c.env.DB.prepare(`UPDATE ${cfg.table} SET ${cols.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`)
      .bind(...Object.values(data), id)
      .run();
  }
  await writeChildren(c.env.DB, entity, id, body);
  await cfg.afterWrite?.(id, data, c.env.DB);
  const row = await c.env.DB.prepare(`SELECT * FROM ${cfg.view} WHERE id = ?`).bind(id).first<Row>();
  return c.json(parseRow(cfg, row));
});

entityRoutes.delete("/:entity/:id", async (c) => {
  const entity = c.req.param("entity");
  const cfg = entities[entity];
  if (!cfg) return c.json({ error: "Unknown entity" }, 404);
  const id = Number(c.req.param("id"));
  try {
    await c.env.DB.prepare(`DELETE FROM ${cfg.table} WHERE id = ?`).bind(id).run();
  } catch (e) {
    if (String(e).includes("FOREIGN KEY"))
      return c.json({ error: "Záznam sa používa v iných záznamoch (napr. zákazky, dochádzka). Najprv zmaž alebo prepoj tie." }, 409);
    throw e;
  }
  if (cfg.polymorphic) {
    await c.env.DB.batch([
      c.env.DB.prepare("DELETE FROM comment WHERE entity_type = ? AND entity_id = ?").bind(entity, id),
      c.env.DB.prepare("DELETE FROM todo_link WHERE entity_type = ? AND entity_id = ?").bind(entity, id),
    ]);
    await deleteEntityFiles(c.env, entity, id);
  }
  await removeFromIndex(c.env.DB, entity, id);
  return c.json({ ok: true });
});
