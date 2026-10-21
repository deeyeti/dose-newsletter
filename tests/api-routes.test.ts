import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { store } from "../lib/db";
import { GET as getJobs } from "../app/api/jobs/route";
import { GET as getJobDetail, PATCH as updateJobDraft, DELETE as deleteJobRoute } from "../app/api/jobs/[id]/route";
import { POST as sendJobDraft } from "../app/api/jobs/[id]/send/route";
import { POST as createSample } from "../app/api/demo/sample/route";
import { GET as getHealth } from "../app/api/health/route";

test("API: GET /api/health returns configured status", async () => {
  const res = await getHealth();
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.ok(data.configuration);
  assert.equal(typeof data.configuration.claude, "boolean");
  assert.equal(typeof data.configuration.groq, "boolean");
  assert.equal(typeof data.configuration.frameio, "boolean");
  assert.equal(typeof data.configuration.email, "boolean");
});

test("API: GET /api/jobs returns jobs list", async () => {
  const res = await getJobs();
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.ok(Array.isArray(data.jobs));
});

test("API: GET /api/jobs/[id] handles valid and invalid IDs", async () => {
  // Invalid ID -> 404
  const res404 = await getJobDetail(new NextRequest("http://localhost/api/jobs/non-existent-id"), {
    params: Promise.resolve({ id: "non-existent-id" }),
  });
  assert.equal(res404.status, 404);

  // Valid ID -> 200 with detail structure
  const { job } = store.createJob({ assetId: "api-detail-asset", filename: "detail.mp4" });
  store.setTranscript(job.id, "Sample transcript", "whisper-large-v3-turbo");
  const draft = store.saveDraft(job.id, {
    subject: "Detail Sub",
    previewText: "Detail Prev",
    headline: "Detail Head",
    body: "Detail Body",
  });

  const res200 = await getJobDetail(new NextRequest(`http://localhost/api/jobs/${job.id}`), {
    params: Promise.resolve({ id: job.id }),
  });
  assert.equal(res200.status, 200);
  const data = await res200.json();
  assert.equal(data.job.id, job.id);
  assert.equal(data.draft.subject, "Detail Sub");
  assert.ok(data.transcript);

  // Clean up
  await store.deleteJob(job.id);
});

test("API: DELETE /api/jobs/[id] deletes job and its associated data", async () => {
  const { job } = store.createJob({ assetId: "delete-route-asset", filename: "to-delete.mp4" });
  store.setTranscript(job.id, "Transcript to delete", "whisper-large-v3-turbo");
  store.saveDraft(job.id, { subject: "Sub", previewText: "Prev", headline: "Head", body: "Body" });

  const res = await deleteJobRoute(new NextRequest(`http://localhost/api/jobs/${job.id}`, { method: "DELETE" }), {
    params: Promise.resolve({ id: job.id }),
  });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.deleted, true);
  assert.equal(data.id, job.id);
  assert.equal(store.getJob(job.id), undefined);
});

test("API: PATCH /api/jobs/[id] updates draft fields and guards invalid IDs", async () => {
  // Invalid ID -> 404
  const req404 = new NextRequest("http://localhost/api/jobs/missing", {
    method: "PATCH",
    body: JSON.stringify({ headline: "New" }),
  });
  const res404 = await updateJobDraft(req404, { params: Promise.resolve({ id: "missing" }) });
  assert.equal(res404.status, 404);

  // Valid edit
  const { job } = store.createJob({ assetId: "patch-asset", filename: "patch.mp4" });
  store.saveDraft(job.id, {
    subject: "Original Subject",
    previewText: "Original Prev",
    headline: "Original Head",
    body: "Original Body",
  });

  const patchReq = new NextRequest(`http://localhost/api/jobs/${job.id}`, {
    method: "PATCH",
    body: JSON.stringify({
      subject: "Updated Subject",
      headline: "Updated Headline",
      recipientEmail: "editor@test.com",
    }),
  });
  const patchRes = await updateJobDraft(patchReq, { params: Promise.resolve({ id: job.id }) });
  assert.equal(patchRes.status, 200);
  const patchData = await patchRes.json();
  assert.equal(patchData.draft.subject, "Updated Subject");
  assert.equal(patchData.draft.headline, "Updated Headline");
  assert.equal(patchData.draft.recipientEmail, "editor@test.com");

  // Clean up
  await store.deleteJob(job.id);
});

