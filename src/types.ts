export type Bindings = {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  API_PUBLIC_URL?: string;
  /** R2 bucket untuk gambar landing page dan aset website yang dikelola CMS. */
  SITE_CONTENT_BUCKET: R2Bucket;
  /** Public custom domain untuk mengubah object path R2 menjadi URL response. */
  R2_PUBLIC_URL: string;
  OMNIROUTER_API_KEY: string;
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_ALLOWED_CHAT_IDS: string;
  AI_SESSIONS: any; // KVNamespace
  INVOICE_SECRET_KEY: string;
  GEOAPIFY_API_KEY: string;
  SWAGGER_USERNAME?: string;
  SWAGGER_PASSWORD?: string;
  MAPBOX_ACCESS_TOKEN: string;
  /** Shared secret untuk self-call internal (AI tools -> route admin). Wajib di production. */
  INTERNAL_API_TOKEN?: string;
  /** Vercel Deploy Hook untuk re-deploy manual kembang_web dari pengaturan CMS. */
  VERCEL_DEPLOY_HOOK_URL?: string;
  /** Secret token webhook Telegram (dicocokkan dengan X-Telegram-Bot-Api-Secret-Token) */
  TELEGRAM_WEBHOOK_SECRET?: string;
};

export type Variables = {
  supabase: any;
  userId: string;
  /** Role hasil resolve requireAuth. 'admin' berasal dari app_metadata.role (service-role only). */
  userRole: string;
  /** true kalau request datang dari self-call internal, bukan user asli */
  isInternal: boolean;
};
