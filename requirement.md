# Kembang API Deploy Requirements

Dokumen ini dipakai buat ngumpulin semua info yang dibutuhkan sebelum deploy `kembang_api` ke Cloudflare Workers.

> Jangan commit secret asli kalau repo ini akan dipush ke remote. Isi nilai secret di file ini hanya kalau aman secara lokal. Alternatif yang lebih aman: tulis `READY` / `NEED HELP`, lalu secret dimasukkan via `wrangler secret put` saat deploy.

## 1. Target Deploy

Isi bagian ini dulu supaya jelas deploy-nya mau ke mana.

- Cloudflare account/team name: 29fba5381cafbae9ade39231aeb7f38e
- Cloudflare Workers project name: `kembang-api`
- Environment target: `production`
- Domain/route yang diinginkan, kalau ada: `api-kembang.langganan-ku.my.id`
  - contoh: `api.kembang.id/*`
- Apakah perlu custom domain sekarang? `ya`

## 2. Auth Manual yang Mungkin Dibutuhkan

Centang/isi statusnya.

- [ ] Bisa login Cloudflare dari terminal ini dengan `wrangler login`
- [ ] Kalau belum login, user akan jalankan manual:
- [v] sudah login manual

```bash
wrangler login
```

Atau dari root service:

```bash
cd kembang_api
npx wrangler login
```

Catatan: login Cloudflare biasanya buka browser, jadi kemungkinan perlu konfirmasi/manual dari user.

## 3. Cloudflare Resources

Config sekarang di `wrangler.jsonc` punya binding KV:

```jsonc
"kv_namespaces": [
  { "binding": "AI_SESSIONS" }
]
```

Yang dibutuhkan:

- [ v ] KV namespace untuk `AI_SESSIONS` sudah dibuat di Cloudflare
- KV namespace id production: 25fbf0e9b9424af98957baee293cf6d2
- KV namespace id preview, kalau ada: 25fbf0e9b9424af98957baee293cf6d2

Kalau belum ada, perlu dibuat manual/command Wrangler, lalu `wrangler.jsonc` perlu diupdate dengan `id`/`preview_id`. Contoh bentuk akhirnya:

```jsonc
"kv_namespaces": [
  {
    "binding": "AI_SESSIONS",
    "id": "25fbf0e9b9424af98957baee293cf6d2",
    "preview_id": "25fbf0e9b9424af98957baee293cf6d2"
  }
]
```

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "WORKER-NAME",
  "main": "src/index.ts",
  "compatibility_date": "2025-02-04",
  "observability": {
    "enabled": true
  },

  // Add this to your wrangler.jsonc
  "kv_namespaces": [
    {
      "binding": "KV",
      "id": "25fbf0e9b9424af98957baee293cf6d2",
      
      // Optional: preview_id used when running `wrangler dev` for local dev
      "preview_id": "25fbf0e9b9424af98957baee293cf6d2"
    }
  ]
}
```

## 4. Production Secrets

Secret jangan ditulis di chat. Isi status saja, atau isi nilainya di tempat aman lalu nanti kita set via `wrangler secret put`.

Secret yang diketahui dari `.dev.vars.example`:

| Secret | Wajib? | Status / Catatan |
|---|---:|---|
| `SUPABASE_URL` | Ya | done |
| `SUPABASE_SERVICE_ROLE_KEY` | Ya | done |
| `OMNIROUTER_API_KEY` | Jika fitur AI chat dipakai | SKIP |
| `TELEGRAM_BOT_TOKEN` | Jika Telegram webhook dipakai | SKIP |
| `TELEGRAM_ALLOWED_CHAT_IDS` | Jika Telegram webhook dipakai | SKIP |
| `INVOICE_SECRET_KEY` | Jika invoice/link secure dipakai | done |

Command set secret nanti dijalankan dari folder `kembang_api`:

```bash
npx wrangler secret put SUPABASE_URL
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
npx wrangler secret put OMNIROUTER_API_KEY
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put TELEGRAM_ALLOWED_CHAT_IDS
npx wrangler secret put INVOICE_SECRET_KEY
```

Kalau ada secret yang fiturnya belum dipakai di production, tandai `SKIP` dulu.

## 5. Supabase Production

Karena API pakai service role key dan bypass RLS, pastikan ini benar-benar project production yang dimaksud.

- Supabase project ref/name production: jiikdjtzjlmatvojtlsl
- Supabase URL production: https://jiikdjtzjlmatvojtlsl.supabase.co
- Apakah schema/migration production sudah up to date dari root `supabase/migrations/`? `ya`
- Apakah service role key production siap dimasukkan via Wrangler secret? `ya`

## 6. CORS / Frontend Origin

`src/index.ts` sekarang allow origin:

- `http://localhost:4321`
- `http://127.0.0.1:4321`
- `http://localhost:5173`
- `http://127.0.0.1:5173`

Untuk production, isi domain frontend yang perlu akses API:

- CMS production origin:`https://kembang-cms.langganan-ku.my.id`
- Web production origin:`https://kembang.langganan-ku.my.id`
- Staging/preview origin, kalau ada:

Catatan: sebelum deploy production final, CORS perlu diupdate supaya domain production bisa call API. Kalau tidak, browser akan kena CORS error meskipun API hidup.

## 7. Pre-Deploy Verification

Sebelum deploy, kita jalankan:

```bash
cd kembang_api
npm install
npm exec -- tsc --project tsconfig.json --noEmit
npm run deploy -- --dry-run
```

Checklist:

- [ ] Dependencies installed
- [ ] TypeScript check pass
- [ ] Wrangler dry-run pass
- [ ] Secrets sudah diset
- [ ] KV binding valid
- [ ] CORS production origin sudah benar

## 8. Deploy Command

Final deploy dari folder `kembang_api`:

```bash
npm run deploy
```

Atau eksplisit:

```bash
npx wrangler deploy
```

## 9. Post-Deploy Checks

Setelah deploy, cek:

```bash
curl https://<worker-url>/health
```

Expected response:

```json
{"status":"ok"}
```

Lalu test endpoint auth/admin dari CMS production/staging.

## 10. Yang Perlu User Confirm

Isi ini biar Athena bisa lanjut tanpa bolak-balik nanya:

- [ v ] Saya confirm deploy target Cloudflare Workers adalah project/account yang benar
- [ v ] Saya confirm Supabase production URL dan service role key sudah benar
- [ v ] Saya confirm boleh update `wrangler.jsonc` untuk KV namespace id dan CORS production origin
- [ v ] Saya confirm boleh menjalankan `wrangler deploy` setelah verification pass
- [ v ] Kalau butuh browser login Cloudflare, saya siap menjalankan manual `wrangler login`

## Notes dari User

Tulis catatan tambahan di bawah ini:

- jangan sampai data di supabase hilang atau ke reset
