import { Anchor, Badge, Group, Text } from "@mantine/core";
import { IconFileText, IconPaperclip } from "@tabler/icons-react";
import type { Row } from "./api";
import { fileUrl } from "./api";
import { CommentsCell } from "./components/CommentJournal";
import { StatusBadge, type Column } from "./components/DataTable";
import { AddressLink } from "./components/inputs";
import { fmtDate, fmtDateTime, fmtMoney, fmtNum, todayIso } from "./format";

const addr = (k: string) => (r: Row) => r[k]?.label ?? "";

export const personColumns: Column[] = [
  { key: "name", label: "Meno", mobile: "title" },
  { key: "phone", label: "Telefón", mobile: "sub", render: (r) => r.phone && <Anchor href={`tel:${r.phone}`} size="sm" onClick={(e) => e.stopPropagation()}>{r.phone}</Anchor> },
  { key: "email", label: "Email" },
  { key: "billing_address", label: "Fakturačná adresa", get: addr("billing_address"), render: (r) => <AddressLink value={r.billing_address} />, mobile: "sub" },
  { key: "lead_source", label: "Odkiaľ", type: "enum" },
  { key: "first_contact_channel", label: "Prvý kontakt", type: "enum", hidden: true },
  { key: "job_count", label: "Zákazky", type: "number", width: 80 },
  { key: "comments", label: "Poznámky", get: (r) => (r.comments ?? []).map((c: Row) => c.text).join(" "), render: (r) => <CommentsCell comments={r.comments} />, mobile: "sub" },
  { key: "created_at", label: "Založené", type: "date", get: (r) => r.created_at?.slice(0, 10) },
];

export const jobColumns: Column[] = [
  { key: "title", label: "Nadpis", mobile: "title" },
  { key: "status", label: "Stav", type: "enum", width: 120, render: (r) => <StatusBadge label={r.status} color={r.status_color} />, mobile: "meta" },
  { key: "customer_name", label: "Zákazník", type: "text", mobile: "sub" },
  { key: "type", label: "Typ", type: "enum" },
  { key: "location_address", label: "Lokalita", get: addr("location_address"), render: (r) => <AddressLink value={r.location_address} />, mobile: "sub" },
  { key: "is_active", label: "Aktívna", type: "bool", width: 70 },
  { key: "status_active", label: "Aktívny stav", type: "bool", hidden: true },
  { key: "comments", label: "Poznámky", get: (r) => (r.comments ?? []).map((c: Row) => c.text).join(" "), render: (r) => <CommentsCell comments={r.comments} />, mobile: "sub" },
  { key: "hours_total", label: "Hodiny", type: "number", sum: true, hidden: true },
  { key: "income_total", label: "Príjmy", type: "money", sum: true, hidden: true },
  { key: "expense_total", label: "Výdaje", type: "money", sum: true, hidden: true },
  { key: "created_at", label: "Založené", type: "date", get: (r) => r.created_at?.slice(0, 10) },
  { key: "last_activity_at", label: "Posledný pohyb", type: "date", get: (r) => r.last_activity_at?.slice(0, 10), hidden: true },
];

export const jobDefaultState = {
  sort: [
    { key: "status_active", dir: "desc" as const },
    { key: "created_at", dir: "desc" as const },
  ],
};

// Active statuses stand out, inactive ones fade
export const jobRowStyle = (r: Row) => (r.status_active && r.is_active ? undefined : { opacity: 0.55 });

export const ledgerColumns: Column[] = [
  { key: "code", label: "Číslo", width: 90, mobile: "meta", render: (r) => <Text size="sm" ff="monospace" fw={600}>{r.code}</Text> },
  { key: "realized_on", label: "Dátum", type: "date", mobile: "sub" },
  { key: "direction", label: "Smer", type: "enum", get: (r) => (r.direction === "income" ? "Príjem" : "Výdaj"), render: (r) => <Badge size="sm" variant="light" color={r.direction === "income" ? "green" : "red"}>{r.direction === "income" ? "Príjem" : "Výdaj"}</Badge> },
  { key: "title", label: "Nadpis", mobile: "title" },
  {
    key: "amount",
    label: "Suma",
    type: "money",
    sum: true,
    get: (r) => (r.direction === "income" ? r.amount : -r.amount),
    render: (r) => <Text size="sm" fw={600} c={r.direction === "income" ? "green" : undefined}>{fmtMoney(r.direction === "income" ? r.amount : -r.amount)}</Text>,
    mobile: "meta",
  },
  { key: "job_titles", label: "Zákazky", mobile: "sub" },
  { key: "payment_method", label: "Platba", type: "enum" },
  {
    key: "paid",
    label: "Uhradené",
    type: "enum",
    get: (r) => (r.paid_on ? "uhradené" : r.direction === "income" ? "dlží mi" : "dlžím"),
    render: (r) => (r.paid_on ? fmtDate(r.paid_on) : <Badge size="sm" color="orange">{r.direction === "income" ? "dlží mi" : "dlžím"}</Badge>),
  },
  { key: "counterparty_name", label: "Protistrana", hidden: true },
  { key: "invoice_number", label: "Faktúra", hidden: true },
  {
    key: "receipt",
    label: "Doklad",
    get: (r) => (r.receipt_file_id ? "áno" : r.document_note ? "poznámka" : "chýba"),
    type: "enum",
    render: (r) => (
      <Group gap={4} wrap="nowrap">
        {r.receipt_file_id ? (
          <Anchor href={fileUrl(r.receipt_file_id)} target="_blank" onClick={(e) => e.stopPropagation()}>
            <IconFileText size={16} />
          </Anchor>
        ) : (
          <Text size="xs" c={r.document_note ? "dimmed" : "red"}>
            {r.document_note || "chýba"}
          </Text>
        )}
        {r.file_count > (r.receipt_file_id ? 1 : 0) && <IconPaperclip size={14} />}
      </Group>
    ),
  },
  { key: "description", label: "Popis", hidden: true },
];

