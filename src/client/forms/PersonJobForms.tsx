import { useEffect, useRef, useState } from "react";
import { ActionIcon, Anchor, Button, Checkbox, Divider, Group, Stack, Switch, Text, TextInput, Tooltip } from "@mantine/core";
import { useDebouncedValue } from "@mantine/hooks";
import { IconSparkles } from "@tabler/icons-react";
import { Link } from "react-router";
import { api, notifyError, useCodelist, useList, useRecord, type Address, type Row } from "../api";
import { AddressInput, CodelistSelect, CustomFields, EmailInput, EntityPicker, PhoneInput, Row2, emailError, phoneError } from "../components/inputs";
import { StatusBadge } from "../components/DataTable";
import { FileSection } from "../components/Files";
import { fmtDate } from "../format";
import { useForms, type FormProps } from "./FormsProvider";
import { FormShell, JournalField, useEntityForm, useLateDefaults } from "./shared";

export function PersonForm({ id, defaults, onDone }: FormProps) {
  const leadSource = useCodelist("lead_source");
  const channel = useCodelist("first_contact_channel");
  const { openForm } = useForms();
  const [withJob, setWithJob] = useState(false);
  const f = useEntityForm("person", id, () => ({
    lead_source_id: leadSource.defaultId,
    first_contact_channel_id: channel.defaultId,
    custom_fields: {},
    ...defaults,
  }));
  useLateDefaults(f, !id, { lead_source_id: leadSource.defaultId, first_contact_channel_id: channel.defaultId });
  const jobs = useList("job", id ? { customer_id: id } : undefined);
  if (!f.v) return <FormShell loading entity="person" onSave={() => {}} onCancel={() => onDone(null)}>{null}</FormShell>;
  const v = f.v;

  const submit = async () => {
    const invalid = phoneError(v.phone) ?? emailError(v.email);
    if (invalid) return notifyError(new Error(invalid));
    const row = await f.save();
    if (!row) return;
    // Optionally continue straight to a job for this new customer
    if (withJob) await openForm("job", { defaults: { customer_id: row.id, location_address: row.billing_address, billing_address: row.billing_address } });
    onDone(row);
  };

  return (
    <FormShell entity="person" id={id} createdAt={v.created_at} saving={f.saving} onSave={submit} onCancel={() => onDone(null)} onDeleted={() => onDone(null)}>
      <TextInput label="Meno" required value={v.name ?? ""} onChange={(e) => f.set({ name: e.currentTarget.value })} data-autofocus />
      <Row2>
        <PhoneInput value={v.phone} onChange={(phone) => f.set({ phone })} />
        <EmailInput value={v.email} onChange={(email) => f.set({ email })} />
      </Row2>
      <AddressInput label="Fakturačná adresa" value={v.billing_address} onChange={(billing_address) => f.set({ billing_address })} />
      <Row2>
        <CodelistSelect type="lead_source" label="Odkiaľ sa o mne dozvedel" value={v.lead_source_id} onChange={(lead_source_id) => f.set({ lead_source_id })} />
        <CodelistSelect type="first_contact_channel" label="Kanál prvého kontaktu" value={v.first_contact_channel_id} onChange={(first_contact_channel_id) => f.set({ first_contact_channel_id })} />
      </Row2>
      <CustomFields entity="person" value={v.custom_fields} onChange={(custom_fields) => f.set({ custom_fields })} />
      <JournalField entity="person" id={id} value={v.initial_comment} onChange={(initial_comment) => f.set({ initial_comment })} />
      {!id && <Checkbox label="Po uložení rovno založiť zákazku" checked={withJob} onChange={(e) => setWithJob(e.currentTarget.checked)} />}
      {id && (
        <>
          <Divider label="Zákazky" labelPosition="left" />
          <Stack gap={4}>
            {jobs.data?.map((j) => (
              <Group key={j.id} gap="xs" wrap="nowrap">
                <StatusBadge label={j.status} color={j.status_color} />
                <Anchor component={Link} to={`/zakazky/${j.id}`} size="sm" onClick={() => onDone(null)}>
                  {j.title}
                </Anchor>
                <Text size="xs" c="dimmed">
                  {fmtDate(j.created_at)}
                </Text>
              </Group>
            ))}
            <Group>
              <Button size="xs" variant="light" onClick={() => openForm("job", { defaults: { customer_id: id, location_address: v.billing_address, billing_address: v.billing_address } })}>
                + Nová zákazka
              </Button>
            </Group>
          </Stack>
        </>
      )}
    </FormShell>
  );
}

// Until the AI answers (or when it can't), the title is the first sentence of the note
const titleFromNote = (s: string) => {
  const first = s.trim().split(/[.\n!?]/)[0].trim();
  return first.length > 70 ? first.slice(0, 67).trimEnd() + "…" : first;
};

const streetOf = (a?: Address | null) => a?.street ?? a?.label?.split(",")[0].replace(/\s+\d+\S*(\/\d+\S*)?$/, "").trim() ?? null;

const suggestTitle = (note: string, street: string | null) =>
  api<{ title: string | null }>("/ai/job-title", { method: "POST", json: { note, street } })
    .then((r) => r.title)
    .catch(() => null);

