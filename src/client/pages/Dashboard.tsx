import { useEffect, useState } from "react";
import { Anchor, Button, Checkbox, Group, Menu, Paper, ScrollArea, SegmentedControl, SimpleGrid, Stack, Text, Title } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { IconCar, IconClock, IconDeviceFloppy, IconGasStation, IconListCheck, IconReceipt, IconSettings } from "@tabler/icons-react";
import { Link, useNavigate } from "react-router";
import dayjs from "dayjs";
import { api, notifyError, queryClient, type Row } from "../api";
import { DataTable, StatusBadge, type Column } from "../components/DataTable";
import { DateField } from "../components/inputs";
import { TodoStrip } from "../components/Todos";
import { useForms } from "../forms/FormsProvider";
import { fmtDate, fmtMoney, fmtNum } from "../format";
import { FuelBalance } from "./ListPages";

type Preset = "this_month" | "last_month" | "this_year" | "all" | "custom";
type DashState = { preset: Preset; from?: string | null; to?: string | null; widgets: string[] };

const widgetNames: Record<string, string> = {
  quick: "Rýchle zápisy",
  todo: "Todo po termíne",
  kpi: "Súhrnné čísla",
  jobs: "Zákazky: hodiny, výnosy, náklady",
  attendance: "Dochádzka",
  fuel: "Kilometrový fond",
  active_jobs: "Všetky aktívne zákazky",
  active_leads: "Všetci aktívni leads",
};
const defaultState: DashState = { preset: "last_month", widgets: Object.keys(widgetNames) };

function range(s: DashState): [string, string] {
  const m = dayjs();
  switch (s.preset) {
    case "this_month":
      return [m.startOf("month").format("YYYY-MM-DD"), m.endOf("month").format("YYYY-MM-DD")];
    case "last_month":
      return [m.subtract(1, "month").startOf("month").format("YYYY-MM-DD"), m.subtract(1, "month").endOf("month").format("YYYY-MM-DD")];
    case "this_year":
      return [m.startOf("year").format("YYYY-MM-DD"), m.endOf("year").format("YYYY-MM-DD")];
    case "custom":
      return [s.from ?? "0000-01-01", s.to ?? "9999-12-31"];
    default:
      return ["0000-01-01", "9999-12-31"];
  }
}

const perJobColumns: Column[] = [
  { key: "title", label: "Zákazka", mobile: "title" },
  { key: "customer_name", label: "Zákazník", mobile: "sub" },
  { key: "status", label: "Stav", type: "enum", render: (r) => <StatusBadge label={r.status} color={r.status_color} /> },
  { key: "hours", label: "Hodiny", type: "number", sum: true, mobile: "sub", render: (r) => `${fmtNum(r.hours, 2)} h` },
  { key: "km", label: "Km", type: "number", sum: true },
  { key: "income", label: "Výnosy", type: "money", sum: true },
  { key: "expense", label: "Náklady", type: "money", sum: true },
  { key: "profit", label: "Výsledok", type: "money", sum: true, mobile: "meta" },
];

const attendanceColumns: Column[] = [
  { key: "person_name", label: "Kto", type: "enum", mobile: "title" },
  { key: "job_title", label: "Zákazka", type: "enum", mobile: "sub", get: (r) => r.job_title ?? "(bez zákazky)" },
  { key: "activity_type", label: "Aktivita", type: "enum", mobile: "sub" },
  { key: "days", label: "Dní", type: "number", sum: true },
  { key: "hours", label: "Hodiny", type: "number", sum: true, mobile: "meta", render: (r) => `${fmtNum(r.hours, 2)} h` },
];

