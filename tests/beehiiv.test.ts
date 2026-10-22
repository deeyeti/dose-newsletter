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
    assert.equal(data.isUpdate, false);
  } finally {
    global.fetch = originalFetch;
    if (originalKey !== undefined) process.env.BEEHIIV_API_KEY = originalKey;
    else delete process.env.BEEHIIV_API_KEY;
    if (originalPub !== undefined) process.env.BEEHIIV_PUBLICATION_ID = originalPub;
    else delete process.env.BEEHIIV_PUBLICATION_ID;
  }
});

test("Beehiiv: updateBeehiivPost sends PATCH and modifies post", async () => {
  const originalFetch = global.fetch;
  const originalKey = process.env.BEEHIIV_API_KEY;
  const originalPub = process.env.BEEHIIV_PUBLICATION_ID;

  process.env.BEEHIIV_API_KEY = "mock_beehiiv_key";
  process.env.BEEHIIV_PUBLICATION_ID = "pub_mock_123";

  let capturedMethod = "";
  let capturedUrl = "";
  let capturedBody: Record<string, unknown> = {};

  global.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    capturedMethod = init?.method || "GET";
    capturedUrl = String(url);
    capturedBody = JSON.parse(String(init?.body || "{}"));
    return new Response(
      JSON.stringify({
        data: {
          id: "post_patch_test_1",
          preview_url: "https://app.beehiiv.com/posts/post_patch_test_1/preview",
          web_url: "https://oms-newsletter.beehiiv.com/p/patch-slug",
          status: "confirmed",
        },
      }),
      { status: 200 }
    );
  }) as typeof fetch;

  try {
    const { updateBeehiivPost } = await import("@/lib/adapters/beehiiv");
    const res = await updateBeehiivPost(
      "post_patch_test_1",
      {
        headline: "Updated Title",
        previewText: "Updated Preview",
        body: "Updated body content.",
      },
      { status: "confirmed", scheduledAt: "2026-11-01T10:00:00.000Z" }
    );

    assert.equal(res.id, "post_patch_test_1");
    assert.equal(capturedMethod, "PATCH");
    assert.equal(capturedUrl, "https://api.beehiiv.com/v2/publications/pub_mock_123/posts/post_patch_test_1");
    assert.equal(capturedBody.title, "Updated Title");
    assert.equal(capturedBody.subtitle, "Updated Preview");
    assert.equal(capturedBody.status, "confirmed");
    assert.equal(capturedBody.scheduled_at, "2026-11-01T10:00:00.000Z");
  } finally {
    global.fetch = originalFetch;
    if (originalKey !== undefined) process.env.BEEHIIV_API_KEY = originalKey;
    else delete process.env.BEEHIIV_API_KEY;
    if (originalPub !== undefined) process.env.BEEHIIV_PUBLICATION_ID = originalPub;
    else delete process.env.BEEHIIV_PUBLICATION_ID;
  }
});

test("Beehiiv: getBeehiivPost fetches post and parses email/web stats", async () => {
  const originalFetch = global.fetch;
  const originalKey = process.env.BEEHIIV_API_KEY;
  const originalPub = process.env.BEEHIIV_PUBLICATION_ID;

  process.env.BEEHIIV_API_KEY = "mock_beehiiv_key";
  process.env.BEEHIIV_PUBLICATION_ID = "pub_mock_123";

  global.fetch = (async (url: string | URL | Request) => {
    assert.ok(String(url).includes("expand[]=stats"));
    return new Response(
      JSON.stringify({
        data: {
          id: "post_stats_123",
          title: "Stats Test Issue",
          subtitle: "Stats subtitle",
          status: "confirmed",
          web_url: "https://oms-newsletter.beehiiv.com/p/stats-test",
          preview_url: "https://app.beehiiv.com/posts/post_stats_123/preview",
          publish_date: 1715700000,
          stats: {
            email: {
              recipients: 1500,
              delivered: 1490,
              opens: 850,
              unique_opens: 720,
              open_rate: 0.483,
              clicks: 120,
              unique_clicks: 95,
              click_rate: 0.08,
            },
            web: {
              views: 340,
              clicks: 45,
            },
          },
        },
      }),
      { status: 200 }
    );
  }) as typeof fetch;

  try {
    const { getBeehiivPost } = await import("@/lib/adapters/beehiiv");
    const detail = await getBeehiivPost("post_stats_123");

    assert.equal(detail.id, "post_stats_123");
    assert.equal(detail.status, "confirmed");
    assert.equal(detail.stats?.email?.recipients, 1500);
    assert.equal(detail.stats?.email?.uniqueOpens, 720);
    assert.equal(detail.stats?.email?.openRate, 0.483);
    assert.equal(detail.stats?.email?.uniqueClicks, 95);
    assert.equal(detail.stats?.web?.views, 340);
  } finally {
    global.fetch = originalFetch;
    if (originalKey !== undefined) process.env.BEEHIIV_API_KEY = originalKey;
    else delete process.env.BEEHIIV_API_KEY;
    if (originalPub !== undefined) process.env.BEEHIIV_PUBLICATION_ID = originalPub;
    else delete process.env.BEEHIIV_PUBLICATION_ID;
  }
});

