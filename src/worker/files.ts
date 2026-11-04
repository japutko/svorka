import { Hono } from "hono";
import type { AppEnv, Env } from "./types";

// Storage backend. R2 today; a OneDrive (Microsoft Graph) implementation can
// replace it later because records only keep the folder-structured path.
export interface Storage {
  put(path: string, body: ArrayBuffer | ReadableStream, contentType: string): Promise<void>;
  get(path: string): Promise<{ body: ReadableStream; contentType?: string } | null>;
  delete(path: string): Promise<void>;
}

export function storage(env: Env): Storage {
  return {
    async put(path, body, contentType) {
      await env.FILES.put(path, body, { httpMetadata: { contentType } });
    },
    async get(path) {
      const obj = await env.FILES.get(path);
      return obj ? { body: obj.body, contentType: obj.httpMetadata?.contentType } : null;
    },
    async delete(path) {
      await env.FILES.delete(path);
    },
  };
}

const clean = (s: string) =>
  s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\w.\- ]+/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);

// Folder layout:
//   Uctovne doklady/2026/U26-042.pdf             (receipt, one folder per year)
//   Uctovne doklady/2026/U26-042 prilohy/x.jpg   (other attachments)
//   Zakazky/Z15 Novak - Rekonstrukcia/Obhliadky/2026-11-04/nacrt.jpg
//   Zakazky/Z15 .../Cenove ponuky/2026-11-04 ponuka.pdf
//   Zakazky/Z15 .../Faktury/12-2026 faktura.pdf
async function folderFor(db: D1Database, entityType: string, entityId: number, role: string): Promise<{ folder: string; base?: string }> {
  const jobFolder = async (jobId: number) => {
    const j = await db
      .prepare("SELECT j.id, j.title, p.name FROM job j LEFT JOIN person p ON p.id = j.customer_id WHERE j.id = ?")
      .bind(jobId)
      .first<{ id: number; title: string; name: string | null }>();
    return `Zakazky/Z${jobId} ${clean([j?.name, j?.title].filter(Boolean).join(" - "))}`.trim();
  };
  switch (entityType) {
    case "ledger_entry": {
      const e = await db.prepare("SELECT code, year FROM v_ledger_entry WHERE id = ?").bind(entityId).first<{ code: string; year: number }>();
      return { folder: `Uctovne doklady/${e!.year}${role === "receipt" ? "" : `/${e!.code} prilohy`}`, base: e!.code };
    }
    case "inspection": {
      const i = await db.prepare("SELECT job_id, scheduled_at FROM inspection WHERE id = ?").bind(entityId).first<{ job_id: number; scheduled_at: string }>();
      return { folder: `${await jobFolder(i!.job_id)}/Obhliadky/${(i!.scheduled_at ?? "").slice(0, 10) || `O${entityId}`}` };
    }
    case "quote": {
      const q = await db.prepare("SELECT job_id, created_on FROM quote WHERE id = ?").bind(entityId).first<{ job_id: number; created_on: string }>();
      return { folder: `${await jobFolder(q!.job_id)}/Cenove ponuky/${q!.created_on} P${entityId}` };
    }
    case "invoice": {
      const i = await db.prepare("SELECT job_id, seq, year FROM invoice WHERE id = ?").bind(entityId).first<{ job_id: number | null; seq: number; year: number }>();
      const base = i!.job_id ? `${await jobFolder(i!.job_id)}/Faktury` : `Faktury/${i!.year}`;
      return { folder: `${base}/${i!.seq}-${i!.year}` };
    }
    case "job":
      return { folder: `${await jobFolder(entityId)}/Dokumenty` };
    default:
      return { folder: `Ostatne/${entityType}/${entityId}` };
  }
}

export async function deleteEntityFiles(env: Env, entityType: string, entityId: number) {
  const rows = await env.DB.prepare("SELECT path FROM file WHERE entity_type = ? AND entity_id = ?").bind(entityType, entityId).all<{ path: string }>();
  for (const r of rows.results) await storage(env).delete(r.path);
  await env.DB.prepare("DELETE FROM file WHERE entity_type = ? AND entity_id = ?").bind(entityType, entityId).run();
}

export const fileRoutes = new Hono<AppEnv>();

fileRoutes.get("/", async (c) => {
  const rows = await c.env.DB.prepare(
    "SELECT * FROM file WHERE entity_type = ? AND entity_id = ? ORDER BY created_at DESC"
  )
    .bind(c.req.query("entity_type"), c.req.query("entity_id"))
    .all();
  return c.json(rows.results);
});

// multipart: file, entity_type, entity_id, role
fileRoutes.post("/", async (c) => {
  const form = await c.req.formData();
  const file = form.get("file") as unknown as File | null;
  const entityType = String(form.get("entity_type") ?? "");
  const entityId = Number(form.get("entity_id"));
  const role = String(form.get("role") ?? "attachment");
  if (!file || typeof file === "string" || !entityType || !entityId) return c.json({ error: "Chýba súbor alebo väzba" }, 400);

  let target: { folder: string; base?: string };
  try {
    target = await folderFor(c.env.DB, entityType, entityId, role);
  } catch {
    return c.json({ error: "Záznam neexistuje" }, 404);
  }
  const { folder, base } = target;
  const dot = file.name.lastIndexOf(".");
  const ext = dot > 0 ? file.name.slice(dot) : "";
  let name = role === "receipt" && base ? `${base}${ext || ".pdf"}` : clean(file.name) || `subor${ext}`;
  // Never overwrite: a second upload becomes a new version
  let path = `${folder}/${name}`;
  for (let v = 2; await c.env.DB.prepare("SELECT 1 FROM file WHERE path = ?").bind(path).first(); v++) {
    const d = name.lastIndexOf(".");
    path = `${folder}/${d > 0 ? name.slice(0, d) : name} v${v}${d > 0 ? name.slice(d) : ""}`;
  }
  name = path.slice(folder.length + 1);

  const contentType = file.type || "application/octet-stream";
  await storage(c.env).put(path, await file.arrayBuffer(), contentType);
  const row = await c.env.DB.prepare(
    "INSERT INTO file (entity_type, entity_id, role, name, path, content_type, size) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *"
  )
    .bind(entityType, entityId, role, name, path, contentType, file.size)
    .first();
  return c.json(row, 201);
});

fileRoutes.get("/:id/content", async (c) => {
  const f = await c.env.DB.prepare("SELECT * FROM file WHERE id = ?").bind(c.req.param("id")).first<{ path: string; name: string; content_type: string }>();
  if (!f) return c.json({ error: "Not found" }, 404);
  const obj = await storage(c.env).get(f.path);
  if (!obj) return c.json({ error: "Súbor chýba v úložisku" }, 404);
  return new Response(obj.body, {
    headers: {
      "Content-Type": f.content_type || obj.contentType || "application/octet-stream",
      "Content-Disposition": `${c.req.query("download") ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(f.name)}`,
      "Cache-Control": "private, max-age=3600",
    },
  });
});

fileRoutes.delete("/:id", async (c) => {
  const f = await c.env.DB.prepare("SELECT path FROM file WHERE id = ?").bind(c.req.param("id")).first<{ path: string }>();
  if (!f) return c.json({ error: "Not found" }, 404);
  await storage(c.env).delete(f.path);
  await c.env.DB.prepare("DELETE FROM file WHERE id = ?").bind(c.req.param("id")).run();
  return c.json({ ok: true });
});
