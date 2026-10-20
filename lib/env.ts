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
  const fallback = localEnv();
  return process.env[key] || fallback[key] || fallback[key.toLowerCase()] || "";
};
export const configured = (key: string) => Boolean(env(key));

// Supports the existing local.env name without ever returning it to the browser.
export const anthropicKey = () => env("ANTHROPIC_API_KEY") || env("claude_api_key");

export function publicConfiguration() {
  return {
    frameio: configured("FRAMEIO_ACCESS_TOKEN") && configured("FRAMEIO_ACCOUNT_ID") && configured("FRAMEIO_WEBHOOK_SECRET"),
    groq: configured("GROQ_API_KEY"),
    claude: Boolean(anthropicKey()) && configured("CLAUDE_MODEL"),
    email: (configured("EMAIL_API_KEY") || configured("resend_api_key")) && configured("EMAIL_FROM") && (env("EMAIL_PROVIDER") || "resend") === "resend",
    claudeModel: env("CLAUDE_MODEL") || null,
    transcriptionModel: env("GROQ_TRANSCRIPTION_MODEL") || "whisper-large-v3-turbo"
  };
}