test("Beehiiv: POST and GET routes handle scheduling, deduplication, and metrics refresh", async () => {
  const { job } = store.createJob({
    filename: "dedup_test.mp4",
    assetId: "asset_dedup_001",
    sample: true,
  });

  store.saveDraft(job.id, {
    subject: "Initial Subject",
    previewText: "Initial Dek",
    headline: "Initial Headline",
    body: "Body 1.",
  });

  const originalFetch = global.fetch;
  const originalKey = process.env.BEEHIIV_API_KEY;
  const originalPub = process.env.BEEHIIV_PUBLICATION_ID;

  process.env.BEEHIIV_API_KEY = "mock_beehiiv_key";
  process.env.BEEHIIV_PUBLICATION_ID = "pub_mock_123";

  let createCalls = 0;
  let updateCalls = 0;

  global.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const method = init?.method || "GET";
    const urlStr = String(url);

    if (method === "POST") {
      createCalls++;
      return new Response(
        JSON.stringify({
          data: {
            id: "post_dedup_created_777",
            preview_url: "https://app.beehiiv.com/posts/post_dedup_created_777/preview",
            web_url: "https://oms-newsletter.beehiiv.com/p/dedup-777",
          },
        }),
        { status: 201 }
      );
    } else if (method === "PATCH") {
      updateCalls++;
      return new Response(
        JSON.stringify({
          data: {
            id: "post_dedup_created_777",
            preview_url: "https://app.beehiiv.com/posts/post_dedup_created_777/preview",
            web_url: "https://oms-newsletter.beehiiv.com/p/dedup-777",
            status: "confirmed",
          },
        }),
        { status: 200 }
      );
    } else if (method === "GET" && urlStr.includes("post_dedup_created_777")) {
      return new Response(
        JSON.stringify({
          data: {
            id: "post_dedup_created_777",
            status: "confirmed",
            stats: {
              email: {
                recipients: 500,
                opens: 250,
                unique_opens: 200,
                open_rate: 0.5,
              },
            },
          },
        }),
        { status: 200 }
      );
    }

    return new Response(JSON.stringify({ data: {} }), { status: 200 });
  }) as typeof fetch;

  try {
    const { GET: getBeehiivRoute } = await import("@/app/api/jobs/[id]/beehiiv/route");

    // 1. Initial creation
    const req1 = new NextRequest(`http://localhost/api/jobs/${job.id}/beehiiv`, {
      method: "POST",
      body: JSON.stringify({ action: "draft" }),
    });
    const res1 = await beehiivRoute(req1, { params: Promise.resolve({ id: job.id }) });
    const data1 = await res1.json();
    assert.equal(data1.success, true);
    assert.equal(data1.isUpdate, false);
    assert.equal(data1.postId, "post_dedup_created_777");
    assert.equal(createCalls, 1);
    assert.equal(updateCalls, 0);

    // 2. Second push with edits should trigger UPDATE (PATCH), not duplicate CREATE!
    const req2 = new NextRequest(`http://localhost/api/jobs/${job.id}/beehiiv`, {
      method: "POST",
      body: JSON.stringify({
        action: "schedule",
        scheduledAt: "2026-11-05T14:00:00.000Z",
        draft: {
          headline: "Edited Headline",
          subject: "Edited Subject",
          previewText: "Edited Dek",
          body: "Updated body paragraph.",
        },
      }),
    });
    const res2 = await beehiivRoute(req2, { params: Promise.resolve({ id: job.id }) });
    const data2 = await res2.json();
    assert.equal(data2.success, true);
    assert.equal(data2.isUpdate, true);
    assert.equal(data2.postId, "post_dedup_created_777");
    assert.equal(createCalls, 1);
    assert.equal(updateCalls, 1);

    const getReq = new NextRequest(`http://localhost/api/jobs/${job.id}/beehiiv`);
    const getRes = await getBeehiivRoute(getReq, { params: Promise.resolve({ id: job.id }) });
    const getData = await getRes.json();
    assert.equal(getData.success, true);
    assert.equal(getData.post.stats?.email?.recipients, 500);
    assert.equal(getData.post.stats?.email?.openRate, 0.5);
  } finally {
    global.fetch = originalFetch;
    if (originalKey !== undefined) process.env.BEEHIIV_API_KEY = originalKey;
    else delete process.env.BEEHIIV_API_KEY;
    if (originalPub !== undefined) process.env.BEEHIIV_PUBLICATION_ID = originalPub;
    else delete process.env.BEEHIIV_PUBLICATION_ID;
  }
});