export const inspectionColumns: Column[] = [
  { key: "scheduled_at", label: "Termín", type: "date", render: (r) => fmtDateTime(r.scheduled_at), mobile: "title" },
  { key: "status", label: "Stav", type: "enum", render: (r) => <StatusBadge label={r.status} color={r.status_color} />, mobile: "meta" },
  { key: "job_title", label: "Zákazka", mobile: "sub" },
  { key: "customer_name", label: "Zákazník" },
  { key: "location", label: "Lokalita", get: addr("location"), render: (r) => <AddressLink value={r.location} />, mobile: "sub" },
  { key: "phone", label: "Telefón", render: (r) => r.phone && <Anchor href={`tel:${r.phone}`} size="sm" onClick={(e) => e.stopPropagation()}>{r.phone}</Anchor> },
  { key: "note", label: "Poznámka" },
  { key: "file_count", label: "Súbory", type: "number", width: 70 },
];

export const quoteColumns: Column[] = [
  { key: "created_on", label: "Vytvorená", type: "date", mobile: "sub" },
  { key: "job_title", label: "Zákazka", mobile: "title" },
  { key: "customer_name", label: "Zákazník", mobile: "sub" },
  { key: "amount", label: "Suma", type: "money", sum: true, mobile: "meta" },
  {
    key: "valid_until",
    label: "Platnosť do",
    type: "date",
    render: (r) => <Text size="sm" c={r.valid_until && r.valid_until < todayIso() ? "dimmed" : undefined}>{fmtDate(r.valid_until)}</Text>,
  },
  { key: "note", label: "Komentár" },
  { key: "latest_file_id", label: "Dokument", render: (r) => r.latest_file_id && <Anchor href={fileUrl(r.latest_file_id)} target="_blank" onClick={(e) => e.stopPropagation()}><IconFileText size={16} /></Anchor> },
];

export const invoiceColumns: Column[] = [
  { key: "number", label: "Číslo", width: 80, mobile: "title", get: (r) => r.year * 10000 + r.seq, render: (r) => <Text size="sm" fw={600}>{r.number}</Text> },
  { key: "type", label: "Typ", type: "enum" },
  { key: "created_on", label: "Vytvorená", type: "date" },
  { key: "job_title", label: "Zákazka", mobile: "sub" },
  { key: "customer_name", label: "Zákazník", mobile: "sub" },
  { key: "amount", label: "Suma", type: "money", sum: true, mobile: "meta" },
  { key: "realized_on", label: "Dodanie", type: "date", hidden: true },
  { key: "due_on", label: "Splatnosť", type: "date" },
  {
    key: "paid",
    label: "Úhrada",
    type: "enum",
    get: (r) => (r.paid_on ? "uhradená" : r.due_on && r.due_on < todayIso() ? "po splatnosti" : "neuhradená"),
    render: (r) =>
      r.paid_on ? fmtDate(r.paid_on) : r.due_on && r.due_on < todayIso() ? <Badge size="sm" color="red">po splatnosti</Badge> : <Badge size="sm" color="gray">neuhradená</Badge>,
    mobile: "meta",
  },
  { key: "latest_file_id", label: "Dokument", render: (r) => r.latest_file_id && <Anchor href={fileUrl(r.latest_file_id)} target="_blank" onClick={(e) => e.stopPropagation()}><IconFileText size={16} /></Anchor> },
];

export const attendanceColumns: Column[] = [
  { key: "realized_on", label: "Dátum", type: "date", mobile: "title" },
  { key: "person_name", label: "Kto", type: "enum", mobile: "sub" },
  { key: "job_title", label: "Zákazka", type: "enum", mobile: "sub" },
  { key: "activity_type", label: "Aktivita", type: "enum" },
  { key: "intervals", label: "Časy" },
  { key: "hours", label: "Hodiny", type: "number", sum: true, mobile: "meta", render: (r) => (r.hours != null ? `${fmtNum(r.hours, 2)} h` : "") },
  { key: "description", label: "Popis", mobile: "sub" },
  { key: "trip_km", label: "Km", type: "number", sum: true, hidden: true },
];

export const tripColumns: Column[] = [
  { key: "date_from", label: "Od", type: "date", mobile: "title" },
  { key: "date_to", label: "Do", type: "date", render: (r) => (r.date_to !== r.date_from ? fmtDate(r.date_to) : "") },
  { key: "car", label: "Auto", type: "enum" },
  { key: "job_title", label: "Zákazka", type: "enum", mobile: "sub" },
  { key: "km_before", label: "Km pred", type: "number", hidden: true },
  { key: "km_after", label: "Km po", type: "number", hidden: true },
  { key: "km", label: "Km", type: "number", sum: true, mobile: "meta", render: (r) => (r.km != null ? `${fmtNum(r.km)} km` : "") },
  { key: "days", label: "Dní", type: "number", hidden: true },
  { key: "note", label: "Poznámka", mobile: "sub" },
];

export const refuelColumns: Column[] = [
  { key: "realized_on", label: "Dátum", type: "date", mobile: "title" },
  { key: "car", label: "Auto", type: "enum" },
  { key: "liters", label: "Litre", type: "number", sum: true },
  { key: "km_range", label: "Km do fondu", type: "number", sum: true, mobile: "meta", render: (r) => `+${fmtNum(r.km_range)} km` },
  { key: "amount", label: "Suma", type: "money", sum: true, mobile: "sub" },
  { key: "ledger_code", label: "Účt. záznam" },
  { key: "note", label: "Poznámka" },
];
