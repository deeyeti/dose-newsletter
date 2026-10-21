import test from "node:test";
import assert from "node:assert/strict";
import { ASSISTANT_TOOLS, executeTool } from "../lib/assistant/tools";
import { chunkTranscript, cosineSimilarity } from "../lib/assistant/embeddings";

test("assistant tools definition schema is valid", () => {
  assert.equal(ASSISTANT_TOOLS.length >= 3, true);
  const toolNames = ASSISTANT_TOOLS.map((t) => t.name);
  assert.equal(toolNames.includes("query_archive_by_metric"), true);
  assert.equal(toolNames.includes("semantic_search_quotes"), true);
  assert.equal(toolNames.includes("send_to_newsletter_draft"), true);

  for (const tool of ASSISTANT_TOOLS) {
    assert.equal(typeof tool.name, "string");
    assert.equal(typeof tool.description, "string");
    assert.equal(tool.parameters.type, "object");
  }
});

test("transcript chunking creates conversational beats with timestamps", () => {
  const sampleTranscript =
    "I grew up watching my grandmother repair clothes at the kitchen table. " +
    "She never called it sustainability. She just said, if something still has life in it, why throw it away? " +
    "Years later, I began mending my friends' jackets after work. People would tell me about the places those clothes had been. " +
    "That is when I understood I was not only fixing fabric; I was helping people hold on to a memory.";

  const chunks = chunkTranscript(sampleTranscript, 25);
  assert.equal(chunks.length >= 1, true);
  for (const chunk of chunks) {
    assert.equal(typeof chunk.chunkText, "string");
    assert.equal(chunk.chunkText.length > 0, true);
    assert.equal(typeof chunk.speakerTimestamp, "string");
  }
});

test("cosine similarity produces normalized scores", () => {
  const vecA = [1, 0, 0];
  const vecB = [1, 0, 0];
  const vecC = [0, 1, 0];
  const vecD = [-1, 0, 0];

  assert.equal(Math.round(cosineSimilarity(vecA, vecB) * 100) / 100, 1);
  assert.equal(cosineSimilarity(vecA, vecC), 0);
  assert.equal(Math.round(cosineSimilarity(vecA, vecD) * 100) / 100, -1);
});

test("send_to_newsletter_draft requires reel_id", async () => {
  const res = (await executeTool("send_to_newsletter_draft", {})) as { error?: string };
  assert.equal(res.error, "reel_id is required");
});
