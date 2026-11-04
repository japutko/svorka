import { createContext, useCallback, useContext, useRef, useState, type ComponentType, type ReactNode } from "react";
import { Modal } from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import type { Row } from "../api";

export type FormProps = { id?: number; defaults?: Row; onDone: (row: Row | null) => void };
type OpenOpts = { id?: number; defaults?: Row };
type Ctx = { openForm: (entity: string, opts?: OpenOpts) => Promise<Row | null> };

const FormsContext = createContext<Ctx>({ openForm: async () => null });

export const useForms = () => useContext(FormsContext);

export const entityTitles: Record<string, [string, string]> = {
  person: ["Nová osoba", "Osoba"],
  job: ["Nová zákazka", "Zákazka"],
  ledger_entry: ["Nový účtovný záznam", "Účtovný záznam"],
  inspection: ["Nová obhliadka", "Obhliadka"],
  quote: ["Nová cenová ponuka", "Cenová ponuka"],
  invoice: ["Nová faktúra", "Faktúra"],
  attendance: ["Nová dochádzka", "Dochádzka"],
  trip: ["Nová jazda", "Jazda"],
  refuel: ["Nové tankovanie", "Tankovanie"],
  todo: ["Nové todo", "Todo"],
};

type Entry = { key: number; entity: string; opts: OpenOpts; resolve: (r: Row | null) => void };

// Forms open as stacked modals, so a form can open another one (e.g. new
// customer from inside the job form) and get the created record back.
export function FormsProvider({ registry, children }: { registry: Record<string, ComponentType<FormProps>>; children: ReactNode }) {
  const [stack, setStack] = useState<Entry[]>([]);
  const seq = useRef(0);
  const isMobile = useMediaQuery("(max-width: 48em)");

  const openForm = useCallback(
    (entity: string, opts: OpenOpts = {}) =>
      new Promise<Row | null>((resolve) => setStack((s) => [...s, { key: ++seq.current, entity, opts, resolve }])),
    []
  );

  const close = (key: number, row: Row | null) => {
    setStack((s) => {
      s.find((e) => e.key === key)?.resolve(row);
      return s.filter((e) => e.key !== key);
    });
  };

  return (
    <FormsContext.Provider value={{ openForm }}>
      {children}
      {stack.map((e, i) => {
        const Form = registry[e.entity];
        const [newTitle, editTitle] = entityTitles[e.entity] ?? [e.entity, e.entity];
        return (
          <Modal
            key={e.key}
            opened
            onClose={() => close(e.key, null)}
            title={e.opts.id ? editTitle : newTitle}
            size="lg"
            fullScreen={isMobile}
            zIndex={200 + i * 10}
            closeOnClickOutside={false}
            styles={{ title: { fontWeight: 700 } }}
          >
            {Form ? <Form id={e.opts.id} defaults={e.opts.defaults} onDone={(row) => close(e.key, row)} /> : null}
          </Modal>
        );
      })}
    </FormsContext.Provider>
  );
}
