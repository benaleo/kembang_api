export type Bindings = {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  API_PUBLIC_URL?: string;
  OMNIROUTER_API_KEY: string;
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_ALLOWED_CHAT_IDS: string;
  AI_SESSIONS: any; // KVNamespace
  INVOICE_SECRET_KEY: string;
  GEOAPIFY_API_KEY: string;
  SWAGGER_USERNAME?: string;
  SWAGGER_PASSWORD?: string;
  MAPBOX_ACCESS_TOKEN: string;
};

export type Variables = {
  supabase: any;
  userId: string;
};
