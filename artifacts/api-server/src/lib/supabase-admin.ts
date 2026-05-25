import { createClient } from "@supabase/supabase-js";

const supabaseUrl = "https://dvgcrxrnnezbdjpujjjt.supabase.co";

if (!process.env["SUPABASE_SERVICE_ROLE_KEY"]) {
  throw new Error("SUPABASE_SERVICE_ROLE_KEY is required");
}

export const supabaseAdmin = createClient(
  supabaseUrl,
  process.env["SUPABASE_SERVICE_ROLE_KEY"],
  { auth: { autoRefreshToken: false, persistSession: false } }
);

export const SUPABASE_URL = supabaseUrl;
