import fs from "node:fs";
import path from "node:path";

function localEnv(): Record<string, string> {
  const file = path.join(process.cwd(), "local.env");
  if (!fs.existsSync(file)) return {};
  return Object.fromEntries(fs.readFileSync(file, "utf8").split(/\r?\n/).flatMap((line) => {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    return match ? [[match[1], match[2].replace(/^['\"]|['\"]$/g, "")]] : [];
  }));
}

export const env = (key: string) => {
  if (process.env[key] !== undefined && process.env[key] !== "") return process.env[key]!;
  const upper = key.toUpperCase();
  if (process.env[upper] !== undefined && process.env[upper] !== "") return process.env[upper]!;
  const lower = key.toLowerCase();
  if (process.env[lower] !== undefined && process.env[lower] !== "") return process.env[lower]!;
  const fallback = localEnv();
  return fallback[key] || fallback[upper] || fallback[lower] || "";
};
export const configured = (key: string) => Boolean(env(key));

// Supports the existing local.env name without ever returning it to the browser.
export const anthropicKey = () => env("ANTHROPIC_API_KEY") || env("claude_api_key");
export const supabaseUrl = () => env("SUPABASE_URL");
export const supabaseAnonKey = () => env("SUPABASE_ANON_KEY");
export const supabaseServiceRoleKey = () => env("SUPABASE_SERVICE_ROLE_KEY") || env("SUPABASE_ANON_KEY");

export function publicConfiguration() {
  const hasClaude = Boolean(anthropicKey());
  const hasFrameio = Boolean(env("FRAMEIO_ACCESS_TOKEN") && env("FRAMEIO_ACCOUNT_ID"));
  const hasGroq = Boolean(env("GROQ_API_KEY"));
  const hasBeehiiv = Boolean(env("BEEHIIV_API_KEY"));
  const emailProvider = env("EMAIL_PROVIDER") || "resend";
  const hasEmail = Boolean(
    ((env("EMAIL_API_KEY") || env("RESEND_API_KEY") || env("resend_api_key")) && emailProvider === "resend") ||
    (emailProvider === "beehiiv" && hasBeehiiv)
  );
  const hasSupabase = Boolean(supabaseUrl()) && (Boolean(supabaseAnonKey()) || Boolean(supabaseServiceRoleKey()));
  return {
    frameio: hasFrameio,
    groq: hasGroq,
    claude: hasClaude,
    email: hasEmail,
    beehiiv: hasBeehiiv,
    emailProvider,
    claudeModel: env("CLAUDE_MODEL") || "claude-opus-5-5",
    transcriptionModel: env("GROQ_TRANSCRIPTION_MODEL") || "whisper-large-v3-turbo",
    activeProvider: "Claude",
    supabase: hasSupabase,
  };
}
