import { Anchor, Badge, Button, Grid, Group, Loader, Paper, SimpleGrid, Stack, Tabs, Text, Title } from "@mantine/core";
import { IconArrowLeft, IconEdit, IconMapPin, IconPhone } from "@tabler/icons-react";
import { Link, useParams, useSearchParams } from "react-router";
import { useList, useRecord } from "../api";
import { CommentJournal } from "../components/CommentJournal";
import { DataTable, StatusBadge } from "../components/DataTable";
import { FileSection } from "../components/Files";
import { AddressLink } from "../components/inputs";
import { TodoStrip } from "../components/Todos";
import { useForms } from "../forms/FormsProvider";
import { attendanceColumns, inspectionColumns, invoiceColumns, ledgerColumns, quoteColumns, tripColumns } from "../columns";
import { fmtDate, fmtMoney, fmtNum } from "../format";
import { EntityTable } from "./ListPages";

export function JobDetail() {
  const id = Number(useParams().id);
  const { data: job, isLoading } = useRecord("job", id);
  const customer = useRecord("person", job?.customer_id ?? undefined);
  const { openForm } = useForms();
  const [sp, setSp] = useSearchParams();
  const tab = sp.get("tab") ?? "notes";
  if (isLoading) return <Loader />;
  if (!job) return <Text>Zákazka neexistuje.</Text>;

  // Lists inside the job: filtered by it, new records prefilled with it
  const sub = (entity: string, columns: typeof ledgerColumns, label: string, filterKey = "job_id") => (
    <EntityTable entity={entity} columns={columns} newLabel={label} filter={{ [filterKey]: id }} defaults={{ job_id: id }} compact />
  );

  return (
    <Stack>
      <Group gap="xs">
        <Button component={Link} to="/zakazky" variant="subtle" size="compact-sm" leftSection={<IconArrowLeft size={14} />}>
          Zákazky
        </Button>
      </Group>
      <Group justify="space-between" align="flex-start">
        <div>
          <Group gap="xs">
            <Title order={2}>{job.title}</Title>
            <StatusBadge label={job.status} color={job.status_color} />
            {!job.is_active && <Badge color="gray">neaktívna</Badge>}
            {job.type && (
              <Badge variant="outline" color="gray">
                {job.type}
              </Badge>
            )}
          </Group>
          <Text size="sm" c="dimmed">
            Založená {fmtDate(job.created_at)}
          </Text>
        </div>
        <Button leftSection={<IconEdit size={16} />} variant="light" onClick={() => openForm("job", { id })}>
          Upraviť
        </Button>
      </Group>

      <Grid>
        <Grid.Col span={{ base: 12, sm: 6 }}>
          <Paper withBorder p="sm" h="100%">
            <Text size="xs" c="dimmed">
              Zákazník
            </Text>
            {job.customer_id ? (
              <Anchor fw={600} onClick={() => openForm("person", { id: job.customer_id })}>
                {job.customer_name}
              </Anchor>
            ) : (
              <Text c="dimmed">—</Text>
            )}
            {job.customer_phone && (
              <Group gap={4}>
                <IconPhone size={14} />
                <Anchor href={`tel:${job.customer_phone}`} size="sm">
                  {job.customer_phone}
                </Anchor>
              </Group>
            )}
            {customer.data?.billing_address?.label && (
              <Group gap={4} wrap="nowrap">
                <IconMapPin size={14} />
                <AddressLink value={customer.data.billing_address} />
              </Group>
            )}
            <Text size="xs" c="dimmed" mt="xs">
              Lokalita
            </Text>
            <AddressLink value={job.location_address} />
            {job.billing_address?.label && job.billing_address.label !== job.location_address?.label && (
              <>
                <Text size="xs" c="dimmed" mt="xs">
                  Fakturačná adresa
                </Text>
                <AddressLink value={job.billing_address} />
              </>
            )}
          </Paper>
        </Grid.Col>
        <Grid.Col span={{ base: 12, sm: 6 }}>
          <SimpleGrid cols={2} h="100%">
            <Paper withBorder p="sm">
              <Text size="xs" c="dimmed">
                Hodiny
              </Text>
              <Text fw={700} size="lg">
                {fmtNum(job.hours_total)} h
              </Text>
            </Paper>
            <Paper withBorder p="sm">
              <Text size="xs" c="dimmed">
                Výsledok
              </Text>
              <Text fw={700} size="lg" c={job.income_total - job.expense_total < 0 ? "red" : "green"}>
                {fmtMoney(job.income_total - job.expense_total)}
              </Text>
            </Paper>
            <Paper withBorder p="sm">
              <Text size="xs" c="dimmed">
                Príjmy
              </Text>
              <Text fw={600}>{fmtMoney(job.income_total)}</Text>
            </Paper>
            <Paper withBorder p="sm">
              <Text size="xs" c="dimmed">
                Výdaje
              </Text>
              <Text fw={600}>{fmtMoney(job.expense_total)}</Text>
            </Paper>
          </SimpleGrid>
        </Grid.Col>
      </Grid>

      <TodoStrip entityType="job" entityId={id} max={10} />

      <Tabs value={tab} onChange={(t) => setSp(t ? { tab: t } : {}, { replace: true })} keepMounted={false}>
        <Tabs.List mb="sm" style={{ flexWrap: "wrap" }}>
          <Tabs.Tab value="notes">Poznámky a súbory</Tabs.Tab>
          <Tabs.Tab value="finance">Financie</Tabs.Tab>
          <Tabs.Tab value="attendance">Dochádzka</Tabs.Tab>
          <Tabs.Tab value="trips">Jazdy</Tabs.Tab>
          <Tabs.Tab value="inspections">Obhliadky</Tabs.Tab>
          <Tabs.Tab value="quotes">Ponuky</Tabs.Tab>
          <Tabs.Tab value="invoices">Faktúry</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="notes">
          <Grid>
            <Grid.Col span={{ base: 12, md: 7 }}>
              <CommentJournal entityType="job" entityId={id} />
            </Grid.Col>
            <Grid.Col span={{ base: 12, md: 5 }}>
              <Stack>
                <FileSection entityType="job" entityId={id} title="Dokumenty zákazky" />
                <Button variant="light" size="xs" onClick={() => openForm("todo", { defaults: { links: [{ entity_type: "job", entity_id: id, label: job.title }] } })}>
                  + Todo k zákazke
                </Button>
              </Stack>
            </Grid.Col>
          </Grid>
        </Tabs.Panel>
        <Tabs.Panel value="finance">
          <FinanceForJob jobId={id} />
        </Tabs.Panel>
        <Tabs.Panel value="attendance">{sub("attendance", attendanceColumns, "Nová dochádzka")}</Tabs.Panel>
        <Tabs.Panel value="trips">{sub("trip", tripColumns, "Nová jazda")}</Tabs.Panel>
        <Tabs.Panel value="inspections">{sub("inspection", inspectionColumns, "Nová obhliadka")}</Tabs.Panel>
        <Tabs.Panel value="quotes">{sub("quote", quoteColumns, "Nová ponuka")}</Tabs.Panel>
        <Tabs.Panel value="invoices">{sub("invoice", invoiceColumns, "Nová faktúra")}</Tabs.Panel>
      </Tabs>
    </Stack>
  );
}

