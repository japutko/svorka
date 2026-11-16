import { useEffect, useState } from "react";
import { ActionIcon, Alert, Button, Checkbox, Divider, Group, Loader, Modal, Paper, SegmentedControl, Select, Stack, Text, TextInput, Textarea, Title } from "@mantine/core";
import { IconPlus, IconSparkles, IconTrash } from "@tabler/icons-react";
import dayjs from "dayjs";
import { api, notifyError, uploadFile, useCodelist, useList, type Row } from "../api";
import { CodelistSelect, CustomFields, DateField, EntityPicker, MoneyInput, Row2 } from "../components/inputs";
import { FileSection, ReceiptPages, buildPdf, toJpeg } from "../components/Files";
import { fmtDate, fmtMoney, todayIso } from "../format";
import { useForms, type FormProps } from "./FormsProvider";
import { FormShell, useEntityForm, useLateDefaults } from "./shared";

type Split = { job_id: number | null; amount: number | null; title?: string; description?: string };

type ReceiptRead = {
  direction: "income" | "expense";
  realized_on: string;
  amount: number | null;
  title: string | null;
  description: string | null;
  paid: boolean;
  due_on: string | null;
  payment_method_id: number | null;
  supplier_name: string | null;
  counterparty_id: number | null;
  counterparty_name: string | null;
  job_id: number | null;
  job_title: string | null;
  job_reason: string | null;
};

// Photos are shrunk before upload; PDFs go as they are (the server reads their text)
async function readReceipt(pages: File[]) {
  const fd = new FormData();
  for (const p of pages) {
    if (p.type === "application/pdf") fd.append("file", p, p.name);
    else fd.append("file", new Blob([(await toJpeg(p, 1600)) as BlobPart], { type: "image/jpeg" }), "page.jpg");
  }
  return api<ReceiptRead>("/ai/receipt", { method: "POST", body: fd });
}

