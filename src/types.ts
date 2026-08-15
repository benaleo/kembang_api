import { createClient } from '@supabase/supabase-js';

export type Bindings = {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  GEMINI_API_KEY: string;
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_ALLOWED_CHAT_IDS: string;
  AI_SESSIONS: any; // KVNamespace — use any to avoid Workers types import complexity
};

export type Variables = {
  supabase: ReturnType<typeof createClient>;
  userId: string;
};
