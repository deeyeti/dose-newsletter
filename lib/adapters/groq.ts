import fs from "node:fs/promises";
import path from "node:path";
import { env } from "@/lib/env";

export async function transcribeWithGroq(audioPath: string) {
  const key = env("GROQ_API_KEY");
  if (!key) throw new Error("Groq is not configured. Set GROQ_API_KEY and retry.");
  const model = env("GROQ_TRANSCRIPTION_MODEL") || "whisper-large-v3-turbo";
  if (!["whisper-large-v3-turbo", "whisper-large-v3"].includes(model)) throw new Error("GROQ_TRANSCRIPTION_MODEL must be whisper-large-v3-turbo or whisper-large-v3.");
  const bytes = await fs.readFile(audioPath);
  if (bytes.byteLength > 25 * 1024 * 1024) throw new Error("Prepared audio exceeds Groq's 25 MB attachment limit. Reduce media bitrate or configure a qualifying larger tier.");
  const form = new FormData();
  form.set("model", model); form.set("response_format", "verbose_json"); form.set("timestamp_granularities[]", "segment");
  form.set("file", new Blob([bytes]), path.basename(audioPath));
  const response = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", { method: "POST", headers: { Authorization: `Bearer ${key}` }, body: form });
  if (!response.ok) throw new Error(`Groq transcription failed (${response.status}). Check the API key, model access, and media size.`);
  const result = await response.json() as { text?: string; language?: string };
  if (!result.text?.trim()) throw new Error("Groq returned no usable speech. Retry with clearer audio or provide editorial context.");
  return { text: result.text.trim(), language: result.language, model };
}
