# Svorka

Record-keeping app for an electrician sole trader: customers and jobs, finances, inspections/quotes/invoices, attendance and trips, to-dos and reminders. Installable PWA for phone and PC.

## What is deployed where

Everything runs in one Cloudflare account; the source lives on GitHub. There is no other server.

| What | Where | Notes |
| --- | --- | --- |
| Source code | GitHub `japutko/svorka` | `main` is production |
| Build + deploy | Cloudflare Workers Builds | Runs on every push to `main`: `npm run build`, then `npm run deploy` |
| App (web UI + API) | Cloudflare Worker `svorka` | https://svorka.jakubsebok.workers.dev — serves the React app and `/api/*` |
| Database | Cloudflare D1 `svorka-db` (EU jurisdiction) | Binding `DB`; migrations in `migrations/` are applied on deploy |
| Documents | Cloudflare R2 bucket `svorka-files` | Binding `FILES`; receipts, quotes, invoices, inspection files |
| Receipt reading | Cloudflare Workers AI | Binding `AI`; no key, billed to the Cloudflare account |
| Daily job | Cron Trigger on the same Worker | 05:00 UTC, turns notification rules into todos |
| Login | Cloudflare Access (Zero Trust) | Configured in the dashboard, in front of the Worker's domain |
| Address autocomplete | Mapy.com API (external) | Worker secret `MAPY_API_KEY`; without it addresses are plain text |

Secrets are stored on the Worker (`npx wrangler secret put …`), never in the repo: `MAPY_API_KEY`, and optionally
`ACCESS_TEAM_DOMAIN` + `ACCESS_AUD`. Resource names and bindings are in `wrangler.jsonc`.

## Architecture

Svorka is a single Cloudflare Worker. It serves the built React single-page app as static assets and handles
every request under `/api/*` with a **Hono** API (`src/worker/index.ts`); any other path falls back to
`index.html`, so client-side routing works. The browser only ever talks to this one origin.

The client (`src/client/`) is **Vite + React + TypeScript** with **Mantine** UI, installable as a PWA. It is
deliberately generic: every list is the same `DataTable` and every form opens through `useForms().openForm(entity)`,
driven by per-entity column and form definitions.

The API mirrors that: `entities.ts` provides generic CRUD under `/api/e/*` for all tables, with separate modules
for search (SQLite FTS5), files, dashboard, notifications, admin (lookup lists, custom fields), geo (Mapy.com
proxy) and AI. All data is in D1 (SQLite); user-defined fields live in each table's `custom_fields` JSON column.
Files go through a small `Storage` interface backed by R2 (`src/worker/files.ts`), so a OneDrive backend can
replace it later. Scanned receipts are sent to a Workers AI vision model, which returns structured fields that
prefill the ledger entry.

Authentication is handled at the edge by Cloudflare Access. When `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD` are set,
the Worker also verifies the Access token on every API request (`src/worker/auth.ts`), so the `workers.dev` URL
can't bypass the login. The same Worker has a `scheduled` handler for the daily cron.

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
