import test from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { store } from "@/lib/db";
import { createBeehiivPost, getBeehiivCredentials } from "@/lib/adapters/beehiiv";
import { deliverEmail } from "@/lib/adapters/email";
import { POST as beehiivRoute } from "@/app/api/jobs/[id]/beehiiv/route";

test("Beehiiv: credentials extraction and error handling", async () => {
  const originalKey = process.env.BEEHIIV_API_KEY;
  const originalPub = process.env.BEEHIIV_PUBLICATION_ID;

  try {
    process.env.BEEHIIV_API_KEY = "test_key_abc123";
    process.env.BEEHIIV_PUBLICATION_ID = "pub_test_xyz789";

    const creds = await getBeehiivCredentials();
    assert.equal(creds.apiKey, "test_key_abc123");
    assert.equal(creds.publicationId, "pub_test_xyz789");
  } finally {
    if (originalKey !== undefined) process.env.BEEHIIV_API_KEY = originalKey;
    else delete process.env.BEEHIIV_API_KEY;
    if (originalPub !== undefined) process.env.BEEHIIV_PUBLICATION_ID = originalPub;
    else delete process.env.BEEHIIV_PUBLICATION_ID;
  }
});

test("Beehiiv: createBeehiivPost formats request and returns post details", async () => {
  const originalFetch = global.fetch;
  const originalKey = process.env.BEEHIIV_API_KEY;
  const originalPub = process.env.BEEHIIV_PUBLICATION_ID;

  process.env.BEEHIIV_API_KEY = "mock_beehiiv_key";
  process.env.BEEHIIV_PUBLICATION_ID = "pub_mock_123";

  let capturedUrl = "";
  let capturedBody: Record<string, unknown> = {};
  let capturedAuth = "";

  global.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    capturedUrl = String(url);
    capturedAuth = (init?.headers as Record<string, string>)?.Authorization || "";
    capturedBody = JSON.parse(String(init?.body || "{}"));
    return new Response(
      JSON.stringify({
        data: {
          id: "post_beehiiv_mock_999",
          preview_url: "https://app.beehiiv.com/posts/post_beehiiv_mock_999/preview",
          web_url: "https://oms-newsletter.beehiiv.com/p/mock-slug",
        },
      }),
      { status: 201 }
    );
  }) as typeof fetch;

  try {
    const post = await createBeehiivPost({
      subject: "Subject Line Here",
      previewText: "Preview Dek Here",
      headline: "Headline Here",
      body: "First paragraph.\n\nSecond paragraph.",
      closing: "Stay thoughtful.",
    });

    assert.equal(post.id, "post_beehiiv_mock_999");
    assert.equal(post.previewUrl, "https://app.beehiiv.com/posts/post_beehiiv_mock_999/preview");
    assert.equal(capturedUrl, "https://api.beehiiv.com/v2/publications/pub_mock_123/posts");
    assert.equal(capturedAuth, "Bearer mock_beehiiv_key");
    assert.equal(capturedBody.title, "Headline Here");
    assert.equal(capturedBody.subtitle, "Preview Dek Here");
    assert.equal(capturedBody.status, "draft");
    assert.ok(typeof capturedBody.body_content === "string");
    assert.ok((capturedBody.body_content as string).includes("First paragraph"));
  } finally {
    global.fetch = originalFetch;
    if (originalKey !== undefined) process.env.BEEHIIV_API_KEY = originalKey;
    else delete process.env.BEEHIIV_API_KEY;
    if (originalPub !== undefined) process.env.BEEHIIV_PUBLICATION_ID = originalPub;
    else delete process.env.BEEHIIV_PUBLICATION_ID;
  }
});

test("Beehiiv: deliverEmail works with EMAIL_PROVIDER=beehiiv", async () => {
  const originalFetch = global.fetch;
  const originalKey = process.env.BEEHIIV_API_KEY;
  const originalPub = process.env.BEEHIIV_PUBLICATION_ID;
  const originalProvider = process.env.EMAIL_PROVIDER;

  process.env.EMAIL_PROVIDER = "beehiiv";
  process.env.BEEHIIV_API_KEY = "mock_beehiiv_key";
  process.env.BEEHIIV_PUBLICATION_ID = "pub_mock_123";

  global.fetch = (async () => {
    return new Response(
      JSON.stringify({
        data: {
          id: "post_delivered_beehiiv_123",
          preview_url: "https://app.beehiiv.com/posts/post_delivered_beehiiv_123/preview",
        },
      }),
      { status: 201 }
    );
  }) as typeof fetch;

  try {
    const postId = await deliverEmail(
      {
        id: "draft_test_1",
        jobId: "job_test_1",
        status: "draft",
        subject: "Dose Issue #1",
        previewText: "Voices of humanity",
        headline: "A True Story",
        body: "Story text goes here.",
        recipientEmail: "test@example.com",
        updatedAt: new Date().toISOString(),
      },
      "idem_key_1"
    );

    assert.equal(postId, "post_delivered_beehiiv_123");
  } finally {
    global.fetch = originalFetch;
    if (originalProvider !== undefined) process.env.EMAIL_PROVIDER = originalProvider;
    else delete process.env.EMAIL_PROVIDER;
    if (originalKey !== undefined) process.env.BEEHIIV_API_KEY = originalKey;
    else delete process.env.BEEHIIV_API_KEY;
    if (originalPub !== undefined) process.env.BEEHIIV_PUBLICATION_ID = originalPub;
    else delete process.env.BEEHIIV_PUBLICATION_ID;
  }
});

test("Beehiiv: POST /api/jobs/[id]/beehiiv route pushes draft to Beehiiv", async () => {
  const { job } = store.createJob({
    filename: "interview_beehiiv.mp4",
    assetId: "asset_beehiiv_001",
    sample: true,
  });

  store.saveDraft(job.id, {
    subject: "A Dose of Kindness",
    previewText: "Street interview with stranger",
    headline: "Kindness in the City",
    body: "We stopped by the train station today.",
  });

  const originalFetch = global.fetch;
  const originalKey = process.env.BEEHIIV_API_KEY;
  const originalPub = process.env.BEEHIIV_PUBLICATION_ID;

  process.env.BEEHIIV_API_KEY = "mock_beehiiv_key";
  process.env.BEEHIIV_PUBLICATION_ID = "pub_mock_123";

  global.fetch = (async () => {
    return new Response(
      JSON.stringify({
        data: {
          id: "post_beehiiv_api_route_test",
          preview_url: "https://app.beehiiv.com/posts/post_beehiiv_api_route_test/preview",
        },
      }),
      { status: 201 }
    );
  }) as typeof fetch;

  try {
    const req = new NextRequest(`http://localhost/api/jobs/${job.id}/beehiiv`, {
      method: "POST",
      body: JSON.stringify({ status: "draft" }),
    });

    const res = await beehiivRoute(req, { params: Promise.resolve({ id: job.id }) });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.success, true);
    assert.equal(data.postId, "post_beehiiv_api_route_test");
    assert.equal(data.previewUrl, "https://app.beehiiv.com/posts/post_beehiiv_api_route_test/preview");
  } finally {
    global.fetch = originalFetch;
    if (originalKey !== undefined) process.env.BEEHIIV_API_KEY = originalKey;
    else delete process.env.BEEHIIV_API_KEY;
    if (originalPub !== undefined) process.env.BEEHIIV_PUBLICATION_ID = originalPub;
    else delete process.env.BEEHIIV_PUBLICATION_ID;
  }
});
