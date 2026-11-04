import { Hono } from "hono";
import type { AppEnv } from "./types";

// Lookup lists, custom fields, saved views, settings and comment journals
export const adminRoutes = new Hono<AppEnv>();

const parseMeta = <T extends { meta?: unknown }>(r: T) => ({ ...r, meta: typeof r.meta === "string" ? JSON.parse(r.meta || "{}") : r.meta });

adminRoutes.get("/codelist-types", async (c) => {
  const rows = await c.env.DB.prepare("SELECT * FROM codelist_type ORDER BY label").all();
  return c.json(rows.results);
});

adminRoutes.post("/codelist-types", async (c) => {
  const { key, label } = await c.req.json<{ key: string; label: string }>();
  if (!/^[a-z][a-z0-9_]*$/.test(key ?? "")) return c.json({ error: "Kľúč: malé písmená, čísla a _" }, 400);
  await c.env.DB.prepare("INSERT INTO codelist_type (key, label) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET label = excluded.label")
    .bind(key, label)
    .run();
  return c.json({ ok: true });
});

// All values of all lists (inactive included) – small enough to load at once
adminRoutes.get("/codelists", async (c) => {
  const rows = await c.env.DB.prepare("SELECT * FROM codelist ORDER BY type, sort_order, label").all<{ meta: string }>();
  return c.json(rows.results.map(parseMeta));
});

type CodelistBody = {
  type: string;
  label: string;
  sort_order?: number;
  is_default?: boolean | number;
  is_active_state?: boolean | number | null;
  active?: boolean | number;
  color?: string | null;
  meta?: Record<string, unknown>;
};

const b = (v: unknown) => (v ? 1 : 0);

adminRoutes.post("/codelists", async (c) => {
  const d = await c.req.json<CodelistBody>();
  if (d.is_default) await c.env.DB.prepare("UPDATE codelist SET is_default = 0 WHERE type = ?").bind(d.type).run();
  const row = await c.env.DB.prepare(
    `INSERT INTO codelist (type, label, sort_order, is_default, is_active_state, active, color, meta)
     VALUES (?, ?, COALESCE(?, (SELECT COALESCE(MAX(sort_order), 0) + 10 FROM codelist WHERE type = ?)), ?, ?, ?, ?, ?) RETURNING *`
  )
    .bind(d.type, d.label, d.sort_order ?? null, d.type, b(d.is_default), d.is_active_state == null ? null : b(d.is_active_state), d.active === undefined ? 1 : b(d.active), d.color ?? null, JSON.stringify(d.meta ?? {}))
    .first<{ meta: string }>();
  return c.json(parseMeta(row!), 201);
});

adminRoutes.patch("/codelists/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const d = await c.req.json<Partial<CodelistBody>>();
  const cur = await c.env.DB.prepare("SELECT type FROM codelist WHERE id = ?").bind(id).first<{ type: string }>();
  if (!cur) return c.json({ error: "Not found" }, 404);
  if (d.is_default) await c.env.DB.prepare("UPDATE codelist SET is_default = 0 WHERE type = ?").bind(cur.type).run();
  const sets: string[] = [];
  const vals: unknown[] = [];
  const set = (col: string, v: unknown) => {
    sets.push(`${col} = ?`);
    vals.push(v);
  };
  if (d.label !== undefined) set("label", d.label);
  if (d.sort_order !== undefined) set("sort_order", d.sort_order);
  if (d.is_default !== undefined) set("is_default", b(d.is_default));
  if (d.is_active_state !== undefined) set("is_active_state", d.is_active_state == null ? null : b(d.is_active_state));
  if (d.active !== undefined) set("active", b(d.active));
  if (d.color !== undefined) set("color", d.color);
  if (d.meta !== undefined) set("meta", JSON.stringify(d.meta));
  if (sets.length) await c.env.DB.prepare(`UPDATE codelist SET ${sets.join(", ")} WHERE id = ?`).bind(...vals, id).run();
  return c.json({ ok: true });
});

// Custom fields (user-extensible data model)
adminRoutes.get("/fields", async (c) => {
  const rows = await c.env.DB.prepare("SELECT * FROM field_definition ORDER BY entity_type, sort_order, id").all();
  return c.json(rows.results);
});

adminRoutes.post("/fields", async (c) => {
  const d = await c.req.json<{ entity_type: string; label: string; data_type: string; codelist_type?: string }>();
  // The storage key is derived once and never changes, so renaming is always safe
  const base =
    d.label
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_|_$/g, "") || "pole";
  let key = base;
  for (let i = 2; await c.env.DB.prepare("SELECT 1 FROM field_definition WHERE entity_type = ? AND key = ?").bind(d.entity_type, key).first(); i++)
    key = `${base}_${i}`;
  const row = await c.env.DB.prepare(
    `INSERT INTO field_definition (entity_type, key, label, data_type, codelist_type, sort_order)
     VALUES (?, ?, ?, ?, ?, (SELECT COALESCE(MAX(sort_order), 0) + 10 FROM field_definition WHERE entity_type = ?)) RETURNING *`
  )
    .bind(d.entity_type, key, d.label, d.data_type, d.codelist_type ?? null, d.entity_type)
    .first();
  return c.json(row, 201);
});

