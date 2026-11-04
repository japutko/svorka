import { Hono } from "hono";
import type { AppEnv } from "./types";

type MapyItem = {
  name: string;
  label: string;
  location?: string;
  zip?: string;
  position: { lon: number; lat: number };
  regionalStructure?: { name: string; type: string }[];
};

export const geoRoutes = new Hono<AppEnv>();

geoRoutes.get("/status", (c) => c.json({ enabled: !!c.env.MAPY_API_KEY }));

// Address autocomplete through Mapy.com, key kept on the server
geoRoutes.get("/suggest", async (c) => {
  const q = (c.req.query("q") ?? "").trim();
  if (!c.env.MAPY_API_KEY || q.length < 3) return c.json([]);
  const url = new URL("https://api.mapy.com/v1/suggest");
  url.searchParams.set("query", q);
  url.searchParams.set("lang", "sk");
  url.searchParams.set("limit", "7");
  url.searchParams.set("locality", "sk,cz");
  url.searchParams.append("type", "regional.address");
  url.searchParams.append("type", "regional.street");
  url.searchParams.append("type", "regional.municipality");
  url.searchParams.append("type", "poi");
  url.searchParams.set("apikey", c.env.MAPY_API_KEY);
  const res = await fetch(url);
  if (!res.ok) return c.json({ error: `Mapy.com ${res.status}` }, 502);
  const data = (await res.json()) as { items: MapyItem[] };
  return c.json(
    data.items.map((i) => {
      const part = (t: string) => i.regionalStructure?.find((r) => r.type === t)?.name;
      return {
        label: [i.name, i.zip, i.location].filter(Boolean).join(", "),
        street: part("regional.street"),
        number: part("regional.address"),
        city: part("regional.municipality"),
        zip: i.zip,
        country: part("regional.country"),
        lat: i.position.lat,
        lon: i.position.lon,
        source: "mapy",
      };
    })
  );
});
