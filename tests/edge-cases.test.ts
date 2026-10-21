import assert from "node:assert/strict";
import test from "node:test";
import { createHmac } from "node:crypto";
import { store } from "../lib/db";
import { rejectLongVideo } from "../lib/guards";
import { verifyFrameioSignature } from "../lib/adapters/frameio";
import { renderNewsletterHtml, deliverEmail } from "../lib/adapters/email";
import { writeNewsletter } from "../lib/adapters/claude";

// ─────────────────────────────────────────────────────────────────────────────
// 1. Webhook Signature & Security Edge Cases
// ─────────────────────────────────────────────────────────────────────────────

test("webhook signature verification edge cases", () => {
  const secret = "test-webhook-secret-1234567890abcdef";
  process.env.FRAMEIO_WEBHOOK_SECRET = secret;

  const body = JSON.stringify({ type: "file.ready", resource: { id: "asset-123" } });
  const now = Math.floor(Date.now() / 1000);

  const makeSig = (ts: number, payload: string, sec = secret) =>
    `v0=${createHmac("sha256", sec).update(`v0:${ts}:${payload}`, "latin1").digest("hex")}`;

  // 1. Valid signature and current timestamp
  assert.equal(verifyFrameioSignature(body, String(now), makeSig(now, body)), true);

  // 2. Expired timestamp (> 300 seconds ago)
  const expiredTs = now - 301;
  assert.equal(verifyFrameioSignature(body, String(expiredTs), makeSig(expiredTs, body)), false);

  // 3. Future timestamp (> 300 seconds into future)
  const futureTs = now + 301;
  assert.equal(verifyFrameioSignature(body, String(futureTs), makeSig(futureTs, body)), false);

  // 4. Timestamp within 300s window (e.g. 60s ago) is valid
  const recentTs = now - 60;
  assert.equal(verifyFrameioSignature(body, String(recentTs), makeSig(recentTs, body)), true);

  // 5. Tampered payload
  assert.equal(verifyFrameioSignature("tampered-body", String(now), makeSig(now, body)), false);

  // 6. Wrong secret
  assert.equal(verifyFrameioSignature(body, String(now), makeSig(now, body, "wrong-secret")), false);

  // 7. Non-numeric timestamp
  assert.equal(verifyFrameioSignature(body, "not-a-number", makeSig(now, body)), false);
  assert.equal(verifyFrameioSignature(body, "", makeSig(now, body)), false);
  assert.equal(verifyFrameioSignature(body, null, makeSig(now, body)), false);

  // 8. Missing or malformed signature header
  assert.equal(verifyFrameioSignature(body, String(now), null), false);
  assert.equal(verifyFrameioSignature(body, String(now), "invalid-no-v0-prefix"), false);
  assert.equal(verifyFrameioSignature(body, String(now), "v0=short"), false);

  // 9. Missing FRAMEIO_WEBHOOK_SECRET
  delete process.env.FRAMEIO_WEBHOOK_SECRET;
  assert.equal(verifyFrameioSignature(body, String(now), makeSig(now, body)), false);
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Video Duration Guard Edge Cases
// ─────────────────────────────────────────────────────────────────────────────

test("video duration guard rejects invalid and boundary inputs", () => {
  // Boundary cases around 90 seconds
  assert.doesNotThrow(() => rejectLongVideo(90.0));
  assert.doesNotThrow(() => rejectLongVideo(89.999));
  assert.doesNotThrow(() => rejectLongVideo(1));

  assert.throws(() => rejectLongVideo(90.0001), /up to 90 seconds/);
  assert.throws(() => rejectLongVideo(91), /up to 90 seconds/);
  assert.throws(() => rejectLongVideo(3600), /up to 90 seconds/);

  // Non-positive and non-finite numbers
  assert.throws(() => rejectLongVideo(0), /Could not determine video duration/);
  assert.throws(() => rejectLongVideo(-1), /Could not determine video duration/);
  assert.throws(() => rejectLongVideo(NaN), /Could not determine video duration/);
  assert.throws(() => rejectLongVideo(Infinity), /Could not determine video duration/);
  assert.throws(() => rejectLongVideo(-Infinity), /Could not determine video duration/);
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Store Deletion, Cascades, and Listing Edge Cases
// ─────────────────────────────────────────────────────────────────────────────

test("store deleteJob cleanly cascades and cleans up all related records", () => {
  const { job } = store.createJob({ assetId: "cascade-asset-1", filename: "cascade.mp4" });
  store.setTranscript(job.id, "Transcript for cascade test", "whisper-large-v3-turbo");
  const draft = store.saveDraft(job.id, {
    subject: "Cascade Subject",
    previewText: "Preview",
    headline: "Headline",
    body: "Body",
    recipientEmail: "test@example.com",
  });
  store.event(job.id, "test_event", "Event logged");
  store.beginSend(draft.id);

  // Verify records exist
  assert.ok(store.getJob(job.id));
  assert.ok(store.getDraft(job.id));
  assert.ok(store.jobDetail(job.id)?.transcript);
  assert.ok((store.jobDetail(job.id)?.events.length ?? 0) > 0);

  // Execute deleteJob
  store.deleteJob(job.id);

  // Verify all records were removed
  assert.equal(store.getJob(job.id), undefined);
  assert.equal(store.getDraft(job.id), undefined);
  assert.equal(store.jobDetail(job.id), null);
  assert.equal(store.listJobs().some((j) => j.id === job.id), false);

  // Calling deleteJob on non-existent ID does not throw
  assert.doesNotThrow(() => store.deleteJob("non-existent-id"));
});

test("store listJobs attaches draft metadata when draft exists", () => {
  const { job } = store.createJob({ assetId: "metadata-asset", filename: "metadata.mp4" });
  store.saveDraft(job.id, {
    subject: "Special Subject Line",
    previewText: "Special Preview",
    headline: "Special Headline",
    body: "Special Body",
    recipientEmail: "reader@example.com",
  });

  const jobs = store.listJobs();
  const found = jobs.find((j) => j.id === job.id);
  assert.ok(found);
  assert.equal(found.draftSubject, "Special Subject Line");
  assert.equal(found.recipientEmail, "reader@example.com");

  // Clean up
  store.deleteJob(job.id);
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. HTML Rendering & XSS Security Edge Cases
// ─────────────────────────────────────────────────────────────────────────────

test("renderNewsletterHtml escapes malicious input and handles formatting", () => {
  const maliciousDraft = {
    subject: "Alert <script>alert('xss')</script> & Co",
    previewText: 'Click here "quotes" & <img src=x onerror=alert(1)>',
    headline: "Breaking <b>Story</b> & Secrets",
    body: "Paragraph one with <script>evil()</script>.\n\nParagraph two with & special \"characters\".",
    closing: "Warmly,\n<a href='javascript:evil()'>Editor</a>",
  };

  const html = renderNewsletterHtml(maliciousDraft);

  // Verify tags are escaped
  assert.ok(!html.includes("<script>alert('xss')</script>"));
  assert.ok(html.includes("&lt;script&gt;alert('xss')&lt;/script&gt;"));
  assert.ok(!html.includes("<img src=x onerror=alert(1)>"));
  assert.ok(html.includes("&lt;img src=x onerror=alert(1)&gt;"));
  assert.ok(!html.includes("<a href='javascript:evil()'>"));
  assert.ok(html.includes("&lt;a href='javascript:evil()'&gt;Editor&lt;/a&gt;"));

  // Verify paragraph split
  assert.ok(html.includes("<p style="));
  assert.ok(html.includes("Paragraph one with &lt;script&gt;evil()&lt;/script&gt;."));
  assert.ok(html.includes("Paragraph two with &amp; special &quot;characters&quot;."));
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. Email Delivery Edge Cases
// ─────────────────────────────────────────────────────────────────────────────

test("deliverEmail validates recipient and handles provider errors", async () => {
  const draft = {
    id: "draft-test-id",
    jobId: "job-test-id",
    subject: "Sub",
    previewText: "Prev",
    headline: "Head",
    body: "Body",
    status: "draft" as const,
    updatedAt: new Date().toISOString(),
  };

  process.env.EMAIL_PROVIDER = "resend";
  process.env.EMAIL_API_KEY = "re_test_key";
  process.env.EMAIL_FROM = "onboarding@resend.dev";

  // Mock fetch for email provider interactions
  const original = global.fetch;
  global.fetch = (async (url, init) => {
    const payload = JSON.parse(String((init as any)?.body || "{}"));
    if (payload.to?.[0]?.includes("unverified")) {
      return new Response(JSON.stringify({ message: "Domain not verified in Resend" }), { status: 422 });
    }
    return new Response(JSON.stringify({ id: "msg_test_provider_id_999" }), { status: 200 });
  }) as typeof fetch;

  // 1. Missing recipientEmail throws
  await assert.rejects(
    () => deliverEmail(draft as any, "key-1"),
    /A recipient email is required/
  );

  await assert.rejects(
    () => deliverEmail({ ...draft, recipientEmail: "" }, "key-1b"),
    /A recipient email is required/
  );

  // 2. Unsupported provider throws
  process.env.EMAIL_PROVIDER = "sendgrid";
  await assert.rejects(
    () => deliverEmail({ ...draft, recipientEmail: "user@verified.com" }, "key-2"),
    /Only the Resend demo adapter is implemented/
  );
  process.env.EMAIL_PROVIDER = "resend";

  // 3. Provider 422 error
  await assert.rejects(
    () => deliverEmail({ ...draft, recipientEmail: "user@unverified.com" }, "key-3"),
    /Resend did not accept the email \(422\)/
  );

  // 4. Provider 200 success returns message ID
  const providerId = await deliverEmail({ ...draft, recipientEmail: "user@verified.com" }, "key-4");
  assert.equal(providerId, "msg_test_provider_id_999");

  global.fetch = original;
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. Claude Output Parser Edge Cases
// ─────────────────────────────────────────────────────────────────────────────

test("writeNewsletter handles markdown fenced JSON, missing fields, and error states", async () => {
  process.env.claude_api_key = "test-key";
  process.env.CLAUDE_MODEL = "claude-opus-5-5";

  const original = global.fetch;

  // 1. Markdown-fenced JSON with extra whitespace
  global.fetch = (async () =>
    new Response(
      JSON.stringify({
        content: [
          {
            type: "text",
            text: `\`\`\`json
{
  "subject": "Fenced Subject",
  "previewText": "Fenced Preview",
  "headline": "Fenced Headline",
  "body": "Paragraph 1\\n\\nParagraph 2",
  "closing": "Warmly,\\nDose Team"
}
\`\`\``,
          },
        ],
      }),
      { status: 200 }
    )) as typeof fetch;

  const draft = await writeNewsletter("Any valid transcript");
  assert.equal(draft.subject, "Fenced Subject");
  assert.equal(draft.headline, "Fenced Headline");
  assert.equal(draft.closing, "Warmly,\nDose Team");

  // 2. AI returns explicit editorial review error
  global.fetch = (async () =>
    new Response(
      JSON.stringify({
        content: [
          {
            type: "text",
            text: JSON.stringify({ error: "Transcript is purely background music with no speech" }),
          },
        ],
      }),
      { status: 200 }
    )) as typeof fetch;

  await assert.rejects(
    () => writeNewsletter("Music only"),
    /Editorial review needed: Transcript is purely background music/
  );

  // 3. AI returns incomplete draft (missing headline)
  global.fetch = (async () =>
    new Response(
      JSON.stringify({
        content: [
          {
            type: "text",
            text: JSON.stringify({ subject: "Sub", previewText: "Prev", headline: "", body: "Body" }),
          },
        ],
      }),
      { status: 200 }
    )) as typeof fetch;

  await assert.rejects(
    () => writeNewsletter("Valid transcript"),
    /AI returned an incomplete newsletter draft/
  );

  // 4. AI returns malformed non-JSON
  global.fetch = (async () =>
    new Response(
      JSON.stringify({
        content: [
          {
            type: "text",
            text: "Sorry, I cannot generate a newsletter for this video.",
          },
        ],
      }),
      { status: 200 }
    )) as typeof fetch;

  await assert.rejects(() => writeNewsletter("Valid transcript"), SyntaxError);

  global.fetch = original;
  delete process.env.claude_api_key;
  delete process.env.CLAUDE_MODEL;
});
