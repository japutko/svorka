import { Hono } from "hono";
import type { AppEnv } from "./types";

const MODEL = "@cf/meta/llama-4-scout-17b-16e-instruct";
const MAX_IMAGES = 4;

type Extracted = {
  direction?: "income" | "expense";
  date?: string | null;
  total?: number | null;
  supplier_name?: string | null;
  supplier_ico?: string | null;
  document_number?: string | null;
  title?: string | null;
  description?: string | null;
  payment_method?: string | null;
  paid?: boolean | null;
  due_date?: string | null;
  job_id?: number | null;
  job_reason?: string | null;
};

const schema = {
  type: "object",
  properties: {
    direction: { type: "string", enum: ["income", "expense"] },
    date: { type: ["string", "null"], description: "Dátum dokladu YYYY-MM-DD" },
    total: { type: ["number", "null"], description: "Celková suma na úhradu v EUR vrátane DPH" },
    supplier_name: { type: ["string", "null"] },
    supplier_ico: { type: ["string", "null"] },
    document_number: { type: ["string", "null"] },
    title: { type: ["string", "null"] },
    description: { type: ["string", "null"] },
    payment_method: { type: ["string", "null"] },
    paid: { type: ["boolean", "null"] },
    due_date: { type: ["string", "null"] },
    job_id: { type: ["integer", "null"] },
    job_reason: { type: ["string", "null"] },
  },
  required: ["direction", "date", "total", "title"],
};

function toBase64(buf: ArrayBuffer) {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

// The model sometimes wraps JSON in prose or code fences
function parseJson(out: unknown): Extracted {
  if (out && typeof out === "object") return out as Extracted;
  const s = String(out ?? "");
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("Model nevrátil údaje");
  return JSON.parse(s.slice(start, end + 1));
}

const isoDate = (s?: string | null) => {
  if (!s) return null;
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/) ?? null;
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const sk = s.match(/(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})/);
  return sk ? `${sk[3]}-${sk[2].padStart(2, "0")}-${sk[1].padStart(2, "0")}` : null;
};

const fold = (s: string) =>
  s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

export const aiRoutes = new Hono<AppEnv>();

