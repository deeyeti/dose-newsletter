import { geminiKey, env } from "@/lib/env";

export const EMBEDDING_DIMENSION = 1536;

/**
 * Generate a dense vector embedding using Gemini's embedding model.
 * Defaults to 1536 dimensions to match pgvector schema.
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  const key = geminiKey();
  if (!key) throw new Error("Gemini API key is not configured. Set GEMINI_API_KEY.");

  const model = env("GEMINI_EMBEDDING_MODEL") || "models/gemini-embedding-001";
  const url = `https://generativelanguage.googleapis.com/v1beta/${model.startsWith("models/") ? model : "models/" + model}:embedContent?key=${encodeURIComponent(key)}`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: model.startsWith("models/") ? model : `models/${model}`,
      content: { parts: [{ text }] },
      outputDimensionality: EMBEDDING_DIMENSION,
    }),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => "");
    throw new Error(`Gemini embedding failed (${response.status}): ${errText}`);
  }

  const data = (await response.json()) as { embedding?: { values?: number[] } };
  const values = data.embedding?.values;
  if (!values || !Array.isArray(values)) {
    throw new Error("Gemini returned invalid embedding values.");
  }

  return values;
}

/**
 * Breaks down an interview transcript into distinct conversational beats / quote chunks
 * for semantic indexing.
 */
export function chunkTranscript(
  transcript: string,
  targetWordsPerChunk = 75
): Array<{ chunkText: string; speakerTimestamp?: string }> {
  const clean = transcript.trim();
  if (!clean) return [];

  // If transcript already has timestamps (e.g. [00:14] or 00:14 - 00:28), extract them
  const sentences = clean.match(/[^.!?]+[.!?]+(\s|$)|[^.!?]+$/g) || [clean];
  const chunks: Array<{ chunkText: string; speakerTimestamp?: string }> = [];

  let currentWords: string[] = [];
  let chunkIndex = 0;

  for (const sentence of sentences) {
    const words = sentence.trim().split(/\s+/).filter(Boolean);
    currentWords.push(...words);

    if (currentWords.length >= targetWordsPerChunk) {
      const startMin = Math.floor((chunkIndex * 20) / 60);
      const startSec = (chunkIndex * 20) % 60;
      const endMin = Math.floor(((chunkIndex + 1) * 20) / 60);
      const endSec = ((chunkIndex + 1) * 20) % 60;
      const ts = `${String(startMin).padStart(2, "0")}:${String(startSec).padStart(2, "0")} - ${String(endMin).padStart(2, "0")}:${String(endSec).padStart(2, "0")}`;

      chunks.push({
        chunkText: currentWords.join(" "),
        speakerTimestamp: ts,
      });
      currentWords = [];
      chunkIndex++;
    }
  }

  if (currentWords.length > 0) {
    const startMin = Math.floor((chunkIndex * 20) / 60);
    const startSec = (chunkIndex * 20) % 60;
    const endMin = Math.floor(((chunkIndex + 1) * 20) / 60);
    const endSec = ((chunkIndex + 1) * 20) % 60;
    const ts = `${String(startMin).padStart(2, "0")}:${String(startSec).padStart(2, "0")} - ${String(endMin).padStart(2, "0")}:${String(endSec).padStart(2, "0")}`;

    chunks.push({
      chunkText: currentWords.join(" "),
      speakerTimestamp: ts,
    });
  }

  return chunks;
}

/**
 * Calculates cosine similarity between two numeric vectors.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}
