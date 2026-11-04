import { useState } from "react";
import { Anchor, Badge, Button, Grid, Group, Modal, NumberInput, Paper, Select, Stack, Switch, Text, TextInput, Textarea } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useQuery } from "@tanstack/react-query";
import { IconPlayerPlay, IconPlus } from "@tabler/icons-react";
import { Link } from "react-router";
import { api, invalidateAll, notifyError, queryClient, type Row } from "../api";
import { StatusBadge } from "../components/DataTable";
import { fmtDate, fmtDateTime } from "../format";
import { PageHeader } from "./ListPages";

type Rule = { id: number; name: string; kind: string; params: Record<string, any>; enabled: number; last_run_at: string | null };

const kinds: Record<string, string> = {
  missing_attendance: "Chýbajúca dochádzka v pracovný deň",
  overdue_invoice: "Faktúra po splatnosti",
  stale_job: "Aktívna zákazka bez pohybu",
  sql: "Vlastný SQL dotaz",
};

const sqlHelp = `Dotaz vráti riadky so stĺpcom title (text todo), voliteľne entity_type + entity_id (väzba), due_on a key.
Príklad – obhliadky naplánované na zajtra:
SELECT 'Obhliadka zajtra: ' || job_title AS title, 'job' AS entity_type, job_id AS entity_id
FROM v_inspection WHERE date(scheduled_at) = date('now', '+1 day')`;

function RuleEditor({ rule, onClose }: { rule: Partial<Rule> | null; onClose: () => void }) {
  const [r, setR] = useState<Partial<Rule>>(rule ?? {});
  const p = r.params ?? {};
  const setP = (patch: Row) => setR({ ...r, params: { ...p, ...patch } });
  const save = async () => {
    try {
      if (r.id) await api(`/notifications/rules/${r.id}`, { method: "PATCH", json: { name: r.name, params: r.params } });
      else await api("/notifications/rules", { method: "POST", json: { name: r.name, kind: r.kind, params: r.params ?? {} } });
      queryClient.invalidateQueries({ queryKey: ["rules"] });
      onClose();
    } catch (e) {
      notifyError(e);
    }
  };
  return (
    <Modal opened={!!rule} onClose={onClose} title={r.id ? "Upraviť pravidlo" : "Nové pravidlo"} size="lg">
      <Stack>
        <TextInput label="Názov" value={r.name ?? ""} onChange={(e) => setR({ ...r, name: e.currentTarget.value })} />
        <Select label="Typ" disabled={!!r.id} data={Object.entries(kinds).map(([value, label]) => ({ value, label }))} value={r.kind ?? null} onChange={(kind) => setR({ ...r, kind: kind ?? undefined })} />
        {r.kind === "missing_attendance" && (
          <NumberInput label="Kontrolovať posledných dní" value={p.lookback_days ?? 14} onChange={(x) => setP({ lookback_days: Number(x) })} />
        )}
        {r.kind === "overdue_invoice" && <NumberInput label="Dní po splatnosti" value={p.days ?? 7} onChange={(x) => setP({ days: Number(x) })} />}
        {r.kind === "stale_job" && <NumberInput label="Dní bez pohybu (poznámka, dochádzka, financie)" value={p.days ?? 30} onChange={(x) => setP({ days: Number(x) })} />}
        {r.kind === "sql" && (
          <>
            <Textarea label="SQL (iba SELECT)" autosize minRows={5} ff="monospace" value={p.query ?? ""} onChange={(e) => setP({ query: e.currentTarget.value })} />
            <Text size="xs" c="dimmed" style={{ whiteSpace: "pre-wrap" }}>
              {sqlHelp}
            </Text>
          </>
        )}
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
  const overview = useQuery({ queryKey: ["overview"], queryFn: () => api<{ active_jobs: Row[]; active_leads: Row[] }>("/notifications/overview") });
  const [editing, setEditing] = useState<Partial<Rule> | null>(null);
  const [running, setRunning] = useState(false);

  const run = async (ruleId?: number) => {
    setRunning(true);
    try {
      const report = await api<{ rule: string; created: number; error?: string }[]>(`/notifications/run${ruleId ? `?rule_id=${ruleId}` : ""}`, { method: "POST" });
      const created = report.reduce((a, r) => a + r.created, 0);
      const errors = report.filter((r) => r.error);
      notifications.show({
        color: errors.length ? "red" : "green",
        title: `Vytvorených todo: ${created}`,
        message: errors.length ? errors.map((e) => `${e.rule}: ${e.error}`).join("\n") : "Pravidlá prebehli.",
      });
      invalidateAll();
    } catch (e) {
      notifyError(e);
    } finally {
      setRunning(false);
    }
  };

  const jobList = (rows: Row[] | undefined, showComment: boolean) => (
    <Stack gap={6}>
      {rows?.map((j) => (
        <div key={j.id}>
          <Group gap="xs" wrap="nowrap">
            <StatusBadge label={j.status} color={j.status_color} />
            <Anchor component={Link} to={`/zakazky/${j.id}`} size="sm" fw={500}>
              {j.title}
            </Anchor>
            <Text size="xs" c="dimmed">
              {j.customer_name}
            </Text>
          </Group>
          {showComment && j.last_comment && (
            <Text size="xs" c="dimmed" lineClamp={2} ml="xs">
              {fmtDate(j.last_comment_at)}: {j.last_comment}
            </Text>
          )}
        </div>
      ))}
      {!rows?.length && (
        <Text size="sm" c="dimmed">
          Žiadne
        </Text>
      )}
    </Stack>
  );

  return (
    <Stack>
      <PageHeader title="Notifikácie">
        <Button size="sm" variant="light" leftSection={<IconPlayerPlay size={16} />} loading={running} onClick={() => run()}>
          Spustiť teraz
        </Button>
        <Button size="sm" leftSection={<IconPlus size={16} />} onClick={() => setEditing({ kind: "sql", params: {} })}>
          Nové pravidlo
        </Button>
      </PageHeader>
      <Text size="sm" c="dimmed">
        Pravidlá bežia automaticky každé ráno a vytvárajú položky v Todo. Každú položku treba ručne odkliknúť ako vybavenú.
      </Text>
      <Stack gap="xs">
        {rules.data?.map((r) => (
          <Paper key={r.id} withBorder p="sm">
            <Group justify="space-between" wrap="nowrap">
              <div>
                <Group gap="xs">
                  <Text fw={600}>{r.name}</Text>
                  <Badge size="xs" variant="outline" color="gray">
                    {kinds[r.kind] ?? r.kind}
                  </Badge>
                </Group>
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
      <Grid>
        <Grid.Col span={{ base: 12, md: 6 }}>
          <Paper withBorder p="sm">
            <Text fw={700} mb="xs">
              Aktívne zákazky ({overview.data?.active_jobs.length ?? 0})
            </Text>
            {jobList(overview.data?.active_jobs, false)}
          </Paper>
        </Grid.Col>
        <Grid.Col span={{ base: 12, md: 6 }}>
          <Paper withBorder p="sm">
            <Text fw={700} mb="xs">
              Aktívne leady ({overview.data?.active_leads.length ?? 0})
            </Text>
            {jobList(overview.data?.active_leads, true)}
          </Paper>
        </Grid.Col>
      </Grid>
      {editing && <RuleEditor rule={editing} onClose={() => setEditing(null)} />}
    </Stack>
  );
}