adminRoutes.patch("/fields/:id", async (c) => {
  const d = await c.req.json<{ label?: string; active?: boolean; sort_order?: number; codelist_type?: string }>();
  const sets: string[] = [];
  const vals: unknown[] = [];
  if (d.label !== undefined) (sets.push("label = ?"), vals.push(d.label));
  if (d.active !== undefined) (sets.push("active = ?"), vals.push(d.active ? 1 : 0));
  if (d.sort_order !== undefined) (sets.push("sort_order = ?"), vals.push(d.sort_order));
  if (d.codelist_type !== undefined) (sets.push("codelist_type = ?"), vals.push(d.codelist_type));
  if (sets.length) await c.env.DB.prepare(`UPDATE field_definition SET ${sets.join(", ")} WHERE id = ?`).bind(...vals, c.req.param("id")).run();
  return c.json({ ok: true });
});

// Saved table / dashboard views
adminRoutes.get("/views", async (c) => {
  const rows = await c.env.DB.prepare("SELECT * FROM saved_view WHERE entity_type = ? ORDER BY name").bind(c.req.query("entity_type")).all<{ state: string }>();
  return c.json(rows.results.map((r) => ({ ...r, state: JSON.parse(r.state) })));
});

adminRoutes.post("/views", async (c) => {
  const d = await c.req.json<{ entity_type: string; name: string; state: unknown; is_default?: boolean }>();
  if (d.is_default) await c.env.DB.prepare("UPDATE saved_view SET is_default = 0 WHERE entity_type = ?").bind(d.entity_type).run();
  const row = await c.env.DB.prepare("INSERT INTO saved_view (entity_type, name, state, is_default) VALUES (?, ?, ?, ?) RETURNING *")
    .bind(d.entity_type, d.name, JSON.stringify(d.state), d.is_default ? 1 : 0)
    .first<{ state: string }>();
  return c.json({ ...row!, state: JSON.parse(row!.state) }, 201);
});

adminRoutes.patch("/views/:id", async (c) => {
  const id = c.req.param("id");
  const d = await c.req.json<{ name?: string; state?: unknown; is_default?: boolean }>();
  const cur = await c.env.DB.prepare("SELECT entity_type FROM saved_view WHERE id = ?").bind(id).first<{ entity_type: string }>();
  if (!cur) return c.json({ error: "Not found" }, 404);
  if (d.is_default) await c.env.DB.prepare("UPDATE saved_view SET is_default = 0 WHERE entity_type = ?").bind(cur.entity_type).run();
  if (d.name !== undefined) await c.env.DB.prepare("UPDATE saved_view SET name = ? WHERE id = ?").bind(d.name, id).run();
  if (d.state !== undefined) await c.env.DB.prepare("UPDATE saved_view SET state = ? WHERE id = ?").bind(JSON.stringify(d.state), id).run();
  if (d.is_default !== undefined) await c.env.DB.prepare("UPDATE saved_view SET is_default = ? WHERE id = ?").bind(d.is_default ? 1 : 0, id).run();
  return c.json({ ok: true });
});

adminRoutes.delete("/views/:id", async (c) => {
  await c.env.DB.prepare("DELETE FROM saved_view WHERE id = ?").bind(c.req.param("id")).run();
  return c.json({ ok: true });
});

adminRoutes.get("/settings", async (c) => {
  const rows = await c.env.DB.prepare("SELECT key, value FROM setting").all<{ key: string; value: string }>();
  return c.json(Object.fromEntries(rows.results.map((r) => [r.key, r.value])));
});

adminRoutes.put("/settings", async (c) => {
  const d = await c.req.json<Record<string, string | number | null>>();
  await c.env.DB.batch(
    Object.entries(d).map(([k, v]) =>
      c.env.DB.prepare("INSERT INTO setting (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(k, v == null ? null : String(v))
    )
  );
  return c.json({ ok: true });
});

// Comment journal
adminRoutes.get("/comments", async (c) => {
  const rows = await c.env.DB.prepare("SELECT * FROM comment WHERE entity_type = ? AND entity_id = ? ORDER BY created_at DESC")
    .bind(c.req.query("entity_type"), c.req.query("entity_id"))
    .all();
  return c.json(rows.results);
});

adminRoutes.post("/comments", async (c) => {
  const d = await c.req.json<{ entity_type: string; entity_id: number; text: string }>();
  if (!d.text?.trim()) return c.json({ error: "Prázdny komentár" }, 400);
  const row = await c.env.DB.prepare("INSERT INTO comment (entity_type, entity_id, text) VALUES (?, ?, ?) RETURNING *")
    .bind(d.entity_type, d.entity_id, d.text.trim())
    .first();
  return c.json(row, 201);
});

adminRoutes.delete("/comments/:id", async (c) => {
  await c.env.DB.prepare("DELETE FROM comment WHERE id = ?").bind(c.req.param("id")).run();
  return c.json({ ok: true });
});
