import { env } from "@/lib/env";
import { renderNewsletterHtml } from "@/lib/adapters/email";
import type { NewsletterDraft, BeehiivPostStats } from "@/lib/types";

export interface BeehiivPublication {
  id: string;
  name: string;
  organization_name?: string;
}

export interface BeehiivPostResult {
  id: string;
  previewUrl?: string;
  webUrl?: string;
  status?: string;
}

export async function getBeehiivCredentials(): Promise<{ apiKey: string; publicationId: string }> {
  const apiKey = env("BEEHIIV_API_KEY");
  if (!apiKey) {
    throw new Error("Beehiiv is not configured. Set BEEHIIV_API_KEY in local.env.");
  }

  let publicationId = env("BEEHIIV_PUBLICATION_ID");
  if (!publicationId) {
    // Dynamically discover publication id if not explicitly set
    const res = await fetch("https://api.beehiiv.com/v2/publications", {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`Beehiiv failed to list publications (${res.status}): ${errText}`);
    }
    const data = (await res.json()) as { data?: Array<{ id: string }> };
    const discovered = data.data?.[0]?.id;
    if (!discovered) {
      throw new Error("No publications found in your Beehiiv account. Create a publication in Beehiiv first.");
    }
    publicationId = discovered;
  }

  return { apiKey, publicationId };
}

export async function getPublicationDetails(): Promise<BeehiivPublication> {
  const { apiKey, publicationId } = await getBeehiivCredentials();
  const res = await fetch(`https://api.beehiiv.com/v2/publications/${publicationId}`, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
    },
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Beehiiv failed to fetch publication (${res.status}): ${errText}`);
  }

  const json = (await res.json()) as { data: BeehiivPublication };
  return json.data;
}

export async function createBeehiivPost(
  draft: { subject: string; previewText: string; headline: string; body: string; closing?: string },
  options: { status?: "draft" | "confirmed"; scheduledAt?: string } = {}
): Promise<BeehiivPostResult> {
  const { apiKey, publicationId } = await getBeehiivCredentials();
  const html = renderNewsletterHtml(draft);

  const payload: Record<string, unknown> = {
    title: draft.headline?.trim() || draft.subject?.trim() || "Dose of Society Newsletter",
    subtitle: draft.previewText?.trim() || "",
    status: options.status ?? "draft",
    body_content: html,
  };

  if (options.scheduledAt) {
    payload.scheduled_at = options.scheduledAt;
  }

  const response = await fetch(`https://api.beehiiv.com/v2/publications/${publicationId}/posts`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(`Beehiiv rejected post creation (${response.status}): ${errorText}`);
  }

  const result = (await response.json()) as {
    data?: {
      id?: string;
      preview_url?: string;
      web_url?: string;
      status?: string;
    };
  };

  const post = result.data;
  if (!post?.id) {
    throw new Error("Beehiiv created post but returned no post ID.");
  }

  return {
    id: post.id,
    previewUrl: post.preview_url,
    webUrl: post.web_url,
    status: post.status,
  };
}

