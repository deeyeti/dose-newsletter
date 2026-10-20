import { createHmac, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { env } from "@/lib/env";

export type FrameFile = { id: string; name: string; mediaType?: string; projectId?: string; downloadUrl: string };

/** Decode the JWT payload — no verification, we trust our own stored token */
function jwtExpiresAt(token: string): number {
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString());
    if (payload.created_at && payload.expires_in) return Number(payload.created_at) + Number(payload.expires_in);
    if (payload.exp) return Number(payload.exp) * 1000;
  } catch { /* ignore */ }
  return 0;
}

/** Write a key=value pair into local.env in-place */
function patchLocalEnv(key: string, value: string) {
  const envPath = path.join(process.cwd(), "local.env");
  if (!fs.existsSync(envPath)) return;
  let content = fs.readFileSync(envPath, "utf8");
  const re = new RegExp(`^(${key}=).*$`, "m");
  content = re.test(content) ? content.replace(re, `$1${value}`) : `${content}\n${key}=${value}`;
  fs.writeFileSync(envPath, content, "utf8");
}

/** Return a valid Bearer token, silently refreshing when within 5 minutes of expiry. */
async function getToken(): Promise<string> {
  const current = env("FRAMEIO_ACCESS_TOKEN");
  if (!current) throw new Error("Frame.io is not configured. Set FRAMEIO_ACCESS_TOKEN.");

  const expiresAt = jwtExpiresAt(current);
  if (expiresAt === 0 || Date.now() < expiresAt - 5 * 60 * 1000) return current;

  const refreshToken = env("FRAMEIO_REFRESH_TOKEN");
  const clientId = env("FRAMEIO_CLIENT_ID");
  const clientSecret = env("FRAMEIO_CLIENT_SECRET");
  if (!refreshToken || !clientId || !clientSecret) {
    throw new Error("Frame.io access token is expired. Set FRAMEIO_REFRESH_TOKEN, FRAMEIO_CLIENT_ID, and FRAMEIO_CLIENT_SECRET to enable auto-refresh.");
  }

  const params = new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken, client_id: clientId, client_secret: clientSecret });
  const res = await fetch("https://ims-na1.adobelogin.com/ims/token/v3", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: params.toString() });
  if (!res.ok) throw new Error(`Adobe IMS token refresh failed (${res.status}). Re-run the OAuth flow.`);

  const data = await res.json() as { access_token?: string; refresh_token?: string };
  if (!data.access_token) throw new Error("Adobe IMS returned no access_token during refresh.");

  patchLocalEnv("FRAMEIO_ACCESS_TOKEN", data.access_token);
  if (data.refresh_token) patchLocalEnv("FRAMEIO_REFRESH_TOKEN", data.refresh_token);
  process.env["FRAMEIO_ACCESS_TOKEN"] = data.access_token;
  if (data.refresh_token) process.env["FRAMEIO_REFRESH_TOKEN"] = data.refresh_token;

  console.log("[frameio] Access token silently refreshed and saved to local.env.");
  return data.access_token;
}

async function headers() {
  const token = await getToken();
  return { Authorization: `Bearer ${token}`, Accept: "application/json" };
}


export function verifyFrameioSignature(body: string, timestamp: string | null, signature: string | null) {
  const secret = env("FRAMEIO_WEBHOOK_SECRET");
  if (!secret || !timestamp || !signature || !/^v0=[a-f0-9]{64}$/i.test(signature)) return false;
  const requestedAt = Number(timestamp);
  if (!Number.isFinite(requestedAt) || Math.abs(Date.now() / 1000 - requestedAt) > 300) return false;
  const expected = `v0=${createHmac("sha256", secret).update(`v0:${timestamp}:${body}`, "latin1").digest("hex")}`;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

function unwrap(json: any) { return json?.data ?? json; }
function asFile(data: any): FrameFile {
  const original = data?.media_links?.original;
  const downloadUrl = original?.download_url || original?.inline_url;
  if (!data?.id || !downloadUrl) throw new Error("Frame.io did not return a downloadable original. Ensure the token can download this file.");
  return { id: data.id, name: data.name || "Untitled Frame.io file", mediaType: data.media_type, projectId: data.project_id, downloadUrl };
}

export async function getFrameFile(assetId: string): Promise<FrameFile> {
  const accountId = env("FRAMEIO_ACCOUNT_ID");
  if (!accountId) throw new Error("Frame.io is not configured. Set FRAMEIO_ACCOUNT_ID.");
  const response = await fetch(`https://api.frame.io/v4/accounts/${encodeURIComponent(accountId)}/files/${encodeURIComponent(assetId)}?include=media_links.original`, { headers: await headers(), cache: "no-store" });
  if (!response.ok) throw new Error(`Frame.io file lookup failed (${response.status}). Check the V4 OAuth token and account ID.`);
  return asFile(unwrap(await response.json()));
}

export async function latestFrameFile(): Promise<FrameFile> {
  const accountId = env("FRAMEIO_ACCOUNT_ID"), folderId = env("FRAMEIO_FOLDER_ID");
  if (!accountId || !folderId) throw new Error("Manual check needs FRAMEIO_ACCOUNT_ID and FRAMEIO_FOLDER_ID.");
  const response = await fetch(`https://api.frame.io/v4/accounts/${encodeURIComponent(accountId)}/folders/${encodeURIComponent(folderId)}/files?include=media_links.original&page_size=100`, { headers: await headers(), cache: "no-store" });
  if (!response.ok) throw new Error(`Frame.io folder lookup failed (${response.status}).`);
  const files = unwrap(await response.json());
  const list = Array.isArray(files) ? files : files?.data;
  if (!Array.isArray(list) || !list.length) throw new Error("No files were found in the configured Frame.io folder.");
  const latest = [...list].sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")))[0];
  return asFile(latest);
}
