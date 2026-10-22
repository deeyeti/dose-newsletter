import { env } from "@/lib/env";
import { renderNewsletterHtml } from "@/lib/adapters/email";
import type { NewsletterDraft } from "@/lib/types";

export interface BeehiivPublication {
  id: string;
  name: string;
  organization_name?: string;
}

export interface BeehiivPostResult {
  id: string;
  previewUrl?: string;
  webUrl?: string;
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
  options: { status?: "draft" | "confirmed" } = {}
): Promise<BeehiivPostResult> {
  const { apiKey, publicationId } = await getBeehiivCredentials();
  const html = renderNewsletterHtml(draft);

  const payload = {
    title: draft.headline?.trim() || draft.subject?.trim() || "Dose of Society Newsletter",
    subtitle: draft.previewText?.trim() || "",
    status: options.status ?? "draft",
    body_content: html,
  };

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
  };
}

export async function deliverBeehiivPost(
  draft: NewsletterDraft,
  _idempotencyKey?: string
): Promise<string> {
  const post = await createBeehiivPost(draft, { status: "draft" });
  return post.id;
}
