import { useEffect, useMemo, useState } from "react";
import { ActionIcon, Anchor, Autocomplete, NumberInput, Select, SimpleGrid, Switch, TextInput, Tooltip } from "@mantine/core";
import { DateInput } from "@mantine/dates";
import { useDebouncedValue } from "@mantine/hooks";
import { IconMapPin } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { api, useCodelist, useFieldDefs, useRecord, type Address, type Row } from "../api";
import { mapLink } from "../format";
import { useForms } from "../forms/FormsProvider";

export function CodelistSelect(props: {
  type: string;
  label: string;
  value: number | null | undefined;
  onChange: (v: number | null) => void;
  required?: boolean;
  clearable?: boolean;
}) {
  const { items } = useCodelist(props.type, true);
  // Inactive values stay visible on records that already use them
  const data = items.filter((i) => i.active || i.id === props.value).map((i) => ({ value: String(i.id), label: i.label }));
  return (
    <Select
      label={props.label}
      data={data}
      value={props.value ? String(props.value) : null}
      onChange={(v) => props.onChange(v ? Number(v) : null)}
      clearable={props.clearable ?? !props.required}
      required={props.required}
      searchable={data.length > 7}
      allowDeselect={false}
      comboboxProps={{ withinPortal: true }}
    />
  );
}

export function DateField(props: { label: string; value: string | null | undefined; onChange: (v: string | null) => void; required?: boolean; clearable?: boolean }) {
  return (
    <DateInput
      label={props.label}
      value={props.value || null}
      onChange={(v) => props.onChange(v ? String(v).slice(0, 10) : null)}
      valueFormat="D.M.YYYY"
      required={props.required}
      clearable={props.clearable ?? !props.required}
      firstDayOfWeek={1}
      popoverProps={{ withinPortal: true }}
    />
  );
}

type SearchHit = { entity_type: string; entity_id: number; label: string; sub: string };

const CREATE = "__create__";
const entityNames: Record<string, string> = { job: "zákazku", person: "osobu" };

// Pick a person or job by full-text search (name, street, phone…), or create a new one
export function EntityPicker(props: {
  entity: "job" | "person";
  label: string;
  value: number | null | undefined;
  onChange: (id: number | null, row?: Row) => void;
  required?: boolean;
  createDefaults?: Row;
  placeholder?: string;
}) {
  const { openForm } = useForms();
  const [search, setSearch] = useState("");
  const [debounced] = useDebouncedValue(search, 200);
  const current = useRecord(props.entity, props.value ?? undefined);
  const currentLabel = current.data ? String(props.entity === "job" ? current.data.title : current.data.name) : "";
  const hits = useQuery({
    queryKey: ["search", props.entity, debounced],
    queryFn: () => api<SearchHit[]>(`/search?types=${props.entity}&q=${encodeURIComponent(debounced)}`),
    enabled: debounced.length >= 2 && debounced !== currentLabel,
  });

  const data = useMemo(() => {
    const opts = (hits.data ?? []).map((h) => ({ value: String(h.entity_id), label: h.sub ? `${h.label} · ${h.sub}` : h.label }));
    if (props.value && !opts.some((o) => o.value === String(props.value)))
      opts.unshift({ value: String(props.value), label: currentLabel || `#${props.value}` });
    opts.push({ value: CREATE, label: `+ Nová ${entityNames[props.entity]}${search && search !== currentLabel ? `: ${search}` : ""}` });
    return opts;
  }, [hits.data, props.value, currentLabel, search, props.entity]);

  useEffect(() => {
    if (currentLabel) setSearch(currentLabel);
  }, [currentLabel]);

  const create = async () => {
    const defaults = { ...props.createDefaults };
    if (search && search !== currentLabel) defaults[props.entity === "job" ? "title" : "name"] = search;
    const row = await openForm(props.entity, { defaults });
    if (row) props.onChange(row.id, row);
  };

  return (
    <Select
      label={props.label}
      placeholder={props.placeholder ?? "Hľadaj meno, ulicu, telefón…"}
      searchable
      required={props.required}
      clearable
      data={data}
      value={props.value ? String(props.value) : null}
      searchValue={search}
      onSearchChange={setSearch}
      filter={({ options }) => options}
      nothingFoundMessage={debounced.length < 2 ? "Píš aspoň 2 znaky" : "Nič sa nenašlo"}
      onChange={(v) => {
        if (v === CREATE) return void create();
        const hit = hits.data?.find((h) => String(h.entity_id) === v);
        props.onChange(v ? Number(v) : null, hit ? { id: hit.entity_id, [props.entity === "job" ? "title" : "name"]: hit.label } : undefined);
      }}
      comboboxProps={{ withinPortal: true }}
    />
  );
}

