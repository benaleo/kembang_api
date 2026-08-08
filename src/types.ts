import { createClient } from '@supabase/supabase-js';

export type Bindings = {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
};

export type Variables = {
  supabase: ReturnType<typeof createClient>;
  userId: string;
};
