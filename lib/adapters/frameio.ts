import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";

export type FrameFile = { id: string; name: string; mediaType?: string; projectId?: string; downloadUrl: string };

function headers() {
  const token = env("FRAMEIO_ACCESS_TOKEN");
  if (!token) throw new Error("Frame.io is not configured. Set FRAMEIO_ACCESS_TOKEN.");
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
  const response = await fetch(`https://api.frame.io/v4/accounts/${encodeURIComponent(accountId)}/files/${encodeURIComponent(assetId)}?include=media_links.original`, { headers: headers(), cache: "no-store" });
  if (!response.ok) throw new Error(`Frame.io file lookup failed (${response.status}). Check the V4 OAuth token and account ID.`);
  return asFile(unwrap(await response.json()));
}

export async function latestFrameFile(): Promise<FrameFile> {
  const accountId = env("FRAMEIO_ACCOUNT_ID"), folderId = env("FRAMEIO_FOLDER_ID");
  if (!accountId || !folderId) throw new Error("Manual check needs FRAMEIO_ACCOUNT_ID and FRAMEIO_FOLDER_ID.");
  const response = await fetch(`https://api.frame.io/v4/accounts/${encodeURIComponent(accountId)}/folders/${encodeURIComponent(folderId)}/files?include=media_links.original&page_size=100`, { headers: headers(), cache: "no-store" });
  if (!response.ok) throw new Error(`Frame.io folder lookup failed (${response.status}).`);
  const files = unwrap(await response.json());
  const list = Array.isArray(files) ? files : files?.data;
  if (!Array.isArray(list) || !list.length) throw new Error("No files were found in the configured Frame.io folder.");
  const latest = [...list].sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")))[0];
  return asFile(latest);
}
