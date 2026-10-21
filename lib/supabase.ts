import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { supabaseUrl, supabaseServiceRoleKey, supabaseAnonKey } from "@/lib/env";

let cachedClient: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (cachedClient) return cachedClient;
  const url = supabaseUrl();
  const key = supabaseServiceRoleKey() || supabaseAnonKey();
  if (!url || !key) {
    throw new Error("Supabase is not configured. Set SUPABASE_URL and SUPABASE_ANON_KEY (or SUPABASE_SERVICE_ROLE_KEY).");
  }
  cachedClient = createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
  return cachedClient;
}

export type ReelRow = {
  id: string;
  permalink?: string | null;
  thumbnail_url?: string | null;
  caption?: string | null;
  published_at?: string | null;
  transcript: string;
  summary?: string | null;
  key_themes?: string[] | null;
  created_at?: string;
};

export type ReelMetricRow = {
  id?: string;
  reel_id: string;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  saves: number;
  engagement_rate?: number;
  recorded_at?: string;
};

export type ReelEmbeddingRow = {
  id?: string;
  reel_id: string;
  chunk_text: string;
  speaker_timestamp?: string | null;
  embedding?: number[];
};
