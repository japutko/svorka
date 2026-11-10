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

const sources: Record<"person" | "job", string> = {
  person: `SELECT 'person', p.id, ${join("p.name", "p.email", "p.phone", digits("p.phone"), addr("p.billing_address"), custom("p.custom_fields"), notes("person", "p.id"))}
    FROM person p`,
  job: `SELECT 'job', j.id, ${join(
    "j.title", "p.name", "p.phone", digits("p.phone"), "p.email", addr("j.location_address"), addr("j.billing_address"), custom("j.custom_fields"), notes("job", "j.id")
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
const INDEX_VERSION = "2";
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
  await db.prepare("DELETE FROM search_index WHERE entity_type = ? AND entity_id = ?").bind(entityType, id).run();
}

export const searchRoutes = new Hono<AppEnv>();

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
    `SELECT s.entity_type, s.entity_id,
       CASE s.entity_type WHEN 'job' THEN j.title ELSE p.name END AS label,
       CASE s.entity_type WHEN 'job' THEN COALESCE(jp.name, '') ELSE COALESCE(p.phone, p.email, '') END AS sub,
       CASE s.entity_type WHEN 'job' THEN COALESCE(st.is_active_state, 0) ELSE 1 END AS active
     FROM search_index s
     LEFT JOIN job j ON s.entity_type = 'job' AND j.id = s.entity_id
     LEFT JOIN person jp ON jp.id = j.customer_id
     LEFT JOIN codelist st ON st.id = j.status_id
     LEFT JOIN person p ON s.entity_type = 'person' AND p.id = s.entity_id
     WHERE s.text MATCH ? AND s.entity_type IN (${types.map(() => "?").join(",")})
     ORDER BY active DESC, s.rank LIMIT 20`
  )
    .bind(match, ...types)
    .all();
  return c.json(rows.results);
});
