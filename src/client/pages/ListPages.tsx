import { Button, Group, Paper, SimpleGrid, Stack, Tabs, Text, Title } from "@mantine/core";
import { IconPlus } from "@tabler/icons-react";
import { useNavigate, useSearchParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { api, useList } from "../api";
import { DataTable, type Column, type TableState } from "../components/DataTable";
import { useForms } from "../forms/FormsProvider";
import {
  attendanceColumns, inspectionColumns, invoiceColumns, jobColumns, jobDefaultState, jobRowStyle, ledgerColumns, personColumns,
  quoteColumns, refuelColumns, tripColumns,
} from "../columns";
import { fmtMoney, fmtNum } from "../format";

export function PageHeader({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <Group justify="space-between" mb="sm">
      <Title order={2}>{title}</Title>
      <Group gap="xs">{children}</Group>
    </Group>
  );
}

// Table of one record type with "new" button and edit-on-click
export function EntityTable(props: {
  entity: string;
  columns: Column[];
  newLabel: string;
  filter?: Record<string, string | number | undefined>;
  defaults?: Record<string, unknown>;
  defaultState?: Partial<TableState>;
  rowStyle?: (r: Record<string, any>) => React.CSSProperties | undefined;
  onRowClick?: (r: Record<string, any>) => void;
  compact?: boolean;
}) {
  const { openForm } = useForms();
  const list = useList(props.entity, props.filter);
  return (
    <DataTable
      viewKey={props.entity}
      rows={list.data}
      loading={list.isLoading}
      columns={props.columns}
      defaultState={props.defaultState}
      rowStyle={props.rowStyle}
      compact={props.compact}
      onRowClick={props.onRowClick ?? ((r) => openForm(props.entity, { id: r.id }))}
      toolbar={
        <Button size="sm" leftSection={<IconPlus size={16} />} onClick={() => openForm(props.entity, { defaults: props.defaults })}>
          {props.newLabel}
        </Button>
      }
    />
  );
}

export function JobsPage() {
  const navigate = useNavigate();
  return (
    <Stack>
      <PageHeader title="Zákazky" />
      <EntityTable entity="job" columns={jobColumns} newLabel="Nová zákazka" defaultState={jobDefaultState} rowStyle={jobRowStyle} onRowClick={(r) => navigate(`/zakazky/${r.id}`)} />
    </Stack>
  );
}

export function PersonsPage() {
  return (
    <Stack>
      <PageHeader title="Osoby" />
      <EntityTable entity="person" columns={personColumns} newLabel="Nová osoba" defaultState={{ sort: [{ key: "created_at", dir: "desc" }] }} />
    </Stack>
  );
}

function Kpi({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <Paper withBorder p="sm" radius="md">
      <Text size="xs" c="dimmed">
        {label}
      </Text>
      <Text fw={700} size="lg" c={color}>
        {value}
      </Text>
    </Paper>
  );
}

export function FinancePage() {
  const dash = useQuery({ queryKey: ["dashboard", "all"], queryFn: () => api("/dashboard") });
  const t = dash.data?.totals;
  return (
    <Stack>
      <PageHeader title="Financie" />
      {t && (
        <SimpleGrid cols={{ base: 2, sm: 4 }}>
          <Kpi label="Pohľadávky (dlžia mi)" value={fmtMoney(t.receivable)} color="orange" />
          <Kpi label="Záväzky (dlžím)" value={fmtMoney(t.payable)} color="red" />
          <Kpi label="Príjmy spolu" value={fmtMoney(t.income)} color="green" />
          <Kpi label="Výdaje spolu" value={fmtMoney(t.expense)} />
        </SimpleGrid>
      )}
      <EntityTable entity="ledger_entry" columns={ledgerColumns} newLabel="Nový záznam" />
    </Stack>
  );
}

function useTab(def: string) {
  const [sp, setSp] = useSearchParams();
  return [sp.get("tab") ?? def, (t: string | null) => setSp(t ? { tab: t } : {}, { replace: true })] as const;
}

export function DocumentsPage() {
  const [tab, setTab] = useTab("inspection");
  return (
    <Stack>
      <PageHeader title="Obhliadky, ponuky, faktúry" />
      <Tabs value={tab} onChange={setTab} keepMounted={false}>
        <Tabs.List mb="sm">
          <Tabs.Tab value="inspection">Obhliadky</Tabs.Tab>
          <Tabs.Tab value="quote">Cenové ponuky</Tabs.Tab>
          <Tabs.Tab value="invoice">Faktúry / dobropisy</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="inspection">
          <EntityTable entity="inspection" columns={inspectionColumns} newLabel="Nová obhliadka" />
        </Tabs.Panel>
        <Tabs.Panel value="quote">
          <EntityTable entity="quote" columns={quoteColumns} newLabel="Nová ponuka" />
        </Tabs.Panel>
        <Tabs.Panel value="invoice">
          <EntityTable entity="invoice" columns={invoiceColumns} newLabel="Nová faktúra" />
        </Tabs.Panel>
      </Tabs>
    </Stack>
  );
}

export function FuelBalance() {
  const dash = useQuery({ queryKey: ["dashboard", "all"], queryFn: () => api("/dashboard") });
  const fuel: { car_id: number; car: string; balance: number; added: number; used: number }[] = dash.data?.fuel ?? [];
  if (!fuel.length) return null;
  return (
    <SimpleGrid cols={{ base: 2, sm: 4 }}>
      {fuel.map((f) => (
        <Paper key={f.car_id} withBorder p="sm" radius="md">
          <Text size="xs" c="dimmed">
            Kilometrový fond · {f.car}
          </Text>
          <Text fw={700} size="lg" c={f.balance < 0 ? "red" : f.balance < 100 ? "orange" : "green"}>
            {fmtNum(f.balance, 0)} km
          </Text>
          <Text size="xs" c="dimmed">
            natankované {fmtNum(f.added, 0)} · najazdené {fmtNum(f.used, 0)}
          </Text>
        </Paper>
      ))}
    </SimpleGrid>
  );
}

export function WorkPage() {
  const [tab, setTab] = useTab("attendance");
  return (
    <Stack>
      <PageHeader title="Dochádzka a jazdy" />
      <FuelBalance />
      <Tabs value={tab} onChange={setTab} keepMounted={false}>
        <Tabs.List mb="sm">
          <Tabs.Tab value="attendance">Dochádzka</Tabs.Tab>
          <Tabs.Tab value="trip">Jazdy</Tabs.Tab>
          <Tabs.Tab value="refuel">Tankovanie</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="attendance">
          <EntityTable entity="attendance" columns={attendanceColumns} newLabel="Nová dochádzka" />
        </Tabs.Panel>
        <Tabs.Panel value="trip">
          <EntityTable entity="trip" columns={tripColumns} newLabel="Nová jazda" />
        </Tabs.Panel>
        <Tabs.Panel value="refuel">
          <EntityTable entity="refuel" columns={refuelColumns} newLabel="Nové tankovanie" />
        </Tabs.Panel>
      </Tabs>
    </Stack>
  );
}
