import { useMemo, useState } from "react";
import { ActionIcon, Badge, Checkbox, Divider, Group, NumberInput, Paper, Select, Stack, Switch, Text, TextInput, Textarea } from "@mantine/core";
import { DateTimePicker } from "@mantine/dates";
import { IconX } from "@tabler/icons-react";
import { notifyError, saveRecord, uploadFile, useCodelist, useList, useRecord, useSettings, type Row } from "../api";
import { AddressInput, CodelistSelect, CustomFields, DateField, EntityPicker, MoneyInput, PhoneInput, Row2, phoneError } from "../components/inputs";
import { FileSection } from "../components/Files";
import { fmtDate, fmtMoney, fmtNum, todayIso } from "../format";
import { useForms, type FormProps } from "./FormsProvider";
import { FormShell, useEntityForm, useLateDefaults } from "./shared";

// "8-12, 16-18:30" -> 6.5 (same rule as the server)
export function hoursFromIntervals(s: string): number | null {
  let total = 0;
  let found = false;
  for (const part of s.split(/[,;]/)) {
    const m = part.trim().match(/^(\d{1,2})(?:[:.](\d{2}))?\s*-\s*(\d{1,2})(?:[:.](\d{2}))?$/);
    if (!m) continue;
    const a = +m[1] + +(m[2] ?? 0) / 60;
    const b = +m[3] + +(m[4] ?? 0) / 60;
    if (b > a) {
      total += b - a;
      found = true;
    }
  }
  return found ? Math.round(total * 100) / 100 : null;
}

// Last odometer reading of a car, to prefill the next trip
function useLastOdometer(carId: number | null | undefined) {
  const trips = useList("trip");
  return useMemo(() => {
    const t = (trips.data ?? []).filter((x) => x.car_id === carId && x.km_after != null).sort((a, b) => (b.date_to + b.id > a.date_to + a.id ? 1 : -1))[0];
    return t ? Number(t.km_after) : null;
  }, [trips.data, carId]);
}