type Suggestion = Address;

// Address with Mapy.com autocomplete; plain text still works when nothing is picked
export function AddressInput(props: { label: string; value: Address | null | undefined; onChange: (v: Address | null) => void }) {
  const [text, setText] = useState(props.value?.label ?? "");
  const [debounced] = useDebouncedValue(text, 250);
  useEffect(() => setText(props.value?.label ?? ""), [props.value?.label]);
  const status = useQuery({ queryKey: ["geo-status"], queryFn: () => api<{ enabled: boolean }>("/geo/status"), staleTime: Infinity });
  const sugg = useQuery({
    queryKey: ["geo", debounced],
    queryFn: () => api<Suggestion[]>(`/geo/suggest?q=${encodeURIComponent(debounced)}`),
    enabled: !!status.data?.enabled && debounced.length >= 3 && debounced !== props.value?.label,
  });
  const link = mapLink(props.value);
  const options = (sugg.data ?? []).map((s) => s.label);
  return (
    <Autocomplete
      label={props.label}
      value={text}
      data={[...new Set(options)]}
      filter={({ options }) => options}
      onChange={(v) => {
        setText(v);
        const hit = sugg.data?.find((s) => s.label === v);
        if (hit) props.onChange(hit);
      }}
      onBlur={() => {
        if (text !== (props.value?.label ?? "")) props.onChange(text.trim() ? { label: text.trim() } : null);
      }}
      rightSection={
        link ? (
          <Tooltip label={props.value?.lat ? "Otvoriť na mapy.com" : "Hľadať na mapy.com"}>
            <ActionIcon component="a" href={link} target="_blank" variant="subtle" color={props.value?.lat ? "green" : "gray"}>
              <IconMapPin size={18} />
            </ActionIcon>
          </Tooltip>
        ) : null
      }
      comboboxProps={{ withinPortal: true }}
    />
  );
}

export function AddressLink({ value }: { value?: Address | null }) {
  const link = mapLink(value);
  if (!value?.label) return null;
  return link ? (
    <Anchor href={link} target="_blank" size="sm" onClick={(e) => e.stopPropagation()}>
      {value.label}
    </Anchor>
  ) : (
    <>{value.label}</>
  );
}

// Fields the user added in Settings, stored in the record's custom_fields JSON
export function CustomFields(props: { entity: string; value: Record<string, any> | undefined; onChange: (v: Record<string, any>) => void }) {
  const defs = useFieldDefs(props.entity);
  if (!defs.length) return null;
  const v = props.value ?? {};
  const set = (k: string, val: unknown) => props.onChange({ ...v, [k]: val });
  return (
    <>
      {defs.map((d) => {
        switch (d.data_type) {
          case "number":
            return <NumberInput key={d.key} label={d.label} value={v[d.key] ?? ""} onChange={(x) => set(d.key, x === "" ? null : Number(x))} decimalSeparator="," />;
          case "date":
            return <DateField key={d.key} label={d.label} value={v[d.key]} onChange={(x) => set(d.key, x)} />;
          case "boolean":
            return <Switch key={d.key} label={d.label} checked={!!v[d.key]} onChange={(e) => set(d.key, e.currentTarget.checked)} />;
          case "codelist":
            return <CodelistSelect key={d.key} type={d.codelist_type ?? ""} label={d.label} value={v[d.key]} onChange={(x) => set(d.key, x)} />;
          default:
            return <TextInput key={d.key} label={d.label} value={v[d.key] ?? ""} onChange={(e) => set(d.key, e.currentTarget.value)} />;
        }
      })}
    </>
  );
}

export function MoneyInput(props: { label: string; value: number | null | undefined; onChange: (v: number | null) => void; required?: boolean; description?: string }) {
  return (
    <NumberInput
      label={props.label}
      description={props.description}
      value={props.value ?? ""}
      onChange={(v) => props.onChange(v === "" ? null : Number(v))}
      decimalScale={2}
      decimalSeparator=","
      thousandSeparator=" "
      suffix=" €"
      required={props.required}
      inputMode="decimal"
    />
  );
}

export function Row2({ children }: { children: React.ReactNode }) {
  return (
    <SimpleGrid cols={{ base: 1, xs: 2 }} spacing="sm" verticalSpacing="sm">
      {children}
    </SimpleGrid>
  );
}
