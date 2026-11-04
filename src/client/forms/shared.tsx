import { useEffect, useState, type ReactNode } from "react";
import { Button, Divider, Group, Loader, Stack, Text, Textarea } from "@mantine/core";
import { deleteRecord, notifyError, saveRecord, useRecord, type Row } from "../api";
import { fmtDateTime } from "../format";
import { CommentJournal } from "../components/CommentJournal";

// Loads a record (edit) or starts from initial values (new) and saves it
export function useEntityForm(entity: string, id: number | undefined, init: () => Row) {
  const rec = useRecord(entity, id);
  const [v, setV] = useState<Row | null>(() => (id ? null : init()));
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (id && rec.data && !v) setV(rec.data);
  }, [id, rec.data, v]);
  const set = (patch: Row) => setV((s) => ({ ...s, ...patch }));
  const save = async (data: Row = v ?? {}) => {
    setSaving(true);
    try {
      return await saveRecord(entity, data, id);
    } catch (e) {
      notifyError(e);
      return null;
    } finally {
      setSaving(false);
    }
  };
  return { v, set, setV, save, saving, loading: !!id && !v };
}

export function FormShell(props: {
  children: ReactNode;
  loading?: boolean;
  saving?: boolean;
  onSave: () => void;
  onCancel: () => void;
  entity: string;
  id?: number;
  createdAt?: string;
  onDeleted?: () => void;
  extraActions?: ReactNode;
  saveLabel?: string;
}) {
  if (props.loading) return <Loader m="xl" />;
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        props.onSave();
      }}
    >
      <Stack gap="sm">
        {props.children}
        {props.createdAt && (
          <Text size="xs" c="dimmed">
            Založené {fmtDateTime(props.createdAt)}
          </Text>
        )}
        <Group justify="space-between" mt="sm" style={{ position: "sticky", bottom: 0, background: "var(--mantine-color-body)", paddingBlock: 8, zIndex: 5 }}>
          <Group gap="xs">
            {props.id && (
              <Button
                variant="subtle"
                color="red"
                onClick={async () => {
                  if (!confirm("Naozaj zmazať tento záznam?")) return;
                  try {
                    await deleteRecord(props.entity, props.id!);
                    props.onDeleted?.();
                  } catch (e) {
                    notifyError(e);
                  }
                }}
              >
                Zmazať
              </Button>
            )}
            {props.extraActions}
          </Group>
          <Group gap="xs">
            <Button variant="default" onClick={props.onCancel}>
              Zrušiť
            </Button>
            <Button type="submit" loading={props.saving}>
              {props.saveLabel ?? "Uložiť"}
            </Button>
          </Group>
        </Group>
      </Stack>
    </form>
  );
}

// New record: one text field that becomes the first journal entry. Existing: full journal.
export function JournalField({ entity, id, value, onChange }: { entity: string; id?: number; value?: string; onChange: (v: string) => void }) {
  if (id)
    return (
      <>
        <Divider label="Poznámky" labelPosition="left" />
        <CommentJournal entityType={entity} entityId={id} />
      </>
    );
  return <Textarea label="Poznámka" autosize minRows={2} value={value ?? ""} onChange={(e) => onChange(e.currentTarget.value)} />;
}

// Fills defaults that arrive after the form opened (lookup lists, settings still loading)
export function useLateDefaults(f: { v: Row | null; set: (p: Row) => void }, isNew: boolean, defaults: Row) {
  const key = JSON.stringify(defaults);
  useEffect(() => {
    if (!isNew || !f.v) return;
    const patch: Row = {};
    for (const [k, val] of Object.entries(defaults)) if (f.v[k] == null && val != null) patch[k] = val;
    if (Object.keys(patch).length) f.set(patch);
  }, [key, !!f.v]); // eslint-disable-line react-hooks/exhaustive-deps
}