export async function updateBeehiivPost(
  postId: string,
  draft: { subject?: string; previewText?: string; headline?: string; body?: string; closing?: string },
  options: { status?: "draft" | "confirmed"; scheduledAt?: string } = {}
): Promise<BeehiivPostResult> {
  const { apiKey, publicationId } = await getBeehiivCredentials();
  const payload: Record<string, unknown> = {};

  if (draft.headline || draft.subject) {
    payload.title = draft.headline?.trim() || draft.subject?.trim();
  }
  if (draft.previewText !== undefined) {
    payload.subtitle = draft.previewText.trim();
  }
  if (draft.body) {
    payload.body_content = renderNewsletterHtml({
      subject: draft.subject || "Dose of Society Newsletter",
      previewText: draft.previewText || "",
      headline: draft.headline || "Newsletter",
      body: draft.body,
      closing: draft.closing,
    });
  }
  if (options.status) {
    payload.status = options.status;
  }
  if (options.scheduledAt) {
    payload.scheduled_at = options.scheduledAt;
  }

  const response = await fetch(`https://api.beehiiv.com/v2/publications/${publicationId}/posts/${postId}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(`Beehiiv rejected post update (${response.status}): ${errorText}`);
  }

  const result = (await response.json()) as {
    data?: {
      id?: string;
      preview_url?: string;
      web_url?: string;
      status?: string;
    };
  };

  const post = result.data;
  return {
    id: post?.id || postId,
    previewUrl: post?.preview_url,
    webUrl: post?.web_url,
    status: post?.status,
  };
}

export async function getBeehiivPost(postId: string): Promise<{
  id: string;
  title?: string;
  subtitle?: string;
  status: "draft" | "confirmed" | "archived";
  previewUrl?: string;
  webUrl?: string;
  scheduledAt?: string | null;
  publishDate?: string | null;
  stats?: BeehiivPostStats;
}> {
  const { apiKey, publicationId } = await getBeehiivCredentials();
  const response = await fetch(
    `https://api.beehiiv.com/v2/publications/${publicationId}/posts/${postId}?expand[]=stats`,
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
    }
  );

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(`Beehiiv failed to fetch post (${response.status}): ${errorText}`);
  }

  const result = (await response.json()) as { data: any };
  const data = result.data;
  const emailStats = data.stats?.email;
  const webStats = data.stats?.web;

  return {
    id: data.id,
    title: data.title,
    subtitle: data.subtitle,
    status: data.status,
    previewUrl: data.preview_url,
    webUrl: data.web_url,
    scheduledAt: data.scheduled_at ? new Date(data.scheduled_at).toISOString() : null,
    publishDate: data.publish_date ? new Date(data.publish_date * 1000).toISOString() : null,
    stats: {
      email: emailStats
        ? {
            recipients: emailStats.recipients ?? 0,
            delivered: emailStats.delivered ?? 0,
            opens: emailStats.opens ?? 0,
            uniqueOpens: emailStats.unique_opens ?? 0,
            openRate: emailStats.open_rate ?? 0,
            clicks: emailStats.clicks ?? 0,
            uniqueClicks: emailStats.unique_clicks ?? 0,
            clickRate: emailStats.click_rate ?? 0,
            unsubscribes: emailStats.unsubscribes ?? 0,
            spamReports: emailStats.spam_reports ?? 0,
          }
        : undefined,
      web: webStats
        ? {
            views: webStats.views ?? 0,
            clicks: webStats.clicks ?? 0,
          }
        : undefined,
    },
  };
}

export async function deleteBeehiivPost(postId: string): Promise<void> {
  const { apiKey, publicationId } = await getBeehiivCredentials();
  const response = await fetch(`https://api.beehiiv.com/v2/publications/${publicationId}/posts/${postId}`, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
    },
  });

  if (!response.ok && response.status !== 204) {
    const errorText = await response.text().catch(() => "");
    throw new Error(`Beehiiv failed to delete post (${response.status}): ${errorText}`);
  }
}

export async function deliverBeehiivPost(
  draft: NewsletterDraft,
  _idempotencyKey?: string
): Promise<string> {
  const post = await createBeehiivPost(draft, { status: "draft" });
  return post.id;
}

export async function createBeehiivSubscription(
  email: string,
  options: {
    sendWelcomeEmail?: boolean;
    tier?: "free" | "premium";
    utmSource?: string;
    reactivateExisting?: boolean;
  } = {}
): Promise<{ id: string; email: string; status: string; created: number }> {
  const { apiKey, publicationId } = await getBeehiivCredentials();

  const payload: Record<string, unknown> = {
    email: email.trim().toLowerCase(),
    reactivate_existing: options.reactivateExisting ?? true,
    send_welcome_email: options.sendWelcomeEmail ?? false,
    utm_source: options.utmSource || "dose-engine",
    tier: options.tier || "free",
  };

  const response = await fetch(`https://api.beehiiv.com/v2/publications/${publicationId}/subscriptions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(`Beehiiv rejected subscriber creation (${response.status}): ${errorText}`);
  }

  const result = (await response.json()) as { data: { id: string; email: string; status: string; created: number } };
  return result.data;
}

export async function listBeehiivSubscriptions(options: { limit?: number } = {}): Promise<Array<{
  id: string;
  email: string;
  status: string;
  created: number;
  tier: string;
}>> {
  const { apiKey, publicationId } = await getBeehiivCredentials();
  const limit = options.limit || 20;

  const response = await fetch(`https://api.beehiiv.com/v2/publications/${publicationId}/subscriptions?limit=${limit}`, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(`Beehiiv failed to list subscribers (${response.status}): ${errorText}`);
  }

  const result = (await response.json()) as {
    data?: Array<{
      id: string;
      email: string;
      status: string;
      created: number;
      subscription_tier?: string;
    }>;
  };

  return (result.data || []).map((s) => ({
    id: s.id,
    email: s.email,
    status: s.status,
    created: s.created,
    tier: s.subscription_tier || "free",
  }));
}

export async function deleteBeehiivSubscription(subscriptionId: string): Promise<void> {
  const { apiKey, publicationId } = await getBeehiivCredentials();
  const response = await fetch(`https://api.beehiiv.com/v2/publications/${publicationId}/subscriptions/${subscriptionId}`, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
    },
  });

  if (!response.ok && response.status !== 204) {
    const errorText = await response.text().catch(() => "");
    throw new Error(`Beehiiv failed to delete subscription (${response.status}): ${errorText}`);
  }
}

