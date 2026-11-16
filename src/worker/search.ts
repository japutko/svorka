import { Hono } from "hono";
import type { AppEnv } from "./types";

// Index text is built in SQL so one record and the whole index use the same rule
const join = (...xs: string[]) => xs.map((x) => `COALESCE(${x}, '')`).join(" || ' ' || ");
const addr = (col: string) => `CASE WHEN json_valid(${col}) THEN json_extract(${col}, '$.label') ELSE ${col} END`;
// "0905 123 456" is also indexed as "0905123456", so typing it without spaces works
const digits = (col: string) => ["' '", "'-'", "'/'", "'('", "')'", "'+'"].reduce((x, ch) => `replace(${x}, ${ch}, '')`, col);
const custom = (col: string) =>
  `(SELECT group_concat(value, ' ') FROM json_each(CASE WHEN json_valid(${col}) THEN ${col} ELSE '{}' END) WHERE type = 'text')`;
const notes = (type: string, idCol: string) => `(SELECT group_concat(text, ' ') FROM comment WHERE entity_type = '${type}' AND entity_id = ${idCol})`;

// Job number as shown in the app (Z26-001)
const jobCode = (j: string) => `'Z' || substr(CAST(${j}.year AS TEXT), 3) || '-' || printf('%03d', ${j}.seq)`;

const sources: Record<"person" | "job", string> = {
  person: `SELECT 'person', p.id, ${join("p.name", "p.email", "p.phone", digits("p.phone"), addr("p.billing_address"), custom("p.custom_fields"), notes("person", "p.id"))}
    FROM person p`,
  job: `SELECT 'job', j.id, ${join(
    // The number is indexed whole and as a bare sequence, so "Z26-012", "26-012" and "12" all find the job
    jobCode("j"), `substr(${jobCode("j")}, 2)`, "CAST(j.seq AS TEXT)", "j.title", "p.name", "p.phone", digits("p.phone"), "p.email", addr("j.location_address"), addr("j.billing_address"), custom("j.custom_fields"), notes("job", "j.id")
  )}
    FROM job j LEFT JOIN person p ON p.id = j.customer_id`,
};
const alias = { person: "p", job: "j" };

const copyToTable = (db: D1Database, entityType: "person" | "job", where = "") =>
  db.prepare(
    `UPDATE ${entityType} SET search_text = (SELECT lower(text) FROM search_index s WHERE s.entity_type = '${entityType}' AND s.entity_id = ${entityType}.id) ${where}`
  );

// Rebuild the full-text entry for one person or job
export async function reindex(db: D1Database, entityType: "person" | "job", id: number) {
  await db.batch([
    db.prepare("DELETE FROM search_index WHERE entity_type = ? AND entity_id = ?").bind(entityType, id),
    db.prepare(`INSERT INTO search_index (entity_type, entity_id, text) ${sources[entityType]} WHERE ${alias[entityType]}.id = ?`).bind(id),
    copyToTable(db, entityType, "WHERE id = ?").bind(id),
  ]);
}

// Bump when the indexed fields change; the next search then rebuilds everything
const INDEX_VERSION = "3";
let indexChecked = false;