// multipart: file (one or more pages: JPEG images or PDFs)
aiRoutes.post("/receipt", async (c) => {
  const db = c.env.DB;
  const form = await c.req.formData();
  const files = form.getAll("file").filter((f): f is File => typeof f !== "string");
  if (!files.length) return c.json({ error: "Chýba doklad" }, 400);

  const images: string[] = [];
  const texts: string[] = [];
  for (const f of files) {
    if (f.type === "application/pdf") {
      // Text PDFs (e-shop invoices) are read as text, which is more reliable than a picture
      const md = await c.env.AI.toMarkdown({ name: f.name || "doklad.pdf", blob: new Blob([await f.arrayBuffer()], { type: f.type }) });
      if (md.format !== "error" && md.data.trim()) texts.push(md.data.slice(0, 12000));
    } else if (f.type.startsWith("image/") && images.length < MAX_IMAGES) {
      images.push(`data:${f.type};base64,${toBase64(await f.arrayBuffer())}`);
    }
  }
  if (!images.length && !texts.length) return c.json({ error: "Z dokladu sa nedá nič prečítať (naskenované PDF nahraj ako fotku)" }, 422);

  const [jobs, methods, me] = await Promise.all([
    db
      .prepare(
        `SELECT id, title, customer_name, json_extract(location_address, '$.label') AS location
         FROM v_job WHERE is_active = 1 AND status_active = 1 ORDER BY last_activity_at DESC LIMIT 60`
      )
      .all<{ id: number; title: string; customer_name: string | null; location: string | null }>(),
    db.prepare("SELECT id, label FROM codelist WHERE type = 'payment_method' AND active = 1 ORDER BY sort_order").all<{ id: number; label: string }>(),
    db.prepare("SELECT p.name FROM setting s JOIN person p ON p.id = CAST(s.value AS INTEGER) WHERE s.key = 'self_person_id'").first<{ name: string }>(),
  ]);

  const today = new Date().toISOString().slice(0, 10);
  const prompt = `Si účtovník slovenského elektrikára-živnostníka${me?.name ? ` (${me.name})` : ""}. Prečítaj priložený doklad (bloček, faktúru, príjmový doklad) a vráť JSON podľa schémy.

Pravidlá:
- direction: "expense" ak ide o nákup / doklad od dodávateľa; "income" iba ak doklad vystavil sám živnostník${me?.name ? ` (${me.name})` : ""} zákazníkovi alebo ide o prijatú platbu.
- date: dátum vystavenia/nákupu vo formáte YYYY-MM-DD (dnes je ${today}). Na slovenských dokladoch je dátum vo formáte D.M.RRRR.
- total: celková suma na úhradu v EUR vrátane DPH (číslo, desatinná bodka). Nie medzisúčet, nie DPH.
- supplier_name: obchod alebo firma, ktorá doklad vystavila (napr. "Hornbach", "Elektro-Haus s.r.o."). supplier_ico: IČO ak je uvedené.
- document_number: číslo dokladu/faktúry ak je uvedené.
- title: krátky nadpis po slovensky, napr. "Hornbach – materiál" alebo "Shell – tankovanie".
- description: 1–2 vety po slovensky, čo sa kúpilo (hlavné položky, bez cien).
- payment_method: vyber presne jednu z možností ${JSON.stringify(methods.results.map((m) => m.label))} alebo null. Hotovosť pri platbe v hotovosti, karta/prevod na podnikateľský účet ak nie je jasné inak.
- paid: true ak je doklad zaplatený (bloček z pokladne), false ak je to faktúra so splatnosťou, ktorá ešte nie je uhradená.
- due_date: dátum splatnosti YYYY-MM-DD ak je uvedený.
- job_id: id zákazky z tohto zoznamu, ku ktorej nákup zjavne patrí (podľa adresy dodania, mena zákazníka, poznámky na doklade), inak null. Nehádaj bez dôvodu.
  Zákazky: ${JSON.stringify(jobs.results.map((j) => ({ id: j.id, nazov: j.title, zakaznik: j.customer_name, adresa: j.location })))}
- job_reason: krátko prečo si vybral zákazku, inak null.
Ak niečo na doklade nie je, daj null. Vráť iba JSON.`;

  const content: { type: string; text?: string; image_url?: { url: string } }[] = [{ type: "text", text: prompt }];
  for (const t of texts) content.push({ type: "text", text: `Text dokladu:\n${t}` });
  for (const url of images) content.push({ type: "image_url", image_url: { url } });

  let ex: Extracted;
  try {
    const res = (await c.env.AI.run(MODEL, {
      messages: [{ role: "user", content }],
      response_format: { type: "json_schema", json_schema: schema },
      max_tokens: 800,
      temperature: 0.1,
    } as never)) as { response?: unknown };
    ex = parseJson(res.response);
  } catch (e) {
    console.error("receipt read failed", e);
    return c.json({ error: `Doklad sa nepodarilo prečítať: ${e instanceof Error ? e.message : e}` }, 502);
  }

  // Map names the model returned onto our records
  const method = ex.payment_method ? methods.results.find((m) => fold(m.label) === fold(ex.payment_method!)) : undefined;
  const job = ex.job_id ? jobs.results.find((j) => j.id === Number(ex.job_id)) : undefined;
  let counterparty: { id: number; name: string } | null = null;
  if (ex.supplier_name) {
    const words = fold(ex.supplier_name).replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w.length > 2 && !["s.r.o", "sro", "a.s"].includes(w));
    if (words.length) {
      const hits = await db
        .prepare(
          `SELECT p.id, p.name FROM search_index s JOIN person p ON p.id = s.entity_id
           WHERE s.entity_type = 'person' AND s.text MATCH ? ORDER BY s.rank LIMIT 10`
        )
        .bind(words.map((w) => `"${w}"`).join(" "))
        .all<{ id: number; name: string }>();
      // The index also holds notes, so only a person whose name has the words counts
      counterparty = hits.results.find((p) => words.every((w) => fold(p.name).includes(w))) ?? null;
    }
  }
  const total = typeof ex.total === "number" ? ex.total : ex.total ? Number(String(ex.total).replace(",", ".")) : null;
  const date = isoDate(ex.date) ?? today;

  return c.json({
    direction: ex.direction === "income" ? "income" : "expense",
    realized_on: date,
    amount: total != null && isFinite(total) ? Math.abs(Math.round(total * 100) / 100) : null,
    title: ex.title?.trim() || ex.supplier_name || null,
    description: [ex.description?.trim(), ex.document_number ? `Doklad č. ${ex.document_number}` : null, ex.supplier_ico ? `IČO ${ex.supplier_ico}` : null]
      .filter(Boolean)
      .join("\n") || null,
    paid: ex.paid !== false,
    due_on: isoDate(ex.due_date),
    payment_method_id: method?.id ?? null,
    supplier_name: ex.supplier_name ?? null,
    counterparty_id: counterparty?.id ?? null,
    counterparty_name: counterparty?.name ?? null,
    job_id: job?.id ?? null,
    job_title: job?.title ?? null,
    job_reason: job ? ex.job_reason ?? null : null,
  });
});
