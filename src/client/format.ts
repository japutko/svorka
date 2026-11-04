import dayjs from "dayjs";
import type { Address } from "./api";

export const todayIso = () => dayjs().format("YYYY-MM-DD");

export const fmtDate = (s?: string | null) => (s ? dayjs(s.length > 10 ? s : s + "T00:00").format("D.M.YYYY") : "");
export const fmtDateTime = (s?: string | null) => (s ? dayjs(s).format("D.M.YYYY HH:mm") : "");

const money = new Intl.NumberFormat("sk-SK", { style: "currency", currency: "EUR" });
export const fmtMoney = (n?: number | null) => (n == null || (n as unknown) === "" ? "" : money.format(Number(n)));
export const fmtNum = (n?: number | null, digits = 1) =>
  n == null ? "" : Number(n).toLocaleString("sk-SK", { maximumFractionDigits: digits });

// Link to Mapy.com: exact point when coordinates are known, otherwise a search
export function mapLink(a?: Address | null) {
  if (!a?.label) return null;
  if (a.lat != null && a.lon != null) return `https://mapy.com/fnc/v1/showmap?center=${a.lon},${a.lat}&zoom=17&marker=true`;
  return `https://mapy.com/fnc/v1/search?query=${encodeURIComponent(a.label)}`;
}

export const addressLabel = (a?: Address | string | null) => (!a ? "" : typeof a === "string" ? a : a.label ?? "");

// Removes diacritics for search
export const norm = (s: unknown) =>
  String(s ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
