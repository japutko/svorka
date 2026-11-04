import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MantineProvider, createTheme } from "@mantine/core";
import { DatesProvider } from "@mantine/dates";
import { Notifications } from "@mantine/notifications";
import { QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router";
import dayjs from "dayjs";
import "dayjs/locale/sk";
import "@mantine/core/styles.css";
import "@mantine/dates/styles.css";
import "@mantine/notifications/styles.css";
import App from "./App";
import { queryClient } from "./api";
import { FormsProvider } from "./forms/FormsProvider";
import { JobForm, PersonForm } from "./forms/PersonJobForms";
import { InvoiceForm, LedgerForm, QuoteForm } from "./forms/FinanceForms";
import { AttendanceForm, InspectionForm, RefuelForm, TodoForm, TripForm } from "./forms/WorkForms";

dayjs.locale("sk");

const theme = createTheme({ primaryColor: "orange" });

const forms = {
  person: PersonForm,
  job: JobForm,
  ledger_entry: LedgerForm,
  invoice: InvoiceForm,
  quote: QuoteForm,
  inspection: InspectionForm,
  attendance: AttendanceForm,
  trip: TripForm,
  refuel: RefuelForm,
  todo: TodoForm,
};

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <MantineProvider theme={theme} defaultColorScheme="auto">
        <DatesProvider settings={{ locale: "sk", firstDayOfWeek: 1 }}>
          <Notifications position="top-center" />
          <BrowserRouter>
            <FormsProvider registry={forms}>
              <App />
            </FormsProvider>
          </BrowserRouter>
        </DatesProvider>
      </MantineProvider>
    </QueryClientProvider>
  </StrictMode>
);
