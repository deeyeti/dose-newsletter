/**
 * Utility functions for transcript chunking, text analysis, and semantic similarity.
 */

export const EMBEDDING_DIMENSION = 1536;

const STOP_WORDS = new Set([
  "the", "and", "for", "that", "this", "with", "from", "have", "what", "about",
  "they", "will", "would", "there", "their", "which", "when", "some", "into",
  "also", "than", "then", "been", "were", "where", "them", "more", "very"
]);

/**
 * Computes a normalized relevance score (0 to 1) for a text chunk against a thematic search query.
 */
export function scoreTextRelevance(query: string, text: string, themes: string[] = []): number {
  if (!query || !text) return 0;
  const queryTerms = query
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));

  if (queryTerms.length === 0) return 0;

  const lowerText = text.toLowerCase();
  const lowerThemes = themes.map((t) => t.toLowerCase());

  let termMatches = 0;
  for (const term of queryTerms) {
    if (lowerText.includes(term)) {
      termMatches += 1;
    }
    if (lowerThemes.some((t) => t.includes(term) || term.includes(t))) {
      termMatches += 1.5;
    }
  }

  const score = Math.min(1, termMatches / Math.max(queryTerms.length, 1));
  return Math.round(score * 100) / 100;
}

/**
 * Breaks down an interview transcript into distinct conversational beats / quote chunks
 * for indexing and quick retrieval.
 */
export function chunkTranscript(
  transcript: string,
  targetWordsPerChunk = 75
): Array<{ chunkText: string; speakerTimestamp?: string }> {
  const clean = transcript.trim();
  if (!clean) return [];

  // Split into sentences
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
