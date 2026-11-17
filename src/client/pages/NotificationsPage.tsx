import { useState } from "react";
import { Alert, Badge, Button, Group, Modal, NumberInput, Paper, Select, Stack, Switch, Text, TextInput, Textarea } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useQuery } from "@tanstack/react-query";
import { IconPlayerPlay, IconPlus } from "@tabler/icons-react";
import { api, invalidateAll, notifyError, queryClient } from "../api";
import { fmtDateTime } from "../format";
import { PageHeader } from "./ListPages";

type Rule = { id: number; name: string; kind: string; params: Record<string, any>; enabled: number; last_run_at: string | null };

type ParamDef = {
  key: string;
  label: string;
  type: "number" | "select" | "boolean" | "sql";
  default: number | string | boolean;
  min?: number;
  unit?: string;
  options?: { value: string; label: string }[];
};
type RunReport = { rule: string; matched: number; created: number; error?: string };
type Kind = { kind: string; label: string; description: string; params: ParamDef[] };

const useKinds = () => useQuery({ queryKey: ["rule-kinds"], queryFn: () => api<Kind[]>("/notifications/kinds"), staleTime: Infinity });

const sqlHelp = `Dotaz vráti riadky so stĺpcom title (text todo), voliteľne entity_type + entity_id (väzba), due_on a key.
Príklad – obhliadky naplánované na zajtra:
SELECT 'Obhliadka zajtra: ' || job_title AS title, 'job' AS entity_type, job_id AS entity_id
FROM v_inspection WHERE date(scheduled_at) = date('now', '+1 day')`;

// "Dní po splatnosti: 7 · Iba od sumy: 50 €"
function paramSummary(kind: Kind | undefined, params: Record<string, any>) {
  if (!kind) return "";
  return kind.params
    .filter((d) => d.type !== "sql")
    .map((d) => {
      const v = params[d.key] ?? d.default;
      if (d.type === "boolean") return v ? d.label : null;
      if (d.type === "select") return `${d.label}: ${d.options?.find((o) => o.value === v)?.label ?? v}`;
      if (d.key === "min_amount" && !Number(v)) return null;
      return `${d.label}: ${v}${d.unit ? ` ${d.unit}` : ""}`;
    })
    .filter(Boolean)
    .join(" · ");
}

function ParamInput({ def, value, onChange }: { def: ParamDef; value: any; onChange: (v: any) => void }) {
  const v = value ?? def.default;
  if (def.type === "number")
    return <NumberInput label={def.label} min={def.min ?? 0} suffix={def.unit ? ` ${def.unit}` : undefined} value={v} onChange={(x) => onChange(x === "" ? def.default : Number(x))} />;
  if (def.type === "boolean") return <Switch label={def.label} checked={!!v} onChange={(e) => onChange(e.currentTarget.checked)} />;
  if (def.type === "select") return <Select label={def.label} data={def.options ?? []} value={String(v)} allowDeselect={false} onChange={(x) => onChange(x ?? def.default)} />;
  return (
    <>
      <Textarea label={def.label} autosize minRows={5} ff="monospace" value={v ?? ""} onChange={(e) => onChange(e.currentTarget.value)} />
      <Text size="xs" c="dimmed" style={{ whiteSpace: "pre-wrap" }}>
        {sqlHelp}
      </Text>
    </>
  );
}