export function LedgerForm({ id, defaults: given, onDone }: FormProps) {
  // A scanned receipt arrives as __pages and is read once the form opens
  const { __pages: scanned, ...defaults } = given ?? {};
  const pm = useCodelist("payment_method");
  const invoices = useList("invoice");
  const { openForm } = useForms();
  const [pages, setPages] = useState<File[]>(scanned ?? []);
  const [reading, setReading] = useState(false);
  const [read, setRead] = useState<ReceiptRead | null>(null);
  const [attachments, setAttachments] = useState<File[]>([]);
  const [created, setCreated] = useState<Row | null>(null);
  const [busy, setBusy] = useState(false);
  const f = useEntityForm("ledger_entry", id, () => {
    const d = { direction: "expense", realized_on: todayIso(), payment_method_id: pm.defaultId, custom_fields: {}, splits: [{ job_id: null, amount: null }], ...defaults };
    return { ...d, paid_on: "paid_on" in (defaults ?? {}) ? defaults!.paid_on : d.realized_on };
  });
  useLateDefaults(f, !id, { payment_method_id: pm.defaultId });

  const fillFromReceipt = async () => {
    setReading(true);
    try {
      const r = await readReceipt(pages);
      setRead(r);
      const note = !r.paid && r.due_on ? `Splatnosť ${fmtDate(r.due_on)}` : null;
      f.set({
        direction: r.direction,
        realized_on: r.realized_on,
        paid_on: r.paid ? r.realized_on : null,
        ...(r.amount != null ? { amount: r.amount } : {}),
        ...(r.title ? { title: r.title } : {}),
        ...(r.description || note ? { description: [r.description, note].filter(Boolean).join("\n") } : {}),
        ...(r.payment_method_id ? { payment_method_id: r.payment_method_id } : {}),
        ...(r.counterparty_id ? { counterparty_id: r.counterparty_id } : {}),
        splits: [{ job_id: r.job_id, amount: r.amount }],
      });
    } catch (e) {
      notifyError(e);
    } finally {
      setReading(false);
    }
  };
  useEffect(() => {
    if (!id && scanned?.length) fillFromReceipt();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!f.v) return <FormShell loading entity="ledger_entry" onSave={() => {}} onCancel={() => onDone(null)}>{null}</FormShell>;
  const v = f.v;
  const splits: Split[] = v.splits?.length ? v.splits : [{ job_id: null, amount: null }];
  const multi = splits.length > 1;
  const splitSum = splits.reduce((a, s) => a + (Number(s.amount) || 0), 0);
  const diff = Math.round(((Number(v.amount) || 0) - splitSum) * 100) / 100;
  const setSplit = (i: number, patch: Partial<Split>) => f.set({ splits: splits.map((s, j) => (j === i ? { ...s, ...patch } : s)) });

  const submit = async () => {
    if (multi && diff !== 0) return notifyError(new Error(`Časti nesedia so sumou (rozdiel ${fmtMoney(diff)})`));
    // A single part always carries the whole amount
    const data = { ...v, splits: multi ? splits : [{ ...splits[0], amount: v.amount, title: null, description: null }] };
    setBusy(true);
    const row = await f.save(data);
    if (!row) return setBusy(false);
    try {
      if (pages.length) await uploadFile("ledger_entry", row.id, await buildPdf(pages), `${row.code}.pdf`, "receipt");
      for (const a of attachments) await uploadFile("ledger_entry", row.id, a, a.name, "attachment");
    } catch (e) {
      notifyError(e);
    }
    setBusy(false);
    // Show the number to write on the paper receipt
    if (!id) setCreated(row);
    else onDone(row);
  };

  return (
    <>
      <Modal opened={!!created} onClose={() => onDone(created)} centered withCloseButton={false} zIndex={1000}>
        <Stack align="center" gap="xs" py="md">
          <Text c="dimmed">Číslo účtovného záznamu — napíš na doklad:</Text>
          <Title order={1} style={{ fontSize: 56, letterSpacing: 2 }}>
            {created?.code}
          </Title>
          <Text size="sm">
            {created?.title} · {fmtMoney(created?.amount)}
          </Text>
          <Button mt="md" size="md" onClick={() => onDone(created)}>
            Hotovo
          </Button>
        </Stack>
      </Modal>
      <FormShell entity="ledger_entry" id={id} createdAt={v.created_at} saving={f.saving || busy} onSave={submit} onCancel={() => onDone(null)} onDeleted={() => onDone(null)}>
        {id && (
          <Text fw={700} size="lg">
            {v.code}
          </Text>
        )}
        {reading && (
          <Alert color="blue" p="xs" icon={<Loader size="xs" />}>
            Čítam doklad…
          </Alert>
        )}
        {read && !reading && (
          <Alert color="teal" p="xs" icon={<IconSparkles size={16} />} withCloseButton onClose={() => setRead(null)}>
            <Text size="sm">Vyplnené z dokladu, skontroluj sumu a dátum.</Text>
            {read.job_title && (
              <Text size="xs" c="dimmed">
                Zákazka {read.job_title}
                {read.job_reason ? ` – ${read.job_reason}` : ""}
              </Text>
            )}
            {read.supplier_name && !read.counterparty_id && !v.counterparty_id && (
              <Button
                size="compact-xs"
                variant="light"
                mt={4}
                onClick={async () => {
                  const row = await openForm("person", { defaults: { name: read.supplier_name } });
                  if (row) f.set({ counterparty_id: row.id });
                }}
              >
                Založiť dodávateľa {read.supplier_name}
              </Button>
            )}
          </Alert>
        )}
        <SegmentedControl
          fullWidth
          value={v.direction}
          onChange={(direction) => f.set({ direction })}
          data={[
            { label: "Výdaj", value: "expense" },
            { label: "Príjem", value: "income" },
          ]}
          color={v.direction === "income" ? "green" : "red"}
        />
        <Row2>
          <MoneyInput label="Suma" required value={v.amount} onChange={(amount) => f.set({ amount })} />
          <DateField label="Dátum realizácie" required value={v.realized_on} onChange={(realized_on) => f.set({ realized_on, ...(v.paid_on === v.realized_on ? { paid_on: realized_on } : {}) })} />
        </Row2>
        <TextInput label="Nadpis" required value={v.title ?? ""} onChange={(e) => f.set({ title: e.currentTarget.value })} placeholder={v.direction === "expense" ? "napr. Hornbach – materiál" : "napr. Úhrada za práce"} />
        {!multi && <EntityPicker entity="job" label="Zákazka" value={splits[0].job_id} onChange={(job_id) => setSplit(0, { job_id })} />}
        {multi && (
          <Stack gap="xs">
            <Text size="sm" fw={500}>
              Rozdelenie na časti
            </Text>
            {splits.map((s, i) => (
              <Paper key={i} withBorder p="xs">
                <Stack gap={6}>
                  <Group gap="xs" align="flex-end" wrap="nowrap">
                    <div style={{ flex: 1 }}>
                      <EntityPicker entity="job" label={`Časť ${i + 1} – zákazka`} value={s.job_id} onChange={(job_id) => setSplit(i, { job_id })} placeholder="bez zákazky (réžia)" />
                    </div>
                    <div style={{ width: 130 }}>
                      <MoneyInput label="Suma" value={s.amount} onChange={(amount) => setSplit(i, { amount })} />
                    </div>
                    <ActionIcon color="red" variant="subtle" mb={6} onClick={() => f.set({ splits: splits.filter((_, j) => j !== i) })}>
                      <IconTrash size={16} />
                    </ActionIcon>
                  </Group>
                  <TextInput size="xs" placeholder="Nadpis časti (napr. náradie)" value={s.title ?? ""} onChange={(e) => setSplit(i, { title: e.currentTarget.value })} />
                  <TextInput size="xs" placeholder="Popis časti" value={s.description ?? ""} onChange={(e) => setSplit(i, { description: e.currentTarget.value })} />
                </Stack>
              </Paper>
            ))}
            {diff !== 0 && (
              <Alert color={diff > 0 ? "yellow" : "red"} p="xs">
                {diff > 0 ? `Zostáva rozdeliť ${fmtMoney(diff)}` : `Časti presahujú sumu o ${fmtMoney(-diff)}`}
                {diff > 0 && (
                  <Button size="compact-xs" ml="sm" variant="light" onClick={() => f.set({ splits: [...splits, { job_id: null, amount: diff }] })}>
                    Pridať zvyšok ako časť
                  </Button>
                )}
              </Alert>
            )}
          </Stack>
        )}
        <Group>
          <Button
            size="compact-sm"
            variant="subtle"
            leftSection={<IconPlus size={14} />}
            onClick={() =>
              f.set({
                splits: multi
                  ? [...splits, { job_id: null, amount: diff > 0 ? diff : null }]
                  : [{ ...splits[0], amount: v.amount }, { job_id: null, amount: null }],
              })
            }
          >
            {multi ? "Ďalšia časť" : "Rozdeliť na viac zákaziek / častí"}
          </Button>
        </Group>
        <Row2>
          <CodelistSelect type="payment_method" label="Spôsob platby" value={v.payment_method_id} onChange={(payment_method_id) => f.set({ payment_method_id })} />
          <TextInput label="Poznámka k platbe" value={v.payment_note ?? ""} onChange={(e) => f.set({ payment_note: e.currentTarget.value })} />
        </Row2>
        <Checkbox
          label={v.direction === "income" ? "Uhradené (inak pohľadávka – dlží mi)" : "Uhradené (inak záväzok – dlžím ja)"}
          checked={!!v.paid_on}
          onChange={(e) => f.set({ paid_on: e.currentTarget.checked ? v.realized_on ?? todayIso() : null })}
        />
        {v.paid_on && <DateField label="Dátum úhrady" value={v.paid_on} onChange={(paid_on) => f.set({ paid_on })} />}
        <EntityPicker entity="person" label={v.direction === "income" ? "Platiteľ" : "Dodávateľ / komu"} value={v.counterparty_id} onChange={(counterparty_id) => f.set({ counterparty_id })} />
        {v.direction === "income" && (
          <Select
            label="Faktúra"
            clearable
            searchable
            data={(invoices.data ?? []).map((i) => ({ value: String(i.id), label: `${i.number} · ${i.customer_name ?? ""} · ${fmtMoney(i.amount)}` }))}
            value={v.invoice_id ? String(v.invoice_id) : null}
            onChange={(x) => f.set({ invoice_id: x ? Number(x) : null })}
            comboboxProps={{ withinPortal: true }}
          />
        )}
        <Textarea label="Popis" autosize minRows={2} value={v.description ?? ""} onChange={(e) => f.set({ description: e.currentTarget.value })} />
        <Divider />
        {id ? (
          <FileSection entityType="ledger_entry" entityId={id} role="receipt" title="Účtovný doklad (PDF)" />
        ) : (
          <>
            <ReceiptPages pages={pages} onChange={setPages} />
            {pages.length > 0 && (
              <Group>
                <Button size="compact-sm" variant="light" leftSection={<IconSparkles size={14} />} loading={reading} onClick={fillFromReceipt}>
                  Vyplniť z dokladu
                </Button>
              </Group>
            )}
          </>
        )}
        <TextInput label="Poznámka k dokladu" placeholder="napr. doklad chýba, príde mailom" value={v.document_note ?? ""} onChange={(e) => f.set({ document_note: e.currentTarget.value })} />
        <FileSection entityType="ledger_entry" entityId={id} role="attachment" title="Ďalšie prílohy" pending={attachments} onPending={setAttachments} />
        <CustomFields entity="ledger_entry" value={v.custom_fields} onChange={(custom_fields) => f.set({ custom_fields })} />
      </FormShell>
    </>
  );
}

export function InvoiceForm({ id, defaults, onDone }: FormProps) {
  const type = useCodelist("invoice_type");
  const { openForm } = useForms();
  const [pending, setPending] = useState<File[]>([]);
  const f = useEntityForm("invoice", id, () => ({
    type_id: type.defaultId,
    created_on: todayIso(),
    realized_on: todayIso(),
    due_on: dayjs().add(14, "day").format("YYYY-MM-DD"),
    custom_fields: {},
    ...defaults,
  }));
  useLateDefaults(f, !id, { type_id: type.defaultId });
  if (!f.v) return <FormShell loading entity="invoice" onSave={() => {}} onCancel={() => onDone(null)}>{null}</FormShell>;
  const v = f.v;

  const registerPayment = async () => {
    const entry = await openForm("ledger_entry", {
      defaults: {
        direction: "income",
        invoice_id: id,
        amount: v.amount,
        title: `Úhrada faktúry ${v.number}`,
        splits: [{ job_id: v.job_id, amount: v.amount }],
      },
    });
    if (entry) {
      f.set({ paid_on: entry.paid_on ?? entry.realized_on });
      await f.save({ paid_on: entry.paid_on ?? entry.realized_on });
    }
  };

  return (
    <FormShell
      entity="invoice"
      id={id}
      createdAt={v.created_at}
      saving={f.saving}
      onCancel={() => onDone(null)}
      onDeleted={() => onDone(null)}
      onSave={async () => {
        const row = await f.save();
        if (!row) return;
        for (const p of pending) await uploadFile("invoice", row.id, p, p.name, "document").catch(notifyError);
        onDone(row);
      }}
      extraActions={
        id && !v.paid_on ? (
          <Button variant="light" color="green" onClick={registerPayment}>
            Zaevidovať úhradu
          </Button>
        ) : null
      }
    >
      {id ? (
        <Text fw={700} size="lg">
          Faktúra č. {v.number}
        </Text>
      ) : (
        <Text size="sm" c="dimmed">
          Číslo (poradové/rok) sa pridelí pri uložení.
        </Text>
      )}
      <Row2>
        <CodelistSelect type="invoice_type" label="Typ" required value={v.type_id} onChange={(type_id) => f.set({ type_id })} />
        <MoneyInput label="Suma" value={v.amount} onChange={(amount) => f.set({ amount })} />
      </Row2>
      <EntityPicker entity="job" label="Zákazka" value={v.job_id} onChange={(job_id) => f.set({ job_id })} />
      <Row2>
        <DateField label="Dátum vytvorenia" required value={v.created_on} onChange={(created_on) => f.set({ created_on })} />
        <DateField label="Dátum realizácie (dodania)" value={v.realized_on} onChange={(realized_on) => f.set({ realized_on })} />
        <DateField label="Splatnosť" value={v.due_on} onChange={(due_on) => f.set({ due_on })} />
        <DateField label="Uhradená dňa" value={v.paid_on} onChange={(paid_on) => f.set({ paid_on })} />
      </Row2>
      <Textarea label="Poznámka" autosize minRows={2} value={v.note ?? ""} onChange={(e) => f.set({ note: e.currentTarget.value })} />
      <FileSection entityType="invoice" entityId={id} role="document" title="Dokument faktúry (Word/PDF, každá verzia zostáva)" pending={pending} onPending={setPending} />
      <CustomFields entity="invoice" value={v.custom_fields} onChange={(custom_fields) => f.set({ custom_fields })} />
    </FormShell>
  );
}

export function QuoteForm({ id, defaults, onDone }: FormProps) {
  const [pending, setPending] = useState<File[]>([]);
  const f = useEntityForm("quote", id, () => ({
    created_on: todayIso(),
    valid_until: dayjs().add(30, "day").format("YYYY-MM-DD"),
    custom_fields: {},
    ...defaults,
  }));
  if (!f.v) return <FormShell loading entity="quote" onSave={() => {}} onCancel={() => onDone(null)}>{null}</FormShell>;
  const v = f.v;
  return (
    <FormShell
      entity="quote"
      id={id}
      createdAt={v.created_at}
      saving={f.saving}
      onCancel={() => onDone(null)}
      onDeleted={() => onDone(null)}
      onSave={async () => {
        const row = await f.save();
        if (!row) return;
        for (const p of pending) await uploadFile("quote", row.id, p, p.name, "document").catch(notifyError);
        onDone(row);
      }}
    >
      <EntityPicker entity="job" label="Zákazka" required value={v.job_id} onChange={(job_id) => f.set({ job_id })} />
      <Row2>
        <DateField label="Dátum vytvorenia" required value={v.created_on} onChange={(created_on) => f.set({ created_on })} />
        <DateField label="Platnosť do" value={v.valid_until} onChange={(valid_until) => f.set({ valid_until })} />
      </Row2>
      <MoneyInput label="Suma" value={v.amount} onChange={(amount) => f.set({ amount })} />
      <Textarea label="Komentár" autosize minRows={2} value={v.note ?? ""} onChange={(e) => f.set({ note: e.currentTarget.value })} />
      <FileSection entityType="quote" entityId={id} role="document" title="Dokument ponuky (nahraj upravenú verziu ako nový súbor)" pending={pending} onPending={setPending} />
      <CustomFields entity="quote" value={v.custom_fields} onChange={(custom_fields) => f.set({ custom_fields })} />
    </FormShell>
  );
}
