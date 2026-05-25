import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables: VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are required');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export interface Device {
  id: number;
  app_id: string;
  device_id: string;
  device_name: string | null;
  device_model: string | null;
  android_version: string | null;
  registered_at: string | null;
  is_active: boolean;
  last_seen: string | null;
  admin_id: string | null;
}

export interface AppSummary {
  app_id: string;
  device_count: number;
  active_count: number;
  last_registered: string | null;
}
