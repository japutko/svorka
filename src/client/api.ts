import { useQuery, useMutation, useQueryClient, QueryClient } from "@tanstack/react-query";
import { notifications } from "@mantine/notifications";

export type Row = Record<string, any>;
export type Address = { label: string; lat?: number; lon?: number; street?: string; number?: string; city?: string; zip?: string; source?: string };
export type Comment = { id: number; created_at: string; text: string };
export type CodelistItem = {
  id: number;
  type: string;
  label: string;
  sort_order: number;
  is_default: number;
  is_active_state: number | null;
  active: number;
  color: string | null;
  meta: Record<string, any>;
};
export type FieldDef = { id: number; entity_type: string; key: string; label: string; data_type: string; codelist_type: string | null; sort_order: number; active: number };
export type FileRow = { id: number; created_at: string; entity_type: string; entity_id: number; role: string; name: string; path: string; content_type: string; size: number };

export const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, refetchOnWindowFocus: true, retry: 1 } },
});

export async function api<T = any>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { json, ...rest } = init ?? {};
  const res = await fetch(`/api${path}`, {
    ...rest,
    headers: json !== undefined ? { "Content-Type": "application/json", ...rest.headers } : rest.headers,
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((err as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export const notifyError = (e: unknown) =>
  notifications.show({ color: "red", title: "Chyba", message: e instanceof Error ? e.message : String(e) });

// Records ---------------------------------------------------------------

export function useList<T = Row>(entity: string, filter?: Record<string, string | number | undefined>) {
  const qs = new URLSearchParams(Object.entries(filter ?? {}).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)])).toString();
  return useQuery({ queryKey: ["list", entity, qs], queryFn: () => api<T[]>(`/e/${entity}${qs ? `?${qs}` : ""}`) });
}

export function useRecord<T = Row>(entity: string, id: number | undefined) {
  return useQuery({ queryKey: ["rec", entity, id], queryFn: () => api<T>(`/e/${entity}/${id}`), enabled: !!id });
}

// Any write can change aggregated columns of other views, so refresh everything
export const invalidateAll = () => queryClient.invalidateQueries();

export async function saveRecord(entity: string, data: Row, id?: number): Promise<Row> {
  const row = id ? await api(`/e/${entity}/${id}`, { method: "PATCH", json: data }) : await api(`/e/${entity}`, { method: "POST", json: data });
  invalidateAll();
  return row;
}

export async function deleteRecord(entity: string, id: number) {
  await api(`/e/${entity}/${id}`, { method: "DELETE" });
  invalidateAll();
}

// Lookups ---------------------------------------------------------------

export function useCodelists() {
  return useQuery({ queryKey: ["codelists"], queryFn: () => api<CodelistItem[]>("/admin/codelists"), staleTime: 300_000 });
}

export function useCodelist(type: string, includeInactive = false) {
  const q = useCodelists();
  const items = (q.data ?? []).filter((c) => c.type === type && (includeInactive || c.active));
  return { items, defaultId: items.find((i) => i.is_default)?.id ?? null, isLoading: q.isLoading };
}

export function useCodelistTypes() {
  return useQuery({ queryKey: ["codelist-types"], queryFn: () => api<{ key: string; label: string }[]>("/admin/codelist-types"), staleTime: 300_000 });
}

export function useFieldDefs(entity: string) {
  const q = useQuery({ queryKey: ["fields"], queryFn: () => api<FieldDef[]>("/admin/fields"), staleTime: 300_000 });
  return (q.data ?? []).filter((f) => f.entity_type === entity && f.active);
}

export function useSettings() {
  return useQuery({ queryKey: ["settings"], queryFn: () => api<Record<string, string | null>>("/admin/settings"), staleTime: 300_000 });
}

export function useComments(entityType: string, entityId?: number) {
  return useQuery({
    queryKey: ["comments", entityType, entityId],
    queryFn: () => api<Comment[]>(`/admin/comments?entity_type=${entityType}&entity_id=${entityId}`),
    enabled: !!entityId,
  });
}

export function useAddComment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (d: { entity_type: string; entity_id: number; text: string }) => api("/admin/comments", { method: "POST", json: d }),
    onSuccess: () => qc.invalidateQueries(),
    onError: notifyError,
  });
}

export function useFiles(entityType: string, entityId?: number) {
  return useQuery({
    queryKey: ["files", entityType, entityId],
    queryFn: () => api<FileRow[]>(`/files?entity_type=${entityType}&entity_id=${entityId}`),
    enabled: !!entityId,
  });
}

export async function uploadFile(entityType: string, entityId: number, file: File | Blob, name: string, role = "attachment") {
  const fd = new FormData();
  fd.append("file", file, name);
  fd.append("entity_type", entityType);
  fd.append("entity_id", String(entityId));
  fd.append("role", role);
  const row = await api<FileRow>("/files", { method: "POST", body: fd });
  queryClient.invalidateQueries({ queryKey: ["files", entityType, entityId] });
  return row;
}

export const fileUrl = (id: number, download = false) => `/api/files/${id}/content${download ? "?download=1" : ""}`;
