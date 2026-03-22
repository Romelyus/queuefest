import { createClient } from "@supabase/supabase-js";
import type { Database } from "../shared/schema";

// Server-side Supabase client (uses service role key for full access)
const supabaseUrl = process.env.SUPABASE_URL || "";
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

if (!supabaseUrl || !supabaseServiceKey) {
  console.error(
    "❌ SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set!",
    "SUPABASE_URL length:", supabaseUrl.length,
    "KEY length:", supabaseServiceKey.length
  );
}

export const supabaseAdmin = createClient<Database>(supabaseUrl, supabaseServiceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