export function AttendanceForm({ id, defaults, onDone }: FormProps) {
  const settings = useSettings();
  const activity = useCodelist("activity_type");
  const car = useCodelist("car");
  const me = settings.data?.self_person_id ? Number(settings.data.self_person_id) : null;
  const [hoursTouched, setHoursTouched] = useState(!!id);
  const [withTrip, setWithTrip] = useState(false);
  const [trip, setTrip] = useState<Row>({});
  const f = useEntityForm("attendance", id, () => ({
    realized_on: todayIso(),
    person_id: me,
    activity_type_id: activity.defaultId,
    custom_fields: {},
    ...defaults,
  }));
  useLateDefaults(f, !id, { person_id: me, activity_type_id: activity.defaultId });
  const tripCar = trip.car_id ?? car.defaultId;
  const lastOdo = useLastOdometer(tripCar);
  const trips = useList("trip", id ? { attendance_id: id } : undefined);
  if (!f.v) return <FormShell loading entity="attendance" onSave={() => {}} onCancel={() => onDone(null)}>{null}</FormShell>;
  const v = f.v;
  const kmBefore = trip.km_before ?? lastOdo;

  return (
    <FormShell
      entity="attendance"
      id={id}
      createdAt={v.created_at}
      saving={f.saving}
      onCancel={() => onDone(null)}
      onDeleted={() => onDone(null)}
      onSave={async () => {
        const row = await f.save();
        if (!row) return;
        if (withTrip) {
          await saveRecord("trip", {
            date_from: row.realized_on,
            date_to: row.realized_on,
            car_id: tripCar,
            km_before: kmBefore,
            km_after: trip.km_after,
            km: trip.km,
            attendance_id: row.id,
            job_id: row.job_id,
          }).catch(notifyError);
        }
        onDone(row);
      }}
    >
      <Row2>
        <DateField label="Dátum" required value={v.realized_on} onChange={(realized_on) => f.set({ realized_on })} />
        <EntityPicker entity="person" label="Kto" value={v.person_id} onChange={(person_id) => f.set({ person_id })} />
      </Row2>
      <EntityPicker entity="job" label="Zákazka" value={v.job_id} onChange={(job_id) => f.set({ job_id })} />
      <Row2>
        <TextInput
          label="Časy"
          placeholder="napr. 8-12, 13-16:30"
          value={v.intervals ?? ""}
          onChange={(e) => {
            const intervals = e.currentTarget.value;
            const h = hoursFromIntervals(intervals);
            f.set({ intervals, ...(!hoursTouched && h != null ? { hours: h } : {}) });
          }}
        />
        <NumberInput
          label="Počet hodín"
          decimalSeparator=","
          step={0.5}
          min={0}
          inputMode="decimal"
          value={v.hours ?? ""}
          onChange={(x) => {
            setHoursTouched(true);
            f.set({ hours: x === "" ? null : Number(x) });
          }}
        />
      </Row2>
      <CodelistSelect type="activity_type" label="Typ aktivity" value={v.activity_type_id} onChange={(activity_type_id) => f.set({ activity_type_id })} />
      <Textarea label="Popis" autosize minRows={2} value={v.description ?? ""} onChange={(e) => f.set({ description: e.currentTarget.value })} />
      <CustomFields entity="attendance" value={v.custom_fields} onChange={(custom_fields) => f.set({ custom_fields })} />
      {!id && <Switch label="Pridať aj jazdu" checked={withTrip} onChange={(e) => setWithTrip(e.currentTarget.checked)} />}
      {withTrip && (
        <Paper withBorder p="sm">
          <Stack gap="xs">
            <CodelistSelect type="car" label="Auto" value={tripCar} onChange={(car_id) => setTrip({ ...trip, car_id, km_before: undefined })} />
            <Row2>
              <NumberInput label="Km pred" value={kmBefore ?? ""} onChange={(x) => setTrip({ ...trip, km_before: x === "" ? null : Number(x) })} inputMode="numeric" />
              <NumberInput label="Km po" value={trip.km_after ?? ""} onChange={(x) => setTrip({ ...trip, km_after: x === "" ? null : Number(x) })} inputMode="numeric" />
            </Row2>
            {kmBefore != null && trip.km_after != null ? (
              <Text size="sm">Dĺžka: {fmtNum(trip.km_after - kmBefore)} km</Text>
            ) : (
              <NumberInput label="alebo rovno dĺžka v km" value={trip.km ?? ""} onChange={(x) => setTrip({ ...trip, km: x === "" ? null : Number(x) })} inputMode="decimal" />
            )}
          </Stack>
        </Paper>
      )}
      {id && trips.data && trips.data.length > 0 && (
        <Text size="sm" c="dimmed">
          Jazdy: {trips.data.map((t) => `${fmtNum(t.km)} km (${t.car ?? ""})`).join(", ")}
        </Text>
      )}
    </FormShell>
  );
}

