# Kembang API

Backend service terpusat untuk `kembang_cms` dan `kembang_web`. Tujuan: business logic & authorization granular yang gak gantung RLS/policy Supabase — bisa di-monitor di 1 tempat (Cloudflare dashboard/logs).

## Tech Stack

| Layer | Tech |
|---|---|
| Framework | Hono |
| Runtime | Cloudflare Workers |
| Language | TypeScript |
| Backend Data | Supabase (service role key, bypass RLS — authorization dihandle di kode) |

## Development

```
npm install
cp .dev.vars.example .dev.vars   # isi SUPABASE_URL & SUPABASE_SERVICE_ROLE_KEY
npm run dev                       # wrangler dev
```

Deploy: `npm run deploy` (wrangler deploy) — perlu `wrangler login` dan secrets di-set via `wrangler secret put`.

## Struktur

- `src/index.ts` — entry point Hono app: CORS, health check, Supabase client init per-request, route groups (`/orders`, `/deliveries`)
- Route groups saat ini masih **scaffold/TODO** — belum ada implementasi nyata.

## Supabase — Shared Project

Project yang sama dipakai `kembang_cms` dan `kembang_web`. Service ini pakai **service role key** (bypass RLS) karena authorization dihandle manual di kode Hono, bukan lewat Postgres RLS policy. Migration schema: lihat `kembang_cms/supabase/migrations/` (source of truth) atau mirror di `../supabase-schema/migrations/`.

## Kandidat Migrasi

`kembang_cms/supabase/functions/` (orders, deliveries, delivery-count, invoice-datatable, dashboard) masih stub/TODO di Supabase Edge Functions. Kalau mau konsolidasi business logic ke 1 tempat, kandidat untuk dipindah ke sini — belum dilakukan, cek dengan tim sebelum migrasi biar gak duplikat endpoint.
