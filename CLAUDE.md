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

Project yang sama dipakai `kembang_cms` dan `kembang_web`. Service ini pakai **service role key** (bypass RLS) karena authorization dihandle manual di kode Hono, bukan lewat Postgres RLS policy. Migration schema: root `kembang/supabase/migrations/` (source of truth) — **JANGAN** taruh migration baru di `kembang_cms/supabase/migrations/`, folder itu sudah diverged/bukan mirror.

Local dev pakai **local Supabase** (self-hosted via Supabase CLI, Docker), bukan project cloud/prod.

## Kandidat Migrasi

`kembang_cms/supabase/functions/` (orders, deliveries, delivery-count, invoice-datatable, dashboard) masih stub/TODO di Supabase Edge Functions. Kalau mau konsolidasi business logic ke 1 tempat, kandidat untuk dipindah ke sini — belum dilakukan, cek dengan tim sebelum migrasi biar gak duplikat endpoint.

## Authorization Model

Karena service role key bypass RLS, **semua** authorization ada di kode:

- `requireAuth` — validasi `Authorization: Bearer <supabase-jwt>`, atau `X-Internal-Token` yang match `INTERNAL_API_TOKEN` (timing-safe). Kalau header internal dikirim tapi salah → 401, gak ada fallback ke Authorization.
- `requireAdmin` — cek `app_metadata.role === 'admin'`. Dipakai di `/api/v1/admin/*` dan `/api/v1/ai-chat/*`.

Role disimpan di **`app_metadata`**, bukan `user_metadata` — `app_metadata` cuma bisa ditulis pakai service role key, jadi user gak bisa self-promote lewat `updateUser()`.

CMS dan storefront publik share endpoint login yang sama, jadi tanpa `requireAdmin` token customer bisa akses semua endpoint admin.

Seed/kelola admin:

```
npm run grant-admin -- --list                 # lihat semua user + role
npm run grant-admin -- admin@contoh.com       # jadikan admin
npm run grant-admin -- --revoke user@contoh.com
```

**WAJIB** jalankan untuk semua akun CMS sebelum deploy — kalau belum, semua orang kena 403.

## Env Vars — Security

| Var | Wajib | Catatan |
|---|---|---|
| `INTERNAL_API_TOKEN` | ya | Shared secret self-call internal (AI tool → route admin). Generate: `openssl rand -hex 32`. Kosong = jalur internal mati (fail closed), tool AI gak jalan. |
| `TELEGRAM_WEBHOOK_SECRET` | ya (kalau pakai Telegram) | Diverifikasi dari header `X-Telegram-Bot-Api-Secret-Token`. Set nilai sama saat `setWebhook?...&secret_token=<SECRET>`. |
| `TELEGRAM_ALLOWED_CHAT_IDS` | ya (kalau pakai Telegram) | Allowlist chat id. **Kosong = tolak semua chat** (fail closed). |
| `INVOICE_SECRET_KEY` | ya | Kunci AES untuk invoice code. Code baru punya `exp` 30 hari; code lama tanpa `exp` tetap valid (backward compat). |
| `VERCEL_DEPLOY_HOOK_URL` | ya (re-deploy website) | Secret Deploy Hook untuk re-deploy manual SSG `kembang_web` dari Pengaturan CMS; jangan expose ke browser atau log. |
| `SWAGGER_USERNAME` / `SWAGGER_PASSWORD` | opsional | Jangan set di production = docs mati. |
