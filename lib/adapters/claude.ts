import { anthropicKey, env } from "@/lib/env";
import type { DraftInput } from "@/lib/types";

const instructions = `You are Dose of Society's careful newsletter editor. Use only facts from the transcript. Return one JSON object with string fields subject, previewText, headline, body, and optional closing. Write a concise, warm human-interest story. Do not invent people, events, biographical details, moral lessons, or direct quotes. A direct quote must appear verbatim in the transcript. If the transcript is too thin or unclear to safely write a story, return {"error":"..."}.`;

function parseDraft(text: string): DraftInput {
  const clean = text.trim().replace(/^```json\s*|\s*```$/g, "");
  const value = JSON.parse(clean) as Record<string, unknown>;
  if (typeof value.error === "string") throw new Error(`Editorial review needed: ${value.error}`);
  for (const key of ["subject", "previewText", "headline", "body"] as const) if (typeof value[key] !== "string" || !value[key].trim()) throw new Error("Claude returned an incomplete newsletter draft. Check CLAUDE_MODEL and retry.");
  const subject = value.subject as string, previewText = value.previewText as string, headline = value.headline as string, body = value.body as string;
  return { subject: subject.trim(), previewText: previewText.trim(), headline: headline.trim(), body: body.trim(), closing: typeof value.closing === "string" ? value.closing.trim() : undefined };
}

export async function writeNewsletter(transcript: string): Promise<DraftInput> {
  const key = anthropicKey(), model = env("CLAUDE_MODEL");
  if (!key) throw new Error("Claude is not configured. Set ANTHROPIC_API_KEY (or local.env claude_api_key).");
  if (!model) throw new Error("CLAUDE_MODEL is required. Set a model ID available to this Anthropic account, then retry.");
  const workspaceId = env("ANTHROPIC_WORKSPACE_ID") || env("anthropic_workspace_id");
  const reqHeaders: Record<string, string> = {
    "x-api-key": key,
    "anthropic-version": "2023-06-01",
    "content-type": "application/json"
  };
  if (workspaceId) {
    reqHeaders["anthropic-workspace-id"] = workspaceId;
  }
  const request = { model, max_tokens: 1100, temperature: 0.2, system: instructions, messages: [{ role: "user", content: `Transcript:\n---\n${transcript}\n---\nReturn JSON only.` }] };
  let lastError: Error | undefined;
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: reqHeaders, body: JSON.stringify(request) });
    if (!response.ok) {
      const errBody = await response.text().catch(() => "");
      throw new Error(`Claude request failed (${response.status}): ${errBody || "Verify CLAUDE_MODEL is available to this account."}`);
    }
    const payload = await response.json() as { content?: Array<{ type: string; text?: string }> };
    try { return parseDraft(payload.content?.find((part) => part.type === "text")?.text || ""); } catch (error) { lastError = error as Error; }
  }
  throw lastError || new Error("Claude did not return valid newsletter JSON.");
}
