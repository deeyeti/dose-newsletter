import fs from "node:fs";
import path from "node:path";
import { env } from "../lib/env";

export interface WebhookData {
  id: string;
  name: string;
  url: string;
  events?: string[];
  secret?: string;
  active?: boolean;
  workspace_id?: string;
  created_at?: string;
  updated_at?: string;
}

function patchLocalEnv(key: string, value: string) {
  const envPath = path.join(process.cwd(), "local.env");
  if (!fs.existsSync(envPath)) return;
  let content = fs.readFileSync(envPath, "utf8");
  const re = new RegExp(`^(${key}=).*$`, "m");
  content = re.test(content) ? content.replace(re, `$1${value}`) : `${content}\n${key}=${value}`;
  fs.writeFileSync(envPath, content, "utf8");
  console.log(`[local.env] Updated ${key}`);
}

async function getAuthHeader() {
  const token = env("FRAMEIO_ACCESS_TOKEN");
  if (!token) throw new Error("FRAMEIO_ACCESS_TOKEN is missing in local.env");
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

export async function listWebhooks(): Promise<WebhookData[]> {
  const accountId = env("FRAMEIO_ACCOUNT_ID");
  const workspaceId = env("FRAMEIO_WORKSPACE_ID");
  const headers = await getAuthHeader();

  const url = `https://api.frame.io/v4/accounts/${accountId}/workspaces/${workspaceId}/webhooks`;
  const res = await fetch(url, { headers });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Failed to list webhooks (${res.status}): ${errText}`);
  }

  const json = (await res.json()) as { data?: WebhookData[] } | WebhookData[];
  return Array.isArray(json) ? json : json.data || [];
}

export async function deleteWebhook(webhookId: string): Promise<boolean> {
  const accountId = env("FRAMEIO_ACCOUNT_ID");
  const workspaceId = env("FRAMEIO_WORKSPACE_ID");
  const headers = await getAuthHeader();
  const url = `https://api.frame.io/v4/accounts/${accountId}/workspaces/${workspaceId}/webhooks/${webhookId}`;
  const res = await fetch(url, { method: "DELETE", headers });
  return res.ok;
}

export async function setWebhookUrl(targetUrl: string, webhookName = "Dose of Society Vercel Receiver"): Promise<WebhookData> {
  const accountId = env("FRAMEIO_ACCOUNT_ID");
  const workspaceId = env("FRAMEIO_WORKSPACE_ID");
  const headers = await getAuthHeader();

  const existing = await listWebhooks();
  const currentHook = existing.find((h) => h.name === webhookName || h.url?.includes("api/webhooks/frameio"));

  if (currentHook && currentHook.id) {
    console.log(`[Frame.io v4] Found existing webhook: ${currentHook.id}`);
    console.log(`[Frame.io v4] Updating destination URL to: ${targetUrl}...`);

    const updateUrl = `https://api.frame.io/v4/accounts/${accountId}/workspaces/${workspaceId}/webhooks/${currentHook.id}`;
    const patchRes = await fetch(updateUrl, {
      method: "PATCH",
      headers,
      body: JSON.stringify({
        data: {
          url: targetUrl,
        },
      }),
    });

    if (patchRes.ok) {
      const updated = (await patchRes.json()) as { data: WebhookData };
      console.log(`✅ [Frame.io v4] Webhook destination successfully updated to ${targetUrl}`);
      return updated.data;
    }

    console.warn(`[Frame.io v4] PATCH failed (${patchRes.status}), deleting and recreating...`);
    await deleteWebhook(currentHook.id);
  }

  // Create new webhook
  console.log(`[Frame.io v4] Registering new webhook for ${targetUrl}...`);
  const createUrl = `https://api.frame.io/v4/accounts/${accountId}/workspaces/${workspaceId}/webhooks`;
  const createRes = await fetch(createUrl, {
    method: "POST",
    headers,
    body: JSON.stringify({
      data: {
        name: webhookName,
        url: targetUrl,
        events: ["file.ready"],
      },
    }),
  });

  if (!createRes.ok) {
    const err = await createRes.text().catch(() => "");
    throw new Error(`Failed to create webhook (${createRes.status}): ${err}`);
  }

  const created = (await createRes.json()) as { data: WebhookData };
  const hook = created.data;

  console.log(`\n============================================================`);
  console.log(`✅ [Frame.io v4] Webhook successfully created!`);
  console.log(`   ID:     ${hook.id}`);
  console.log(`   URL:    ${hook.url}`);
  if (hook.secret) {
    console.log(`   SECRET: ${hook.secret}`);
    console.log(`   (Saved to local.env as FRAMEIO_WEBHOOK_SECRET)`);
    console.log(`   IMPORTANT: Add this FRAMEIO_WEBHOOK_SECRET to your Vercel Environment Variables!`);
    patchLocalEnv("FRAMEIO_WEBHOOK_SECRET", hook.secret);
  }
  console.log(`============================================================\n`);

  return hook;
}

if (process.argv[1]?.endsWith("manage-webhook.ts")) {
  const action = process.argv[2] || "list";
  const urlArg = process.argv[3];

  if (action === "list") {
    listWebhooks().then((h) => console.log(JSON.stringify(h, null, 2))).catch(console.error);
  } else if (action === "set" && urlArg) {
    setWebhookUrl(urlArg).catch(console.error);
  } else if (action === "delete" && urlArg) {
    deleteWebhook(urlArg).then((ok) => console.log("Deleted:", ok)).catch(console.error);
  } else {
    console.log("Commands:");
    console.log("  npx tsx scripts/manage-webhook.ts list");
    console.log("  npx tsx scripts/manage-webhook.ts set https://your-project.vercel.app/api/webhooks/frameio");
    console.log("  npx tsx scripts/manage-webhook.ts delete <webhook_id>");
  }
}
