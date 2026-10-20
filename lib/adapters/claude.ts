import { anthropicKey, geminiKey, env } from "@/lib/env";
import type { DraftInput } from "@/lib/types";

export const EDITORIAL_SYSTEM_PROMPT = `You are Dose of Society's senior newsletter editor. Turn raw, authentic, street-level human interview transcripts into captivating, deeply moving, and beautifully written newsletter stories that feel like an acclaimed publication (e.g. Substack or The New Yorker human interest column).

Editorial Guidelines:
1. Grounding: Every single fact, character, emotion, and setting MUST come strictly from the transcript. Do NOT hallucinate names, backstories, moral lessons, or direct quotes.
2. Tone: Warm, empathetic, literary, and intimate. Avoid generic corporate or clinical fluff. Make the reader feel like they are sitting across from the speaker.
3. Direct Quotes: When quoting the speaker, the quote MUST be exact and verbatim from the transcript.
4. Structure:
   - subject: An irresistible, authentic subject line (under 60 characters).
   - previewText: A compelling 1-line hook for inbox previews (under 100 characters).
   - headline: A poetic, powerful headline that captures the emotional core of the piece.
   - body: A 3 to 4 paragraph narrative story. Use double line breaks (\\n\\n) between paragraphs. Each paragraph should be substantial, moving, and well-paced.
   - closing: A warm, authentic sign-off (e.g. "Warmly,\\nThe Dose of Society Team").

Return a single valid JSON object with keys:
{
  "subject": "...",
  "previewText": "...",
  "headline": "...",
  "body": "...",
  "closing": "..."
}

If the transcript lacks enough substance or coherence to construct a grounded human story, return {"error": "<reason>"}.`;

function parseDraft(text: string): DraftInput {
  const clean = text.trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
  const value = JSON.parse(clean) as Record<string, unknown>;
  if (typeof value.error === "string") throw new Error(`Editorial review needed: ${value.error}`);
  for (const key of ["subject", "previewText", "headline", "body"] as const) {
    if (typeof value[key] !== "string" || !value[key].trim()) {
      throw new Error("AI returned an incomplete newsletter draft. Check model configuration and retry.");
    }
  }
  return {
    subject: String(value.subject).trim(),
    previewText: String(value.previewText).trim(),
    headline: String(value.headline).trim(),
    body: String(value.body).trim(),
    closing: typeof value.closing === "string" ? value.closing.trim() : undefined
  };
}

export async function generateWithGemini(prompt: string, systemPrompt: string = EDITORIAL_SYSTEM_PROMPT): Promise<string> {
  const gKey = geminiKey();
  if (!gKey) throw new Error("Gemini is not configured. Set GEMINI_API_KEY.");
  const model = env("GEMINI_MODEL") || "gemini-2.5-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(gKey)}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { response_mime_type: "application/json", temperature: 0.2 }
    })
  });
  if (!response.ok) {
    const err = await response.text().catch(() => "");
    throw new Error(`Gemini request failed (${response.status}): ${err}`);
  }
  const payload = await response.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
  const text = payload.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Gemini returned empty response.");
  return text;
}

export async function generateWithClaude(prompt: string, systemPrompt: string = EDITORIAL_SYSTEM_PROMPT): Promise<string> {
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
  const request = { model, max_tokens: 1600, temperature: 0.2, system: systemPrompt, messages: [{ role: "user", content: prompt }] };
  let lastError: Error | undefined;
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: reqHeaders, body: JSON.stringify(request) });
    if (!response.ok) {
      const errBody = await response.text().catch(() => "");
      throw new Error(`Claude request failed (${response.status}): ${errBody || "Verify CLAUDE_MODEL is available to this account."}`);
    }
    const payload = await response.json() as { content?: Array<{ type: string; text?: string }> };
    const text = payload.content?.find((part) => part.type === "text")?.text;
    if (text) return text;
  }
  throw lastError || new Error("Claude did not return text content.");
}