async function ensureIndex(db: D1Database) {
  if (indexChecked) return;
  const v = await db.prepare("SELECT value FROM setting WHERE key = 'search_index_version'").first<{ value: string }>();
  if (v?.value !== INDEX_VERSION) {
    await db.batch([
      db.prepare("DELETE FROM search_index"),
      db.prepare(`INSERT INTO search_index (entity_type, entity_id, text) ${sources.person}`),
      db.prepare(`INSERT INTO search_index (entity_type, entity_id, text) ${sources.job}`),
      copyToTable(db, "person"),
      copyToTable(db, "job"),
      db.prepare("INSERT INTO setting (key, value) VALUES ('search_index_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(INDEX_VERSION),
    ]);
  }
  indexChecked = true;
}

export async function removeFromIndex(db: D1Database, entityType: string, id: number) {
  await db.batch([
    db.prepare("DELETE FROM search_index WHERE entity_type = ? AND entity_id = ?").bind(entityType, id),
    db.prepare("DELETE FROM recent_pick WHERE entity_type = ? AND entity_id = ?").bind(entityType, id),
  ]);
}

// Label columns shared by search hits and recent picks
const hitColumns = `CASE WHEN j.id IS NOT NULL THEN j.title ELSE p.name END AS label,
       CASE WHEN j.id IS NOT NULL THEN ${jobCode("j")} || COALESCE(' · ' || jp.name, '') ELSE COALESCE(p.phone, p.email, '') END AS sub,
       CASE WHEN j.id IS NOT NULL THEN COALESCE(st.is_active_state, 0) ELSE 1 END AS active`;
const hitJoins = (type: string, id: string) => `
     LEFT JOIN job j ON ${type} = 'job' AND j.id = ${id}
     LEFT JOIN person jp ON jp.id = j.customer_id
     LEFT JOIN codelist st ON st.id = j.status_id
     LEFT JOIN person p ON ${type} = 'person' AND p.id = ${id}`;

export const searchRoutes = new Hono<AppEnv>();

const RECENT_LIMIT = 3;
const pickable = (t: string): t is "person" | "job" => t === "person" || t === "job";

// /api/search/recent?types=person – last records picked in a linked-record field,
// topped up with the newest records while there are fewer than three picks
searchRoutes.get("/recent", async (c) => {
  const type = (c.req.query("types") ?? "").split(",")[0];
  if (!pickable(type)) return c.json([]);
  const rows = await c.env.DB.prepare(
    `SELECT r.entity_type, r.entity_id, ${hitColumns}
     FROM (
       SELECT entity_type, entity_id, 0 AS src, used_at AS at FROM recent_pick WHERE entity_type = ?1
       UNION ALL
       SELECT ?1, id, 1, created_at FROM ${type} WHERE id NOT IN (SELECT entity_id FROM recent_pick WHERE entity_type = ?1)
     ) r ${hitJoins("r.entity_type", "r.entity_id")}
     WHERE COALESCE(j.id, p.id) IS NOT NULL
     ORDER BY r.src, r.at DESC LIMIT ${RECENT_LIMIT}`
  )
    .bind(type)
    .all();
  return c.json(rows.results);
});

searchRoutes.post("/recent", async (c) => {
  const d = await c.req.json<{ entity_type: string; entity_id: number }>();
  if (!pickable(d.entity_type) || !Number.isInteger(d.entity_id)) return c.json({ error: "Neplatný záznam" }, 400);
  await c.env.DB.batch([
    c.env.DB.prepare(
      "INSERT INTO recent_pick (entity_type, entity_id) VALUES (?, ?) ON CONFLICT(entity_type, entity_id) DO UPDATE SET used_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')"
    ).bind(d.entity_type, d.entity_id),
    // Keep the table small: only the newest picks per type matter
    c.env.DB.prepare(
      "DELETE FROM recent_pick WHERE entity_type = ?1 AND entity_id NOT IN (SELECT entity_id FROM recent_pick WHERE entity_type = ?1 ORDER BY used_at DESC LIMIT 20)"
    ).bind(d.entity_type),
  ]);
  return c.json({ ok: true });
});

// /api/search?q=novak hlavna&types=job,person
searchRoutes.get("/", async (c) => {
  const q = (c.req.query("q") ?? "").trim();
  const types = (c.req.query("types") ?? "job,person").split(",");
  if (!q) return c.json([]);
  // Every word must match as a prefix: "nov hlav" finds "Novák, Hlavná 5"
  const match = q
    .split(/\s+/)
    .map((w) => w.replace(/["*^():]/g, ""))
    .filter(Boolean)
    .map((w) => `"${w}"*`)
    .join(" ");
  if (!match) return c.json([]);
  await ensureIndex(c.env.DB);
  const rows = await c.env.DB.prepare(
    `SELECT s.entity_type, s.entity_id, ${hitColumns}
     FROM search_index s ${hitJoins("s.entity_type", "s.entity_id")}
     WHERE s.text MATCH ? AND s.entity_type IN (${types.map(() => "?").join(",")})
     ORDER BY active DESC, s.rank LIMIT 20`
  )
    .bind(match, ...types)
    .all();
  return c.json(rows.results);
});
