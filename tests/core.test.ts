import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";

process.env.DATABASE_PATH = ".data/test-dose-engine.db";
const testDb = path.resolve(process.cwd(), process.env.DATABASE_PATH);
fs.rmSync(testDb, { force: true });

const { store } = require("../lib/db");
const { rejectLongVideo } = require("../lib/guards");
const { transcribeWithGroq } = require("../lib/adapters/groq");
const { writeNewsletter } = require("../lib/adapters/claude");
const { deliverEmail } = require("../lib/adapters/email");

test("happy-path records a draft without sending", () => {
  const { job, created } = store.createJob({ assetId: "happy-asset", filename: "interview.mp4" });
  assert.equal(created, true);
  store.setTranscript(job.id, "A grounded conversation with enough detail to edit.", "whisper-large-v3-turbo", "en");
  const draft = store.saveDraft(job.id, { subject: "A true story", previewText: "A preview", headline: "A headline", body: "A careful body." });
  store.setJob(job.id, "ready_for_review");
  assert.equal(store.jobDetail(job.id)?.draft?.id, draft.id);
  assert.equal(store.getJob(job.id)?.status, "ready_for_review");
});

test("duplicate asset and webhook event are idempotent", () => {
  const first = store.createJob({ assetId: "duplicate-asset", filename: "same.mp4" });
  const second = store.createJob({ assetId: "duplicate-asset", filename: "same.mp4" });
  assert.equal(first.created, true); assert.equal(second.created, false); assert.equal(first.job.id, second.job.id);
  assert.equal(store.recordWebhook("event-duplicate", "duplicate-asset", "file.ready", true), true);
  assert.equal(store.recordWebhook("event-duplicate", "duplicate-asset", "file.ready", true), false);
});

test("a video longer than 90 seconds is rejected", () => { assert.throws(() => rejectLongVideo(90.01), /up to 90 seconds/); assert.doesNotThrow(() => rejectLongVideo(90)); });

test("Groq failures are actionable", async () => {
  process.env.GROQ_API_KEY = "bad-key";
  const original = global.fetch; global.fetch = (async () => new Response("bad", { status: 401 })) as typeof fetch;
  await assert.rejects(() => transcribeWithGroq(__filename), /Groq transcription failed/); global.fetch = original; delete process.env.GROQ_API_KEY;
});

test("missing Claude model fails before an invalid draft can be persisted", async () => {
  process.env.claude_api_key = "key"; delete process.env.CLAUDE_MODEL;
  await assert.rejects(() => writeNewsletter("Valid transcript"), /CLAUDE_MODEL is required/); delete process.env.claude_api_key;
});

test("email failure remains retryable and repeated send is locked", async () => {
  const { job } = store.createJob({ assetId: "send-asset", filename: "send.mp4" });
  const draft = store.saveDraft(job.id, { subject: "Subject", previewText: "Preview", headline: "Headline", body: "Body", recipientEmail: "test@example.com" });
  const first = store.beginSend(draft.id); assert.equal(first.allowed, true);
  assert.equal(store.beginSend(draft.id).allowed, false);
  store.failSend(draft.id, "Provider unavailable");
  assert.equal(store.beginSend(draft.id).allowed, true);
  process.env.EMAIL_PROVIDER = "resend"; process.env.EMAIL_API_KEY = "bad"; process.env.EMAIL_FROM = "Dose <demo@example.com>";
  const original = global.fetch; global.fetch = (async () => new Response("bad", { status: 401 })) as typeof fetch;
  await assert.rejects(() => deliverEmail({ ...draft, recipientEmail: "test@example.com" }, "key"), /Resend did not accept/); global.fetch = original;
  delete process.env.EMAIL_API_KEY; delete process.env.EMAIL_FROM;
});