export function TripForm({ id, defaults, onDone }: FormProps) {
  const car = useCodelist("car");
  const f = useEntityForm("trip", id, () => ({ date_from: todayIso(), date_to: todayIso(), car_id: car.defaultId, custom_fields: {}, ...defaults }));
  useLateDefaults(f, !id, { car_id: car.defaultId });
  const lastOdo = useLastOdometer(f.v?.car_id);
  useLateDefaults(f, !id, { km_before: lastOdo });
  const attendances = useList("attendance");
  const sameDay = useMemo(
    () => (attendances.data ?? []).filter((a) => f.v && a.realized_on >= f.v.date_from && a.realized_on <= (f.v.date_to || f.v.date_from)),
    [attendances.data, f.v?.date_from, f.v?.date_to] // eslint-disable-line react-hooks/exhaustive-deps
  );
  if (!f.v) return <FormShell loading entity="trip" onSave={() => {}} onCancel={() => onDone(null)}>{null}</FormShell>;
  const v = f.v;
  const computed = v.km_before != null && v.km_after != null ? Number(v.km_after) - Number(v.km_before) : null;
  return (
    <FormShell
      entity="trip"
      id={id}
      createdAt={v.created_at}
      saving={f.saving}
      onCancel={() => onDone(null)}
      onDeleted={() => onDone(null)}
      onSave={async () => {
        const row = await f.save();
        if (row) onDone(row);
      }}
    >
      <Row2>
        <DateField label="Od" required value={v.date_from} onChange={(date_from) => f.set({ date_from, ...(v.date_to < (date_from ?? "") || v.date_to === v.date_from ? { date_to: date_from } : {}) })} />
        <DateField label="Do (viac dní za sebou)" value={v.date_to} onChange={(date_to) => f.set({ date_to })} />
      </Row2>
      <CodelistSelect type="car" label="Auto" value={v.car_id} onChange={(car_id) => f.set({ car_id })} />
      <Row2>
        <NumberInput label="Km pred" value={v.km_before ?? ""} onChange={(x) => f.set({ km_before: x === "" ? null : Number(x) })} inputMode="numeric" />
        <NumberInput label="Km po" value={v.km_after ?? ""} onChange={(x) => f.set({ km_after: x === "" ? null : Number(x) })} inputMode="numeric" />
      </Row2>
      {computed != null ? (
        <Text size="sm">
          Dĺžka: <b>{fmtNum(computed)} km</b>
          {v.date_to && v.date_to !== v.date_from && " (v súhrnoch sa rozdelí na jednotlivé dni)"}
        </Text>
      ) : (
        <NumberInput label="Dĺžka v km (ak nemáš stav tachometra)" value={v.km ?? ""} onChange={(x) => f.set({ km: x === "" ? null : Number(x) })} inputMode="decimal" />
      )}
      <Select
        label="Dochádzkový záznam"
        clearable
        data={sameDay.map((a) => ({ value: String(a.id), label: `${fmtDate(a.realized_on)} · ${a.person_name ?? ""} · ${a.job_title ?? "bez zákazky"} · ${fmtNum(a.hours)} h` }))}
        value={v.attendance_id ? String(v.attendance_id) : null}
        onChange={(x) => {
          const a = sameDay.find((r) => String(r.id) === x);
          f.set({ attendance_id: x ? Number(x) : null, ...(a?.job_id ? { job_id: a.job_id } : {}) });
        }}
        nothingFoundMessage="V tieto dni nie je dochádzka"
        comboboxProps={{ withinPortal: true }}
      />
      <EntityPicker entity="job" label="Zákazka" value={v.job_id} onChange={(job_id) => f.set({ job_id })} />
      <TextInput label="Poznámka" value={v.note ?? ""} onChange={(e) => f.set({ note: e.currentTarget.value })} />
      <CustomFields entity="trip" value={v.custom_fields} onChange={(custom_fields) => f.set({ custom_fields })} />
    </FormShell>
  );
}

export function RefuelForm({ id, defaults, onDone }: FormProps) {
  const car = useCodelist("car");
  const { openForm } = useForms();
  const [withEntry, setWithEntry] = useState(!id);
  const f = useEntityForm("refuel", id, () => ({ realized_on: todayIso(), car_id: car.defaultId, custom_fields: {}, ...defaults }));
  useLateDefaults(f, !id, { car_id: car.defaultId });
  if (!f.v) return <FormShell loading entity="refuel" onSave={() => {}} onCancel={() => onDone(null)}>{null}</FormShell>;
  const v = f.v;
  return (
    <FormShell
      entity="refuel"
      id={id}
      createdAt={v.created_at}
      saving={f.saving}
      onCancel={() => onDone(null)}
      onDeleted={() => onDone(null)}
      onSave={async () => {
        const row = await f.save();
        if (!row) return;
        // Fuel bought with money is also an expense; the form opens prefilled so the receipt can be attached
        if (withEntry && !row.ledger_entry_id) {
          const entry = await openForm("ledger_entry", {
            defaults: {
              direction: "expense",
              realized_on: row.realized_on,
              amount: row.amount,
              title: `Tankovanie ${row.liters ? `${fmtNum(row.liters)} l` : ""}`.trim(),
              splits: [{ job_id: null, amount: row.amount }],
            },
          });
          if (entry) await saveRecord("refuel", { ledger_entry_id: entry.id }, row.id).catch(notifyError);
        }
        onDone(row);
      }}
    >
      <Row2>
        <DateField label="Dátum" required value={v.realized_on} onChange={(realized_on) => f.set({ realized_on })} />
        <CodelistSelect type="car" label="Auto" value={v.car_id} onChange={(car_id) => f.set({ car_id })} />
      </Row2>
      <Row2>
        <NumberInput label="Litre" decimalSeparator="," value={v.liters ?? ""} onChange={(x) => f.set({ liters: x === "" ? null : Number(x) })} inputMode="decimal" />
        <NumberInput label="Na koľko km" required description="Pripočíta sa ku kilometrovému fondu" value={v.km_range ?? ""} onChange={(x) => f.set({ km_range: x === "" ? null : Number(x) })} inputMode="numeric" />
      </Row2>
      <MoneyInput label="Suma" value={v.amount} onChange={(amount) => f.set({ amount })} />
      {!v.ledger_entry_id ? (
        <Checkbox label="Po uložení rovno založiť účtovný záznam" checked={withEntry} onChange={(e) => setWithEntry(e.currentTarget.checked)} />
      ) : (
        <Text size="sm" c="dimmed">
          Účtovný záznam: {v.ledger_code}
        </Text>
      )}
      <TextInput label="Poznámka" value={v.note ?? ""} onChange={(e) => f.set({ note: e.currentTarget.value })} />
      <CustomFields entity="refuel" value={v.custom_fields} onChange={(custom_fields) => f.set({ custom_fields })} />
    </FormShell>
  );
}