export function JobForm({ id, defaults, onDone }: FormProps) {
  const status = useCodelist("job_status");
  const type = useCodelist("job_type");
  const [titleTouched, setTitleTouched] = useState(!!id || !!defaults?.title);
  const f = useEntityForm("job", id, () => ({
    status_id: status.defaultId,
    type_id: type.defaultId,
    is_active: 1,
    custom_fields: {},
    ...defaults,
  }));
  useLateDefaults(f, !id, { status_id: status.defaultId, type_id: type.defaultId });
  const customer = useRecord("person", f.v?.customer_id ?? undefined);
  // Both addresses default to the customer's billing address
  useLateDefaults(f, !id, { location_address: customer.data?.billing_address ?? null, billing_address: customer.data?.billing_address ?? null });

  // New job: once typing pauses, AI turns the note into a short title, unless the user wrote their own
  const note: string = f.v?.initial_comment ?? "";
  const street = streetOf(f.v?.location_address);
  const [debouncedNote] = useDebouncedValue(note, 1200);
  const [aiTitle, setAiTitle] = useState<string | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const latest = useRef({ touched: titleTouched, set: f.set, request: 0 });
  latest.current.touched = titleTouched;
  latest.current.set = f.set;
  const askAi = async (text: string, force = false) => {
    const request = ++latest.current.request;
    setAiBusy(true);
    const title = await suggestTitle(text, street);
    if (request !== latest.current.request) return;
    setAiBusy(false);
    if (!title || (latest.current.touched && !force)) return;
    setAiTitle(title);
    if (force) setTitleTouched(false);
    latest.current.set({ title });
  };
  useEffect(() => {
    if (!id && !latest.current.touched && debouncedNote.trim().length >= 20) void askAi(debouncedNote);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedNote, street, id]);

  if (!f.v) return <FormShell loading entity="job" onSave={() => {}} onCancel={() => onDone(null)}>{null}</FormShell>;
  const v = f.v;

  const pickCustomer = (row?: Row | null) => {
    const addr = row?.billing_address ?? null;
    if (addr) f.set({ location_address: addr, billing_address: addr });
  };

  return (
    <FormShell
      entity="job"
      id={id}
      createdAt={v.created_at}
      saving={f.saving}
      onCancel={() => onDone(null)}
      onDeleted={() => onDone(null)}
      onSave={async () => {
        const data = { ...v, title: v.title || titleFromNote(v.initial_comment ?? "") };
        const row = await f.save(data);
        if (row) onDone(row);
      }}
      extraActions={
        id ? (
          <Button component={Link} to={`/zakazky/${id}`} variant="subtle" onClick={() => onDone(null)}>
            Detail
          </Button>
        ) : null
      }
    >
      <EntityPicker
        entity="person"
        label="Zákazník"
        value={v.customer_id}
        onChange={(customer_id) => f.set({ customer_id })}
      />
      {customer.data?.billing_address && v.location_address?.label !== customer.data.billing_address.label && (
        <Button size="compact-xs" variant="subtle" onClick={() => pickCustomer(customer.data)}>
          Použiť adresu zákazníka
        </Button>
      )}
      {!id && (
        <JournalField
          entity="job"
          value={v.initial_comment}
          onChange={(initial_comment) => f.set({ initial_comment, ...(titleTouched || aiTitle ? {} : { title: titleFromNote(initial_comment) }) })}
        />
      )}
      <TextInput
        label="Nadpis"
        required
        description={!id && !titleTouched ? (aiBusy ? "AI navrhuje nadpis z poznámky…" : "Doplní sa z poznámky") : undefined}
        rightSection={
          !id && note.trim().length >= 10 ? (
            <Tooltip label="Navrhnúť nadpis z poznámky (AI)">
              <ActionIcon variant="subtle" loading={aiBusy} onClick={() => askAi(note, true)} aria-label="Navrhnúť nadpis">
                <IconSparkles size={16} />
              </ActionIcon>
            </Tooltip>
          ) : undefined
        }
        value={v.title ?? ""}
        onChange={(e) => {
          setTitleTouched(true);
          f.set({ title: e.currentTarget.value });
        }}
      />
      <Row2>
        <CodelistSelect type="job_status" label="Stav" value={v.status_id} onChange={(status_id) => f.set({ status_id })} />
        <CodelistSelect type="job_type" label="Typ" value={v.type_id} onChange={(type_id) => f.set({ type_id })} />
      </Row2>
      <Switch label="Aktívna" checked={!!v.is_active} onChange={(e) => f.set({ is_active: e.currentTarget.checked ? 1 : 0 })} />
      <AddressInput label="Lokalita" value={v.location_address} onChange={(location_address) => f.set({ location_address })} />
      <AddressInput label="Fakturačná adresa" value={v.billing_address} onChange={(billing_address) => f.set({ billing_address })} />
      <CustomFields entity="job" value={v.custom_fields} onChange={(custom_fields) => f.set({ custom_fields })} />
      {id && (
        <>
          <JournalField entity="job" id={id} onChange={() => {}} />
          <Divider label="Dokumenty zákazky" labelPosition="left" />
          <FileSection entityType="job" entityId={id} />
        </>
      )}
    </FormShell>
  );
}
