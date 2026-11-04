import { Hono } from "hono";

type Env = { DB: D1Database };

const app = new Hono<{ Bindings: Env }>().basePath("/api");

// Health check: confirms the Worker runs and the D1 database is reachable and migrated.
app.get("/health", async (c) => {
  const tables = await c.env.DB.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE '\\_%' ESCAPE '\\' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'd1_%' ORDER BY name"
  ).all<{ name: string }>();
  return c.json({ ok: true, tables: tables.results.map((t) => t.name) });
});

// Lookup lists (číselníky) by type, e.g. /api/codelists/job_status
app.get("/codelists/:type", async (c) => {
  const rows = await c.env.DB.prepare(
    "SELECT id, label, sort_order, is_default FROM codelist WHERE type = ? AND active = 1 ORDER BY sort_order, label"
  )
    .bind(c.req.param("type"))
    .all();
  return c.json(rows.results);
});

app.notFound((c) => c.json({ error: "Not found" }, 404));

export default app;