export function InspectionForm({ id, defaults, onDone }: FormProps) {
  const status = useCodelist("inspection_status");
  const [pending, setPending] = useState<File[]>([]);
  const f = useEntityForm("inspection", id, () => ({ status_id: status.defaultId, custom_fields: {}, ...defaults }));
  useLateDefaults(f, !id, { status_id: status.defaultId });
  const job = useRecord("job", f.v?.job_id ?? undefined);
  // Location and phone default to the job's
  useLateDefaults(f, !id, { location: job.data?.location_address ?? null, phone: job.data?.customer_phone ?? null });
  if (!f.v) return <FormShell loading entity="inspection" onSave={() => {}} onCancel={() => onDone(null)}>{null}</FormShell>;
  const v = f.v;
  return (
    <FormShell
      entity="inspection"
      id={id}
      createdAt={v.created_at}
      saving={f.saving}
      onCancel={() => onDone(null)}
      onDeleted={() => onDone(null)}
      onSave={async () => {
        const invalid = phoneError(v.phone);
        if (invalid) return notifyError(new Error(invalid));
        const row = await f.save();
        if (!row) return;
        for (const p of pending) await uploadFile("inspection", row.id, p, p.name).catch(notifyError);
        onDone(row);
      }}
    >
      <EntityPicker entity="job" label="Zákazka" required value={v.job_id} onChange={(job_id) => f.set({ job_id })} />
      <Row2>
        <DateTimePicker
          label="Termín"
          valueFormat="D.M.YYYY HH:mm"
          value={v.scheduled_at || null}
          onChange={(x) => f.set({ scheduled_at: x ? String(x).slice(0, 16) : null })}
          clearable
          firstDayOfWeek={1}
          popoverProps={{ withinPortal: true }}
        />
        <CodelistSelect type="inspection_status" label="Stav" value={v.status_id} onChange={(status_id) => f.set({ status_id })} />
      </Row2>
      <AddressInput label="Lokalita" value={v.location} onChange={(location) => f.set({ location })} />
      <PhoneInput value={v.phone} onChange={(phone) => f.set({ phone })} />
      <Textarea label="Poznámka" autosize minRows={2} value={v.note ?? ""} onChange={(e) => f.set({ note: e.currentTarget.value })} />
      <FileSection entityType="inspection" entityId={id} title="Dokumenty z obhliadky (náčrty, projekt…)" pending={pending} onPending={setPending} />
      <CustomFields entity="inspection" value={v.custom_fields} onChange={(custom_fields) => f.set({ custom_fields })} />
    </FormShell>
  );
}

const linkTypes = [
  { value: "job", label: "Zákazka" },
  { value: "person", label: "Osoba" },
  { value: "ledger_entry", label: "Účtovný záznam" },
  { value: "invoice", label: "Faktúra" },
  { value: "quote", label: "Cenová ponuka" },
  { value: "inspection", label: "Obhliadka" },
  { value: "attendance", label: "Dochádzka" },
  { value: "trip", label: "Jazda" },
  { value: "refuel", label: "Tankovanie" },
];

