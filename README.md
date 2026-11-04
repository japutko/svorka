# Svorka

Record-keeping app for an electrician sole trader: customers and jobs, finances, inspections/quotes/invoices, attendance and trips, to-dos and reminders. Installable PWA for phone and PC.

## Stack

- **Cloudflare Workers** (static assets + API in one Worker), **D1** database `svorka-db` (EU jurisdiction)
- **Vite + React + TypeScript**, **Mantine** UI
- **Hono** API under `/api/*`
- Planned: Cloudflare Access (login), Cron Triggers (reminders, email digests), Microsoft Graph (OneDrive documents), Mapy.com (address autocomplete)

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
npm run db:migrate:local   # create local D1 tables
npm run dev                # http://localhost:5173
```

## Deploy

Pushing to `main` deploys automatically via Cloudflare Workers Builds
(build: `npm run build`, deploy: `npm run deploy`, which applies pending D1 migrations first).

Manual deploy: `npm run build && npm run deploy`.

## Database changes

Add a new numbered file in `migrations/` (e.g. `0002_finance.sql`). Never edit an applied migration.
User-defined fields live in each table's `custom_fields` JSON column, described by `field_definition`.