export async function writeNewsletter(transcript: string): Promise<DraftInput> {
  if (process.env.claude_api_key && !process.env.CLAUDE_MODEL) {
    throw new Error("CLAUDE_MODEL is required. Set a model ID available to this Anthropic account, then retry.");
  }
  const gKey = geminiKey();
  const cKey = anthropicKey();
  const prompt = `Transcript:\n---\n${transcript}\n---\nReturn JSON only.`;

  // If Gemini is configured and we don't have a workspace-scoped Claude key, prefer Gemini
  if (gKey && (!cKey || !env("ANTHROPIC_WORKSPACE_ID"))) {
    try {
      const text = await generateWithGemini(prompt, EDITORIAL_SYSTEM_PROMPT);
      return parseDraft(text);
    } catch (error) {
      if (!cKey) throw error;
    }
  }

  // Attempt Claude, falling back to Gemini if Claude fails
  try {
    const text = await generateWithClaude(prompt, EDITORIAL_SYSTEM_PROMPT);
    return parseDraft(text);
  } catch (error) {
    if (gKey) {
      const text = await generateWithGemini(prompt, EDITORIAL_SYSTEM_PROMPT);
      return parseDraft(text);
    }
    throw error;
  }
}

// AI Co-Editor Actions (Feature A)
export async function generateHeadlineAngles(transcript: string, currentSubject: string, currentHeadline: string) {
  const prompt = `Given this transcript and current headline ("${currentHeadline}") and subject ("${currentSubject}"), generate 3 distinct alternative headline + subject line combinations with different angles:
1. "emotional": Heartfelt and deeply personal
2. "curiosity": Intriguing and thought-provoking hook
3. "quote": Grounded in an exact memorable quote from the transcript

Transcript:\n---\n${transcript}\n---

Return a JSON array of objects with keys: angle, subject, headline.`;

  const runPrompt = geminiKey() ? (p: string) => generateWithGemini(p, "You are a master newsletter headline copywriter. Return JSON only.") : (p: string) => generateWithClaude(p, "You are a master newsletter headline copywriter. Return JSON only.");
  const text = await runPrompt(prompt);
  const clean = text.trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
  return JSON.parse(clean) as Array<{ angle: string; subject: string; headline: string }>;
}

export async function adjustTone(transcript: string, currentDraft: DraftInput, tone: "warmer" | "punchier" | "more_reflective") {
  const prompt = `Rewrite the following newsletter draft in a "${tone}" editorial tone.
Maintain 100% factual grounding against the transcript. Keep verbatim quotes unchanged.

Current Draft:
Subject: ${currentDraft.subject}
Headline: ${currentDraft.headline}
Body:
${currentDraft.body}

Transcript:
---
${transcript}
---

Return JSON only with: subject, previewText, headline, body, closing.`;

  const runPrompt = geminiKey() ? (p: string) => generateWithGemini(p, EDITORIAL_SYSTEM_PROMPT) : (p: string) => generateWithClaude(p, EDITORIAL_SYSTEM_PROMPT);
  const text = await runPrompt(prompt);
  return parseDraft(text);
}

export async function factCheckDraft(transcript: string, currentDraft: DraftInput) {
  const prompt = `Review this newsletter draft against the interview transcript. Verify if each narrative claim and quote is grounded in the transcript.

Newsletter Body:
${currentDraft.body}

Transcript:
---
${transcript}
---

Return a JSON object with:
- score: percentage 0-100 indicating factual grounding
- allGrounded: boolean
- items: array of objects { claim: string, grounded: boolean, transcriptQuote: string | null, note: string }`;

  const runPrompt = geminiKey() ? (p: string) => generateWithGemini(p, "You are a meticulous fact-checker. Return JSON only.") : (p: string) => generateWithClaude(p, "You are a meticulous fact-checker. Return JSON only.");
  const text = await runPrompt(prompt);
  const clean = text.trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
  return JSON.parse(clean);
}