function RuleEditor({ rule, onClose }: { rule: Partial<Rule> | null; onClose: () => void }) {
  const kinds = useKinds();
  const [r, setR] = useState<Partial<Rule>>(rule ?? {});
  // Until the user types a name, a new rule is named after its type
  const [nameTouched, setNameTouched] = useState(!!rule?.id);
  const kind = kinds.data?.find((k) => k.kind === r.kind);
  const p = r.params ?? {};
  const save = async () => {
    try {
      if (r.id) await api(`/notifications/rules/${r.id}`, { method: "PATCH", json: { name: r.name, params: p } });
      else await api("/notifications/rules", { method: "POST", json: { name: r.name, kind: r.kind, params: p } });
      queryClient.invalidateQueries({ queryKey: ["rules"] });
      onClose();
    } catch (e) {
      notifyError(e);
    }
  };
  return (
    <Modal opened={!!rule} onClose={onClose} title={r.id ? "Upraviť pravidlo" : "Nové pravidlo"} size="lg">
      <Stack>
        <Select
          label="Čo sledovať"
          placeholder="Vyber typ pravidla"
          disabled={!!r.id}
          allowDeselect={false}
          data={(kinds.data ?? []).map((k) => ({ value: k.kind, label: k.label }))}
          value={r.kind ?? null}
          onChange={(k) => {
            const next = kinds.data?.find((x) => x.kind === k);
            setR({ ...r, kind: k ?? undefined, params: {}, name: nameTouched ? r.name : next?.label });
          }}
          description={kind?.description}
        />
        {kind?.params.map((d) => (
          <ParamInput key={d.key} def={d} value={p[d.key]} onChange={(x) => setR({ ...r, params: { ...p, [d.key]: x } })} />
        ))}
        <TextInput
          label="Názov"
          value={r.name ?? ""}
          onChange={(e) => {
            setNameTouched(true);
            setR({ ...r, name: e.currentTarget.value });
          }}
        />
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Zrušiť
          </Button>
          <Button onClick={save} disabled={!r.name || !r.kind}>
            Uložiť
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

export function NotificationsPage() {
  const rules = useQuery({ queryKey: ["rules"], queryFn: () => api<Rule[]>("/notifications/rules") });
  const kinds = useKinds();
  const kindOf = (r: Rule) => kinds.data?.find((k) => k.kind === r.kind);
  const [editing, setEditing] = useState<Partial<Rule> | null>(null);
  const [running, setRunning] = useState(false);
  // Result of the last manual run: per rule, how many records it applies to and how many todos were new
  const [report, setReport] = useState<RunReport[] | null>(null);

  const run = async (ruleId?: number) => {
    setRunning(true);
    try {
      const report = await api<RunReport[]>(`/notifications/run${ruleId ? `?rule_id=${ruleId}` : ""}`, { method: "POST" });
      const created = report.reduce((a, r) => a + r.created, 0);
      const errors = report.filter((r) => r.error);
      notifications.show({ color: errors.length ? "red" : created ? "green" : "gray", title: `Vytvorených todo: ${created}`, message: errors.length ? "Niektoré pravidlá skončili chybou." : "Pravidlá prebehli." });
      setReport(report);
      invalidateAll();
    } catch (e) {
      notifyError(e);
    } finally {
      setRunning(false);
    }
  };

  return (
    <Stack>
      <PageHeader title="Notifikácie">
        <Button size="sm" variant="light" leftSection={<IconPlayerPlay size={16} />} loading={running} onClick={() => run()}>
          Spustiť teraz
        </Button>
        <Button size="sm" leftSection={<IconPlus size={16} />} onClick={() => setEditing({ params: {} })}>
          Nové pravidlo
        </Button>
      </PageHeader>
      <Text size="sm" c="dimmed">
        Pravidlá bežia automaticky každé ráno a vytvárajú položky v Todo. Každú položku treba ručne odkliknúť ako vybavenú.
      </Text>
      {report && (
        <Alert
          color={report.some((r) => r.error) ? "red" : "gray"}
          title="Výsledok posledného spustenia"
          withCloseButton
          onClose={() => setReport(null)}
        >
          {report.length === 0 && <Text size="sm">Žiadne zapnuté pravidlo.</Text>}
          {report.map((r, i) => (
            <Text key={i} size="sm" c={r.error ? "red" : r.matched ? undefined : "dimmed"}>
              <b>{r.rule}:</b>{" "}
              {r.error
                ? `chyba – ${r.error}`
                : r.matched === 0
                  ? "pravidlu teraz nič nevyhovuje"
                  : `vyhovuje ${r.matched}, nových todo ${r.created}${r.created < r.matched ? ` (${r.matched - r.created} už todo malo)` : ""}`}
            </Text>
          ))}
        </Alert>
      )}
      <Stack gap="xs">
        {rules.data?.map((r) => (
          <Paper key={r.id} withBorder p="sm">
            <Group justify="space-between" wrap="nowrap">
              <div>
                <Group gap="xs">
                  <Text fw={600}>{r.name}</Text>
                  <Badge size="xs" variant="outline" color="gray">
                    {kindOf(r)?.label ?? r.kind}
                  </Badge>
                </Group>
                <Text size="sm">{paramSummary(kindOf(r), r.params)}</Text>
                <Text size="xs" c="dimmed">
                  {r.last_run_at ? `Naposledy ${fmtDateTime(r.last_run_at)}` : "Ešte nebežalo"}
                </Text>
              </div>
              <Group gap="xs" wrap="nowrap">
                <Switch
                  checked={!!r.enabled}
                  onChange={async (e) => {
                    await api(`/notifications/rules/${r.id}`, { method: "PATCH", json: { enabled: e.currentTarget.checked } });
                    queryClient.invalidateQueries({ queryKey: ["rules"] });
                  }}
                />
                <Button size="compact-xs" variant="subtle" onClick={() => setEditing(r)}>
                  Upraviť
                </Button>
                <Button size="compact-xs" variant="subtle" onClick={() => run(r.id)} disabled={!r.enabled}>
                  Spustiť
                </Button>
                <Button
                  size="compact-xs"
                  variant="subtle"
                  color="red"
                  onClick={async () => {
                    if (!confirm("Zmazať pravidlo?")) return;
                    await api(`/notifications/rules/${r.id}`, { method: "DELETE" });
                    queryClient.invalidateQueries({ queryKey: ["rules"] });
                  }}
                >
                  Zmazať
                </Button>
              </Group>
            </Group>
          </Paper>
        ))}
      </Stack>
      {editing && <RuleEditor rule={editing} onClose={() => setEditing(null)} />}
    </Stack>
  );
}