// Ledger entries are linked through their parts, so filter on the client
function FinanceForJob({ jobId }: { jobId: number }) {
  const { openForm } = useForms();
  const { data } = useRecord("job", jobId);
  return (
    <Stack>
      <Group>
        <Button size="sm" onClick={() => openForm("ledger_entry", { defaults: { direction: "expense", splits: [{ job_id: jobId, amount: null }] } })}>
          + Výdaj
        </Button>
        <Button size="sm" color="green" onClick={() => openForm("ledger_entry", { defaults: { direction: "income", splits: [{ job_id: jobId, amount: null }], counterparty_id: data?.customer_id } })}>
          + Príjem
        </Button>
      </Group>
      <JobLedger jobId={jobId} />
    </Stack>
  );
}

function JobLedger({ jobId }: { jobId: number }) {
  const { openForm } = useForms();
  const list = useList("ledger_entry");
  const rows = (list.data ?? [])
    .filter((e) => (e.splits ?? []).some((s: { job_id: number }) => s.job_id === jobId))
    .map((e) => {
      // Show only this job's share of a split receipt
      const share = e.splits.filter((s: { job_id: number }) => s.job_id === jobId).reduce((a: number, s: { amount: number }) => a + s.amount, 0);
      return { ...e, amount: share };
    });
  return <DataTable viewKey="ledger_entry" compact rows={rows} loading={list.isLoading} columns={ledgerColumns} onRowClick={(r) => openForm("ledger_entry", { id: r.id })} />;
}