function QuickActions() {
  const { openForm } = useForms();
  const big = { size: "lg" as const, variant: "light" as const, fullWidth: true, styles: { inner: { justifyContent: "flex-start" } } };
  return (
    <SimpleGrid cols={{ base: 2, sm: 5 }} spacing="xs">
      <Button {...big} leftSection={<IconClock />} onClick={() => openForm("attendance")}>
        Dochádzka
      </Button>
      <Button {...big} color="red" leftSection={<IconReceipt />} onClick={() => openForm("ledger_entry", { defaults: { direction: "expense" } })}>
        Nákup
      </Button>
      <Button {...big} leftSection={<IconCar />} onClick={() => openForm("trip")}>
        Jazda
      </Button>
      <Button {...big} leftSection={<IconGasStation />} onClick={() => openForm("refuel")}>
        Tankovanie
      </Button>
      <Button {...big} color="grape" leftSection={<IconListCheck />} onClick={() => openForm("todo")}>
        Todo
      </Button>
    </SimpleGrid>
  );
}

function ActiveJobs({ title, rows, showComment }: { title: string; rows: Row[] | undefined; showComment?: boolean }) {
  return (
    <Paper withBorder p="sm">
      <Text fw={700} mb="xs">
        {title} ({rows?.length ?? 0})
      </Text>
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
    </Paper>
  );
}

type SavedView = { id: number; name: string; state: DashState; is_default: number };

