import { Hono } from "hono";
import type { AppEnv } from "./types";

type Address = { label?: string } | null;

function addressText(json: unknown): string {
  if (!json) return "";
  try {
    const a = (typeof json === "string" ? JSON.parse(json) : json) as Address;
    return a?.label ?? "";
  } catch {
    return String(json);
  }
}

// Rebuild the full-text entry for one person or job
export async function reindex(db: D1Database, entityType: "person" | "job", id: number) {
  let text = "";
  if (entityType === "person") {
    const p = await db.prepare("SELECT name, email, phone, billing_address FROM person WHERE id = ?").bind(id).first<Record<string, string>>();
    if (!p) return;
    text = [p.name, p.email, p.phone, addressText(p.billing_address)].filter(Boolean).join(" ");
  } else {
    const j = await db
      .prepare(
        `SELECT j.title, j.location_address, j.billing_address, p.name AS customer, p.phone, p.email
         FROM job j LEFT JOIN person p ON p.id = j.customer_id WHERE j.id = ?`
      )
      .bind(id)
      .first<Record<string, string>>();
    if (!j) return;
    text = [j.title, j.customer, j.phone, j.email, addressText(j.location_address), addressText(j.billing_address)]
      .filter(Boolean)
      .join(" ");
  }
  await db.batch([
    db.prepare("DELETE FROM search_index WHERE entity_type = ? AND entity_id = ?").bind(entityType, id),
    db.prepare("INSERT INTO search_index (entity_type, entity_id, text) VALUES (?, ?, ?)").bind(entityType, id, text),
    db.prepare(`UPDATE ${entityType} SET search_text = ? WHERE id = ?`).bind(text.toLowerCase(), id),
  ]);
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
