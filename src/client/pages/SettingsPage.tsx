import { useState } from "react";
import { ActionIcon, Badge, Button, Checkbox, ColorSwatch, Group, Menu, Paper, Select, Stack, Table, Tabs, Text, TextInput, Tooltip } from "@mantine/core";
import { IconArrowDown, IconArrowUp, IconPlus } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { api, notifyError, queryClient, useCodelistTypes, useCodelists, useSettings, type CodelistItem, type FieldDef } from "../api";
import { EntityPicker } from "../components/inputs";
import { entityTitles } from "../forms/FormsProvider";
import { PageHeader } from "./ListPages";

const colors = ["gray", "red", "pink", "grape", "violet", "indigo", "blue", "cyan", "teal", "green", "lime", "yellow", "orange"];

const refresh = () => queryClient.invalidateQueries({ queryKey: ["codelists"] });

async function patchItem(id: number, d: Partial<CodelistItem>) {
  try {
    await api(`/admin/codelists/${id}`, { method: "PATCH", json: d });
    refresh();
  } catch (e) {
    notifyError(e);
  }
}

function CodelistEditor() {
  const types = useCodelistTypes();
  const all = useCodelists();
  const [type, setType] = useState<string | null>("job_status");
  const [newLabel, setNewLabel] = useState("");
  const items = (all.data ?? []).filter((c) => c.type === type);
  const isStatus = type === "job_status";

  const move = async (i: number, dir: -1 | 1) => {
    const a = items[i];
    const b = items[i + dir];
    if (!a || !b) return;
    await patchItem(a.id, { sort_order: b.sort_order });
    await patchItem(b.id, { sort_order: a.sort_order === b.sort_order ? a.sort_order + dir : a.sort_order });
  };

  return (
    <Stack>
      <Group align="flex-end">
        <Select label="Číselník" data={(types.data ?? []).map((t) => ({ value: t.key, label: t.label }))} value={type} onChange={setType} w={280} searchable />
        <Button
          variant="subtle"
          leftSection={<IconPlus size={14} />}
          onClick={async () => {
            const label = prompt("Názov nového číselníka (napr. Dodávateľ materiálu)");
            if (!label) return;
            const key = label.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
            await api("/admin/codelist-types", { method: "POST", json: { key, label } }).catch(notifyError);
            await queryClient.invalidateQueries({ queryKey: ["codelist-types"] });
            setType(key);
          }}
        >
          Nový číselník
        </Button>
      </Group>
      <Text size="xs" c="dimmed">
        Hodnoty sa nemažú, iba deaktivujú – staré záznamy si ich ponechajú. Premenovanie sa prejaví všade.
      </Text>
      <Table withTableBorder>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Poradie</Table.Th>
            <Table.Th>Hodnota</Table.Th>
            <Table.Th>Farba</Table.Th>
            <Table.Th>Predvolená</Table.Th>
            {isStatus && (
              <>
                <Table.Th>
                  <Tooltip label="Zákazky v tomto stave sú hore a farebne zvýraznené">
                    <span>Aktívny stav</span>
                  </Tooltip>
                </Table.Th>
                <Table.Th>
                  <Tooltip label="Zákazky v tomto stave sa zobrazujú ako leady v notifikáciách">
                    <span>Lead</span>
                  </Tooltip>
                </Table.Th>
              </>
            )}
            <Table.Th>Aktívna</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {items.map((c, i) => (
            <Table.Tr key={c.id} style={{ opacity: c.active ? 1 : 0.5 }}>
              <Table.Td>
                <Group gap={0} wrap="nowrap">
                  <ActionIcon variant="subtle" size="sm" disabled={i === 0} onClick={() => move(i, -1)}>
                    <IconArrowUp size={14} />
                  </ActionIcon>
                  <ActionIcon variant="subtle" size="sm" disabled={i === items.length - 1} onClick={() => move(i, 1)}>
                    <IconArrowDown size={14} />
                  </ActionIcon>
                </Group>
              </Table.Td>
              <Table.Td>
                <TextInput
                  size="xs"
                  defaultValue={c.label}
                  onBlur={(e) => e.currentTarget.value !== c.label && e.currentTarget.value.trim() && patchItem(c.id, { label: e.currentTarget.value.trim() })}
                />
              </Table.Td>
              <Table.Td>
                <Menu>
                  <Menu.Target>
                    <ActionIcon variant="default" size="sm">
                      {c.color ? <ColorSwatch size={14} color={`var(--mantine-color-${c.color}-6)`} /> : "–"}
                    </ActionIcon>
                  </Menu.Target>
                  <Menu.Dropdown>
                    <Group gap={4} p={4} w={180}>
                      <ActionIcon size="sm" variant="default" onClick={() => patchItem(c.id, { color: null })}>
                        –
                      </ActionIcon>
                      {colors.map((col) => (
                        <ActionIcon key={col} size="sm" variant="transparent" onClick={() => patchItem(c.id, { color: col })}>
                          <ColorSwatch size={16} color={`var(--mantine-color-${col}-6)`} />
                        </ActionIcon>
                      ))}
                    </Group>
                  </Menu.Dropdown>
                </Menu>
              </Table.Td>
              <Table.Td>
                <Checkbox checked={!!c.is_default} onChange={(e) => patchItem(c.id, { is_default: e.currentTarget.checked ? 1 : 0 })} />
              </Table.Td>
              {isStatus && (
                <>
                  <Table.Td>
                    <Checkbox checked={!!c.is_active_state} onChange={(e) => patchItem(c.id, { is_active_state: e.currentTarget.checked ? 1 : 0 })} />
                  </Table.Td>
                  <Table.Td>
                    <Checkbox checked={!!c.meta?.lead} onChange={(e) => patchItem(c.id, { meta: { ...c.meta, lead: e.currentTarget.checked } })} />
                  </Table.Td>
                </>
              )}
              <Table.Td>
                <Checkbox checked={!!c.active} onChange={(e) => patchItem(c.id, { active: e.currentTarget.checked ? 1 : 0 })} />
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      <Group>
        <TextInput placeholder="Nová hodnota" value={newLabel} onChange={(e) => setNewLabel(e.currentTarget.value)} />
        <Button
          disabled={!newLabel.trim() || !type}
          onClick={async () => {
            await api("/admin/codelists", { method: "POST", json: { type, label: newLabel.trim() } }).catch(notifyError);
            setNewLabel("");
            refresh();
          }}
        >
          Pridať
        </Button>
      </Group>
    </Stack>
  );
}

const dataTypes = [
  { value: "text", label: "Text" },
  { value: "number", label: "Číslo" },
  { value: "date", label: "Dátum" },
  { value: "boolean", label: "Áno/nie" },
  { value: "codelist", label: "Číselník" },
];

function FieldEditor() {
  const fields = useQuery({ queryKey: ["fields"], queryFn: () => api<FieldDef[]>("/admin/fields") });
  const types = useCodelistTypes();
  const [entity, setEntity] = useState<string | null>("job");
  const [draft, setDraft] = useState({ label: "", data_type: "text", codelist_type: null as string | null });
  const list = (fields.data ?? []).filter((f) => f.entity_type === entity);
  const refreshFields = () => queryClient.invalidateQueries({ queryKey: ["fields"] });
  return (
    <Stack>
      <Text size="sm" c="dimmed">
        Vlastné polia sa pridajú do formulára aj ako stĺpec tabuľky (skrytý, zapneš ho v ponuke Stĺpce). Premenovanie je bezpečné – dáta sú uložené pod pevným kľúčom.
      </Text>
      <Select label="Typ záznamu" data={Object.entries(entityTitles).map(([value, [, label]]) => ({ value, label }))} value={entity} onChange={setEntity} w={280} />
      <Table withTableBorder>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Názov</Table.Th>
            <Table.Th>Typ</Table.Th>
            <Table.Th>Kľúč</Table.Th>
            <Table.Th>Aktívne</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {list.map((f) => (
            <Table.Tr key={f.id} style={{ opacity: f.active ? 1 : 0.5 }}>
              <Table.Td>
                <TextInput
                  size="xs"
                  defaultValue={f.label}
                  onBlur={async (e) => {
                    const label = e.currentTarget.value.trim();
                    if (!label || label === f.label) return;
                    await api(`/admin/fields/${f.id}`, { method: "PATCH", json: { label } }).catch(notifyError);
                    refreshFields();
                  }}
                />
              </Table.Td>
              <Table.Td>
                {dataTypes.find((d) => d.value === f.data_type)?.label}
                {f.codelist_type && <Badge size="xs" ml={4} variant="outline">{types.data?.find((t) => t.key === f.codelist_type)?.label ?? f.codelist_type}</Badge>}
              </Table.Td>
              <Table.Td>
                <Text size="xs" ff="monospace" c="dimmed">
                  {f.key}
                </Text>
              </Table.Td>
              <Table.Td>
                <Checkbox
                  checked={!!f.active}
                  onChange={async (e) => {
                    await api(`/admin/fields/${f.id}`, { method: "PATCH", json: { active: e.currentTarget.checked } });
                    refreshFields();
                  }}
                />
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      <Group align="flex-end">
        <TextInput label="Nové pole" placeholder="napr. Číslo bytu" value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.currentTarget.value })} />
        <Select label="Typ" data={dataTypes} value={draft.data_type} onChange={(v) => setDraft({ ...draft, data_type: v ?? "text" })} w={140} allowDeselect={false} />
        {draft.data_type === "codelist" && (
          <Select label="Číselník" data={(types.data ?? []).map((t) => ({ value: t.key, label: t.label }))} value={draft.codelist_type} onChange={(v) => setDraft({ ...draft, codelist_type: v })} w={200} />
        )}
        <Button
          disabled={!draft.label.trim() || (draft.data_type === "codelist" && !draft.codelist_type)}
          onClick={async () => {
            await api("/admin/fields", { method: "POST", json: { entity_type: entity, ...draft, label: draft.label.trim() } }).catch(notifyError);
            setDraft({ label: "", data_type: "text", codelist_type: null });
            refreshFields();
          }}
        >
          Pridať pole
        </Button>
      </Group>
    </Stack>
  );
}

function GeneralSettings() {
  const settings = useSettings();
  const me = settings.data?.self_person_id ? Number(settings.data.self_person_id) : null;
  const health = useQuery({ queryKey: ["geo-status"], queryFn: () => api<{ enabled: boolean }>("/geo/status") });
  return (
    <Stack maw={480}>
      <Paper withBorder p="sm">
        <Text fw={600} mb={4}>
          Ja
        </Text>
        <Text size="sm" c="dimmed" mb="xs">
          Osoba, ktorá sa predvyplní v dochádzke a podľa ktorej sa kontroluje chýbajúca dochádzka.
        </Text>
        <EntityPicker
          entity="person"
          label="Moja osoba"
          value={me}
          onChange={async (id) => {
            await api("/admin/settings", { method: "PUT", json: { self_person_id: id } }).catch(notifyError);
            queryClient.invalidateQueries({ queryKey: ["settings"] });
          }}
        />
      </Paper>
      <Paper withBorder p="sm">
        <Text fw={600}>Adresy</Text>
        <Text size="sm" c={health.data?.enabled ? "green" : "orange"}>
          {health.data?.enabled ? "Mapy.com našepkávač je zapnutý." : "Mapy.com API kľúč nie je nastavený – adresy sa zadávajú ako text."}
        </Text>
      </Paper>
      <Paper withBorder p="sm">
        <Text fw={600}>Úložisko dokumentov</Text>
        <Text size="sm" c="dimmed">
          Cloudflare R2 (priečinky: Uctovne doklady/rok, Zakazky/…). OneDrive sa dá doplniť neskôr bez zmeny dát.
        </Text>
      </Paper>
    </Stack>
  );
}

export function SettingsPage() {
  return (
    <Stack>
      <PageHeader title="Nastavenia" />
      <Tabs defaultValue="general" keepMounted={false}>
        <Tabs.List mb="sm">
          <Tabs.Tab value="general">Všeobecné</Tabs.Tab>
          <Tabs.Tab value="codelists">Číselníky</Tabs.Tab>
          <Tabs.Tab value="fields">Vlastné polia</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="general">
          <GeneralSettings />
        </Tabs.Panel>
        <Tabs.Panel value="codelists">
          <CodelistEditor />
        </Tabs.Panel>
        <Tabs.Panel value="fields">
          <FieldEditor />
        </Tabs.Panel>
      </Tabs>
    </Stack>
  );
}
