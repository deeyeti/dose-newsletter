import { env } from "@/lib/env";
import type { NewsletterDraft } from "@/lib/types";

export async function deliverEmail(draft: NewsletterDraft, idempotencyKey: string) {
  const key = env("EMAIL_API_KEY") || env("resend_api_key"), from = env("EMAIL_FROM"), provider = env("EMAIL_PROVIDER") || "resend";
  if (provider !== "resend") throw new Error("Only the Resend demo adapter is implemented. Set EMAIL_PROVIDER=resend.");
  if (!key || !from) throw new Error("Email is not configured. Set EMAIL_API_KEY and EMAIL_FROM; verify the sender in Resend.");
  if (!draft.recipientEmail) throw new Error("A recipient email is required before sending.");
  const html = `<main style="font-family:Georgia,serif;color:#171717;max-width:620px;margin:auto"><p style="color:#C2000C;font-family:Arial,sans-serif;font-size:12px;letter-spacing:.12em">DOSE OF SOCIETY</p><h1>${escapeHtml(draft.headline)}</h1><p style="white-space:pre-wrap;line-height:1.65">${escapeHtml(draft.body)}</p>${draft.closing ? `<p>${escapeHtml(draft.closing)}</p>` : ""}</main>`;
  const response = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${key}`, "content-type": "application/json", "Idempotency-Key": idempotencyKey }, body: JSON.stringify({ from, to: [draft.recipientEmail], subject: draft.subject, html }) });
  if (!response.ok) throw new Error(`Resend did not accept the email (${response.status}). Check EMAIL_API_KEY and sender verification.`);
  const data = await response.json() as { id?: string }; if (!data.id) throw new Error("Resend returned no message ID; email remains unsent."); return data.id;
}
function escapeHtml(input: string) { return input.replace(/[&<>\"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '\"': "&quot;" })[c]!); }
