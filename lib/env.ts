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
  if (process.env[key] !== undefined) return process.env[key]!;
  const fallback = localEnv();
  return fallback[key] || fallback[key.toLowerCase()] || "";
};
export const configured = (key: string) => Boolean(env(key));

// Supports the existing local.env name without ever returning it to the browser.
export const anthropicKey = () => env("ANTHROPIC_API_KEY") || env("claude_api_key");
export const geminiKey = () => env("GEMINI_API_KEY") || env("gemini_api_key");
export const supabaseUrl = () => env("SUPABASE_URL");
export const supabaseAnonKey = () => env("SUPABASE_ANON_KEY");
export const supabaseServiceRoleKey = () => env("SUPABASE_SERVICE_ROLE_KEY") || env("SUPABASE_ANON_KEY");

export function publicConfiguration() {
  const hasClaude = Boolean(anthropicKey()) && configured("CLAUDE_MODEL");
  const hasGemini = Boolean(geminiKey());
  const hasSupabase = Boolean(supabaseUrl()) && (Boolean(supabaseAnonKey()) || Boolean(supabaseServiceRoleKey()));
  return {
    frameio: configured("FRAMEIO_ACCESS_TOKEN") && configured("FRAMEIO_ACCOUNT_ID") && configured("FRAMEIO_WEBHOOK_SECRET"),
    groq: configured("GROQ_API_KEY"),
    claude: hasClaude || hasGemini,
    email: (configured("EMAIL_API_KEY") || configured("resend_api_key")) && configured("EMAIL_FROM") && (env("EMAIL_PROVIDER") || "resend") === "resend",
    claudeModel: (hasGemini && !configured("ANTHROPIC_WORKSPACE_ID") ? env("GEMINI_MODEL") || "gemini-2.5-flash" : env("CLAUDE_MODEL")) || null,
    transcriptionModel: env("GROQ_TRANSCRIPTION_MODEL") || "whisper-large-v3-turbo",
    activeProvider: hasGemini && !configured("ANTHROPIC_WORKSPACE_ID") ? "Gemini" : "Claude",
    supabase: hasSupabase
  };
}