test("Beehiiv: createBeehiivSubscription and listBeehiivSubscriptions work as expected", async () => {
  const originalFetch = global.fetch;
  const originalKey = process.env.BEEHIIV_API_KEY;
  const originalPub = process.env.BEEHIIV_PUBLICATION_ID;

  process.env.BEEHIIV_API_KEY = "mock_beehiiv_key";
  process.env.BEEHIIV_PUBLICATION_ID = "pub_mock_123";

  let capturedBody: Record<string, unknown> = {};

  global.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const method = init?.method || "GET";
    const urlStr = String(url);

    if (method === "POST" && urlStr.includes("/subscriptions")) {
      capturedBody = JSON.parse(String(init?.body || "{}"));
      return new Response(
        JSON.stringify({
          data: {
            id: "sub_test_subscriber_123",
            email: capturedBody.email,
            status: "active",
            created: 1715700000,
          },
        }),
        { status: 201 }
      );
    } else if (method === "GET" && urlStr.includes("/subscriptions")) {
      return new Response(
        JSON.stringify({
          data: [
            {
              id: "sub_test_subscriber_123",
              email: "reader@doseofsociety.com",
              status: "active",
              created: 1715700000,
              subscription_tier: "free",
            },
          ],
        }),
        { status: 200 }
      );
    }
    return new Response("{}", { status: 200 });
  }) as typeof fetch;

  try {
    const { createBeehiivSubscription, listBeehiivSubscriptions } = await import("@/lib/adapters/beehiiv");

    const created = await createBeehiivSubscription("Reader@DoseOfSociety.com", {
      sendWelcomeEmail: true,
      tier: "free",
    });

    assert.equal(created.id, "sub_test_subscriber_123");
    assert.equal(capturedBody.email, "reader@doseofsociety.com");
    assert.equal(capturedBody.send_welcome_email, true);

    const list = await listBeehiivSubscriptions();
    assert.equal(list.length, 1);
    assert.equal(list[0].email, "reader@doseofsociety.com");
  } finally {
    global.fetch = originalFetch;
    if (originalKey !== undefined) process.env.BEEHIIV_API_KEY = originalKey;
    else delete process.env.BEEHIIV_API_KEY;
    if (originalPub !== undefined) process.env.BEEHIIV_PUBLICATION_ID = originalPub;
    else delete process.env.BEEHIIV_PUBLICATION_ID;
  }
});

test("Beehiiv: /api/beehiiv/subscribers routes guard invalid emails and create subscriptions", async () => {
  const originalFetch = global.fetch;
  const originalKey = process.env.BEEHIIV_API_KEY;
  const originalPub = process.env.BEEHIIV_PUBLICATION_ID;

  process.env.BEEHIIV_API_KEY = "mock_beehiiv_key";
  process.env.BEEHIIV_PUBLICATION_ID = "pub_mock_123";

  global.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const method = init?.method || "GET";
    if (method === "POST") {
      const body = JSON.parse(String(init?.body || "{}"));
      return new Response(
        JSON.stringify({
          data: {
            id: "sub_api_route_test",
            email: body.email,
            status: "validating",
            created: 1715700000,
          },
        }),
        { status: 201 }
      );
    } else {
      return new Response(
        JSON.stringify({
          data: [
            {
              id: "sub_api_route_test",
              email: "subscriber@test.com",
              status: "active",
              created: 1715700000,
            },
          ],
        }),
        { status: 200 }
      );
    }
  }) as typeof fetch;

  try {
    const { POST: postSubscriberRoute, GET: getSubscriberRoute } = await import(
      "@/app/api/beehiiv/subscribers/route"
    );

    // 1. Guard missing/invalid email
    const badReq = new NextRequest("http://localhost/api/beehiiv/subscribers", {
      method: "POST",
      body: JSON.stringify({ email: "invalid-email" }),
    });
    const badRes = await postSubscriberRoute(badReq);
    assert.equal(badRes.status, 400);

    // 2. Successful subscriber creation
    const goodReq = new NextRequest("http://localhost/api/beehiiv/subscribers", {
      method: "POST",
      body: JSON.stringify({ email: "subscriber@test.com", sendWelcomeEmail: false }),
    });
    const goodRes = await postSubscriberRoute(goodReq);
    assert.equal(goodRes.status, 200);
    const goodData = await goodRes.json();
    assert.equal(goodData.success, true);
    assert.equal(goodData.subscriber.id, "sub_api_route_test");

    // 3. GET list
    const listReq = new NextRequest("http://localhost/api/beehiiv/subscribers");
    const listRes = await getSubscriberRoute(listReq);
    assert.equal(listRes.status, 200);
    const listData = await listRes.json();
    assert.equal(listData.success, true);
    assert.equal(listData.subscribers.length, 1);
  } finally {
    global.fetch = originalFetch;
    if (originalKey !== undefined) process.env.BEEHIIV_API_KEY = originalKey;
    else delete process.env.BEEHIIV_API_KEY;
    if (originalPub !== undefined) process.env.BEEHIIV_PUBLICATION_ID = originalPub;
    else delete process.env.BEEHIIV_PUBLICATION_ID;
  }
});


