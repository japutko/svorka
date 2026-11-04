import { Hono } from "hono";
import type { AppEnv, Env } from "./types";
import { requireAccess } from "./auth";
import { entityRoutes } from "./entities";
import { searchRoutes } from "./search";
import { fileRoutes } from "./files";
import { adminRoutes } from "./admin";
import { notificationRoutes, runRules } from "./notifications";
import { dashboardRoutes } from "./dashboard";
import { geoRoutes } from "./geo";

const app = new Hono<AppEnv>().basePath("/api");

app.use("*", requireAccess);

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

app.route("/e", entityRoutes);
app.route("/search", searchRoutes);
app.route("/files", fileRoutes);
app.route("/admin", adminRoutes);
app.route("/notifications", notificationRoutes);
app.route("/dashboard", dashboardRoutes);
app.route("/geo", geoRoutes);

app.onError((err, c) => {
  console.error(err);
  return c.json({ error: err.message }, 500);
});

app.notFound((c) => c.json({ error: "Not found" }, 404));

export default {
  fetch: app.fetch,
  // Daily: turn notification rules into todos
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(runRules(env.DB).then((r) => console.log("notification rules", JSON.stringify(r))));
  },
} satisfies ExportedHandler<Env>;