const recordLabels: Record<string, (r: Row) => string> = {
  ledger_entry: (r) => `${r.code} ${r.title} · ${fmtMoney(r.amount)}`,
  invoice: (r) => `Faktúra ${r.number}${r.customer_name ? ` · ${r.customer_name}` : ""}`,
  quote: (r) => `Ponuka ${fmtDate(r.created_on)} · ${r.job_title ?? ""}`,
  inspection: (r) => `Obhliadka ${fmtDate(r.scheduled_at)} · ${r.job_title ?? ""}`,
  attendance: (r) => `Dochádzka ${fmtDate(r.realized_on)} · ${r.person_name ?? ""} · ${r.job_title ?? "bez zákazky"}`,
  trip: (r) => `Jazda ${fmtDate(r.date_from)} · ${r.car ?? ""}${r.km != null ? ` · ${fmtNum(r.km)} km` : ""}`,
  refuel: (r) => `Tankovanie ${fmtDate(r.realized_on)} · ${r.car ?? ""}${r.liters ? ` · ${fmtNum(r.liters)} l` : ""}`,
};

// Records without full-text search are picked from their list, newest first
function RecordSelect({ entity, onPick }: { entity: string; onPick: (id: number, label: string) => void }) {
  const list = useList(entity);
  const label = recordLabels[entity];
  return (
    <Select
      label="Pridať väzbu"
      placeholder="Hľadaj v zozname…"
      searchable
      limit={50}
      data={(list.data ?? []).map((r) => ({ value: String(r.id), label: label(r) }))}
      value={null}
      onChange={(x) => {
        const r = list.data?.find((row) => String(row.id) === x);
        if (r) onPick(r.id, label(r));
      }}
      nothingFoundMessage={list.isLoading ? "Načítavam…" : "Nič sa nenašlo"}
      comboboxProps={{ withinPortal: true }}
    />
  );
}

export function TodoForm({ id, defaults, onDone }: FormProps) {
  const f = useEntityForm("todo", id, () => ({ links: [], custom_fields: {}, ...defaults }));
  const [linkType, setLinkType] = useState("job");
  if (!f.v) return <FormShell loading entity="todo" onSave={() => {}} onCancel={() => onDone(null)}>{null}</FormShell>;
  const v = f.v;
  const links: Row[] = v.links ?? [];
  const addLink = (entity_id: number, label?: string) => {
    if (!links.some((l) => l.entity_type === linkType && l.entity_id === entity_id)) f.set({ links: [...links, { entity_type: linkType, entity_id, label }] });
  };
  return (
    <FormShell
      entity="todo"
      id={id}
      createdAt={v.created_at}
      saving={f.saving}
      onCancel={() => onDone(null)}
      onDeleted={() => onDone(null)}
      onSave={async () => {
        // "done" is changed only with the checkbox in lists, so closed_at stays correct
        const { done: _done, ...data } = v;
        const row = await f.save(data);
        if (row) onDone(row);
      }}
    >
      <Textarea label="Úloha" required autosize minRows={2} value={v.text ?? ""} onChange={(e) => f.set({ text: e.currentTarget.value })} data-autofocus />
      <DateField label="Termín" value={v.due_on} onChange={(due_on) => f.set({ due_on })} />
      <Divider label="Väzby" labelPosition="left" />
      <Group gap={4}>
        {links.map((l, i) => (
          <Badge
            key={`${l.entity_type}${l.entity_id}`}
            variant="light"
            rightSection={
              <ActionIcon size="xs" variant="transparent" onClick={() => f.set({ links: links.filter((_, j) => j !== i) })}>
                <IconX size={10} />
              </ActionIcon>
            }
          >
            {l.label ?? `${l.entity_type} #${l.entity_id}`}
          </Badge>
        ))}
      </Group>
      <Group align="flex-end" gap="xs" wrap="nowrap">
        <Select w={160} data={linkTypes} value={linkType} onChange={(x) => setLinkType(x ?? "job")} allowDeselect={false} comboboxProps={{ withinPortal: true }} />
        <div style={{ flex: 1 }}>
          {linkType === "job" || linkType === "person" ? (
            <EntityPicker
              key={linkType + links.length}
              entity={linkType}
              label="Pridať väzbu"
              value={null}
              onChange={(eid, row) => {
                if (!eid) return;
                const label = row ? (linkType === "job" ? row.title : row.name) : undefined;
                addLink(eid, label);
              }}
            />
          ) : (
            <RecordSelect key={linkType + links.length} entity={linkType} onPick={addLink} />
          )}
        </div>
      </Group>
      {v.closed_at && (
        <Text size="xs" c="dimmed">
          Uzavreté {fmtDate(v.closed_at)}
        </Text>
      )}
    </FormShell>
  );
}
