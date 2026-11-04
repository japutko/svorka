# Svorka

Record-keeping app for an electrician sole trader: customers and jobs, finances, inspections/quotes/invoices, attendance and trips, to-dos and reminders. Installable PWA for phone and PC.

## Stack

- **Cloudflare Workers** (static assets + API in one Worker), **D1** database `svorka-db` (EU jurisdiction)
- **Vite + React + TypeScript**, **Mantine** UI
- **Hono** API under `/api/*`
- **R2** bucket `svorka-files` for documents (folder layout ready for a later OneDrive backend, see `src/worker/files.ts`)
- **Cron Trigger** (daily 05:00 UTC) turns notification rules into todos
- **Mapy.com** address autocomplete (secret `MAPY_API_KEY`; without it addresses are plain text)
- **Cloudflare Access** for login (optional token check in the Worker via `ACCESS_TEAM_DOMAIN` + `ACCESS_AUD`)

## Screens

Prehľad (dashboard with quick entry and saved views) · Zákazky + detail · Osoby · Financie (ledger with split
receipts, receipt photos → one PDF, entry number `U26-001`) · Obhliadky / ponuky / faktúry (invoice number `12/2026`)
· Dochádzka, jazdy, tankovanie (km fund) · Todo · Notifikácie (rules incl. custom SQL) · Nastavenia (lookup lists,
custom fields, "me").

Every list uses the generic `DataTable` (search, filters, grouping, multi-sort, column choice, saved views).
Every form opens through `useForms().openForm(entity)`, so records can be created from inside other forms.

## Layout

```
src/client/   React app
src/worker/   Hono API (Cloudflare Worker)
migrations/   D1 SQL migrations (applied on deploy)
public/       PWA manifest and icons
```

## Local development

```bash
npm install
npx wrangler login
cp .dev.vars.example .dev.vars   # optional: Mapy.com key
npm run db:migrate:local   # create local D1 tables
npm run dev                # http://localhost:5173
```

## First deploy (one-time setup)

```bash
npx wrangler r2 bucket create svorka-files
npx wrangler secret put MAPY_API_KEY        # key from developer.mapy.com
```

Login: Cloudflare dashboard → Zero Trust → Access → Applications → add a self-hosted app for the Worker's
domain with a policy allowing your email. Optionally also set `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD` secrets so the
Worker rejects requests that bypass Access.

## Deploy

Pushing to `main` deploys automatically via Cloudflare Workers Builds
(build: `npm run build`, deploy: `npm run deploy`, which applies pending D1 migrations first).

Manual deploy: `npm run build && npm run deploy`.

## Database changes

Add a new numbered file in `migrations/` (e.g. `0002_finance.sql`). Never edit an applied migration.
User-defined fields live in each table's `custom_fields` JSON column, described by `field_definition`.