export function Dashboard() {
  const navigate = useNavigate();
  const views = useQuery({ queryKey: ["views", "dashboard"], queryFn: () => api<SavedView[]>("/admin/views?entity_type=dashboard") });
  const [state, setState] = useState<DashState>(defaultState);
  const [viewId, setViewId] = useState<number | null>(null);
  useEffect(() => {
    const def = views.data?.find((v) => v.is_default);
    if (def && viewId === null) {
      setState({ ...defaultState, ...def.state });
      setViewId(def.id);
    }
  }, [views.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const [from, to] = range(state);
  const dash = useQuery({ queryKey: ["dashboard", from, to], queryFn: () => api(`/dashboard?from=${from}&to=${to}`) });
  const t = dash.data?.totals;
  const active = useQuery({
    queryKey: ["dashboard", "active"],
    queryFn: () => api<{ active_jobs: Row[]; active_leads: Row[] }>("/dashboard/active"),
    enabled: state.widgets.includes("active_jobs") || state.widgets.includes("active_leads"),
  });
  const on = (w: string) => state.widgets.includes(w);

  const save = async () => {
    try {
      if (viewId) await api(`/admin/views/${viewId}`, { method: "PATCH", json: { state } });
      else {
        const name = prompt("Názov zobrazenia prehľadu");
        if (!name) return;
        const v = await api<SavedView>("/admin/views", { method: "POST", json: { entity_type: "dashboard", name, state, is_default: !views.data?.length } });
        setViewId(v.id);
      }
      queryClient.invalidateQueries({ queryKey: ["views", "dashboard"] });
    } catch (e) {
      notifyError(e);
    }
  };

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={2}>Prehľad</Title>
        <Group gap="xs">
          <Menu closeOnItemClick={false}>
            <Menu.Target>
              <Button variant="default" size="xs" leftSection={<IconSettings size={14} />}>
                Widgety
              </Button>
            </Menu.Target>
            <Menu.Dropdown>
              {Object.entries(widgetNames).map(([k, label]) => (
                <Menu.Item key={k}>
                  <Checkbox
                    size="xs"
                    label={label}
                    checked={on(k)}
                    onChange={(e) => setState({ ...state, widgets: e.currentTarget.checked ? [...state.widgets, k] : state.widgets.filter((w) => w !== k) })}
                  />
                </Menu.Item>
              ))}
            </Menu.Dropdown>
          </Menu>
          <Menu>
            <Menu.Target>
              <Button variant="default" size="xs" leftSection={<IconDeviceFloppy size={14} />}>
                {views.data?.find((v) => v.id === viewId)?.name ?? "Zobrazenia"}
              </Button>
            </Menu.Target>
            <Menu.Dropdown>
              {views.data?.map((v) => (
                <Menu.Item
                  key={v.id}
                  onClick={() => {
                    setState({ ...defaultState, ...v.state });
                    setViewId(v.id);
                  }}
                >
                  {v.is_default ? "★ " : ""}
                  {v.name}
                </Menu.Item>
              ))}
              <Menu.Divider />
              <Menu.Item onClick={save}>{viewId ? "Uložiť zmeny" : "Uložiť ako zobrazenie…"}</Menu.Item>
              {viewId && (
                <Menu.Item
                  onClick={async () => {
                    await api(`/admin/views/${viewId}`, { method: "PATCH", json: { is_default: true } });
                    queryClient.invalidateQueries({ queryKey: ["views", "dashboard"] });
                  }}
                >
                  Nastaviť ako predvolené
                </Menu.Item>
              )}
              {viewId && <Menu.Item onClick={() => setViewId(null)}>Nové zobrazenie…</Menu.Item>}
            </Menu.Dropdown>
          </Menu>
        </Group>
      </Group>

      {on("quick") && <QuickActions />}
      {on("todo") && <TodoStrip overdueOnly />}

      {(on("active_jobs") || on("active_leads")) && (
        <SimpleGrid cols={{ base: 1, md: on("active_jobs") && on("active_leads") ? 2 : 1 }}>
          {on("active_jobs") && <ActiveJobs title="Všetky aktívne zákazky" rows={active.data?.active_jobs} />}
          {on("active_leads") && <ActiveJobs title="Všetci aktívni leads" rows={active.data?.active_leads} showComment />}
        </SimpleGrid>
      )}

      <Group gap="xs" align="flex-end">
        <ScrollArea type="never" maw="100%">
        <SegmentedControl
          size="xs"
          value={state.preset}
          onChange={(preset) => setState({ ...state, preset: preset as Preset })}
          data={[
            { label: "Tento mesiac", value: "this_month" },
            { label: "Minulý mesiac", value: "last_month" },
            { label: "Tento rok", value: "this_year" },
            { label: "Všetko", value: "all" },
            { label: "Vlastné", value: "custom" },
          ]}
        />
        </ScrollArea>
        {state.preset === "custom" && (
          <>
            <DateField label="Od" value={state.from} onChange={(f) => setState({ ...state, from: f })} />
            <DateField label="Do" value={state.to} onChange={(x) => setState({ ...state, to: x })} />
          </>
        )}
      </Group>

      {on("kpi") && t && (
        <SimpleGrid cols={{ base: 2, sm: 4 }}>
          {[
            ["Výnosy", fmtMoney(t.income), "green"],
            ["Náklady", fmtMoney(t.expense), undefined],
            ["Výsledok", fmtMoney(t.income - t.expense), t.income - t.expense < 0 ? "red" : "green"],
            ["Odpracované", `${fmtNum(t.hours, 1)} h`, undefined],
            ["Najazdené", `${fmtNum(t.km, 0)} km`, undefined],
            ["Pohľadávky (dlžia mi)", fmtMoney(t.receivable), "orange"],
            ["Záväzky (dlžím)", fmtMoney(t.payable), "red"],
            ["Aktívne zákazky / otvorené todo", `${t.active_jobs} / ${t.open_todos}`, undefined],
          ].map(([label, value, color]) => (
            <Paper key={label} withBorder p="sm" radius="md">
              <Text size="xs" c="dimmed">
                {label}
              </Text>
              <Text fw={700} size="lg" c={color}>
                {value}
              </Text>
            </Paper>
          ))}
        </SimpleGrid>
      )}

      {on("jobs") && (
        <Paper withBorder p="sm">
          <Text fw={700} mb="xs">
            Zákazky za obdobie
          </Text>
          <DataTable
            viewKey="dashboard_jobs"
            compact
            rows={(dash.data?.per_job ?? []).map((r: Row) => ({ ...r, id: r.job_id ?? 0 }))}
            columns={perJobColumns}
            onRowClick={(r) => r.job_id && navigate(`/zakazky/${r.job_id}`)}
          />
        </Paper>
      )}

      {on("attendance") && (
        <Paper withBorder p="sm">
          <Text fw={700} mb="xs">
            Dochádzka za obdobie
          </Text>
          <DataTable
            viewKey="dashboard_attendance"
            compact
            rows={(dash.data?.attendance ?? []).map((r: Row, i: number) => ({ ...r, id: i }))}
            columns={attendanceColumns}
            defaultState={{ groupBy: "person_name" }}
          />
        </Paper>
      )}

      {on("fuel") && <FuelBalance />}
    </Stack>
  );
}