test("API: POST /api/jobs/[id]/send guards missing confirm, bad email, and duplicates", async () => {
  const { job } = store.createJob({ assetId: "send-guard-asset", filename: "guard.mp4" });
  store.saveDraft(job.id, {
    subject: "Send Guard Subject",
    previewText: "Prev",
    headline: "Head",
    body: "Body",
    recipientEmail: "invalid-email-address",
  });

  // 1. Missing explicit confirmation -> 400
  const reqNoConfirm = new NextRequest(`http://localhost/api/jobs/${job.id}/send`, {
    method: "POST",
    body: JSON.stringify({ confirm: false }),
  });
  const resNoConfirm = await sendJobDraft(reqNoConfirm, { params: Promise.resolve({ id: job.id }) });
  assert.equal(resNoConfirm.status, 400);
  assert.match((await resNoConfirm.json()).error, /Explicit confirmation is required/);

  // 2. Invalid recipient email -> 400
  const reqBadEmail = new NextRequest(`http://localhost/api/jobs/${job.id}/send`, {
    method: "POST",
    body: JSON.stringify({ confirm: true }),
  });
  const resBadEmail = await sendJobDraft(reqBadEmail, { params: Promise.resolve({ id: job.id }) });
  assert.equal(resBadEmail.status, 400);
  assert.match((await resBadEmail.json()).error, /valid recipient email/);

  // 3. Valid send mock
  const patchReq = new NextRequest(`http://localhost/api/jobs/${job.id}`, {
    method: "PATCH",
    body: JSON.stringify({ recipientEmail: "editor@example.com" }),
  });
  await updateJobDraft(patchReq, { params: Promise.resolve({ id: job.id }) });

  // Mock global.fetch and set required email env vars for provider send
  const originalFetch = global.fetch;
  const originalKey = process.env.EMAIL_API_KEY;
  const originalFrom = process.env.EMAIL_FROM;
  const originalProvider = process.env.EMAIL_PROVIDER;

  process.env.EMAIL_PROVIDER = "resend";
  process.env.EMAIL_API_KEY = "re_mock_test_key_456";
  process.env.EMAIL_FROM = "Dose <demo@example.com>";

  global.fetch = (async () =>
    new Response(JSON.stringify({ id: "resend_api_mock_msg_456" }), { status: 200 })) as typeof fetch;

  const reqValid = new NextRequest(`http://localhost/api/jobs/${job.id}/send`, {
    method: "POST",
    body: JSON.stringify({ confirm: true }),
  });
  const resValid = await sendJobDraft(reqValid, { params: Promise.resolve({ id: job.id }) });
  assert.equal(resValid.status, 200);
  const dataValid = await resValid.json();
  assert.equal(dataValid.sent, true);
  assert.equal(dataValid.providerMessageId, "resend_api_mock_msg_456");

  // 4. Second send -> 409 already sent
  const reqSecond = new NextRequest(`http://localhost/api/jobs/${job.id}/send`, {
    method: "POST",
    body: JSON.stringify({ confirm: true }),
  });
  const resSecond = await sendJobDraft(reqSecond, { params: Promise.resolve({ id: job.id }) });
  assert.equal(resSecond.status, 409);
  assert.match((await resSecond.json()).error, /already sent/);

  global.fetch = originalFetch;
  if (originalKey !== undefined) process.env.EMAIL_API_KEY = originalKey;
  else delete process.env.EMAIL_API_KEY;
  if (originalFrom !== undefined) process.env.EMAIL_FROM = originalFrom;
  else delete process.env.EMAIL_FROM;
  if (originalProvider !== undefined) process.env.EMAIL_PROVIDER = originalProvider;
  else delete process.env.EMAIL_PROVIDER;

  // Clean up
  await store.deleteJob(job.id);
});


test("API: POST /api/demo/sample creates pre-filled sample job", async () => {
  const res = await createSample();
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.ok(data.job);
  assert.equal(data.job.isSample, true);
  assert.equal(data.job.status, "ready_for_review");

  await store.deleteJob(data.job.id);
});
