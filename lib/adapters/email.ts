import { env } from "@/lib/env";
import type { NewsletterDraft } from "@/lib/types";

function escapeHtml(input: string) {
  return input.replace(/[&<>\"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

export function renderNewsletterHtml(draft: { subject: string; previewText: string; headline: string; body: string; closing?: string }): string {
  const paragraphs = draft.body.split(/\n\s*\n/).filter((p) => p.trim());
  const formattedParagraphs = paragraphs
    .map(
      (p) =>
        `<p style="font-family: Georgia, Cambria, 'Times New Roman', serif; font-size: 17px; line-height: 1.8; color: #2D3748; margin: 0 0 20px 0;">${escapeHtml(
          p
        )}</p>`
    )
    .join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(draft.subject)}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #F8F9FA; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; -webkit-font-smoothing: antialiased;">
  <!-- Preheader preview text -->
  <span style="display: none !important; visibility: hidden; opacity: 0; color: transparent; height: 0; width: 0; font-size: 1px;">${escapeHtml(
    draft.previewText
  )}</span>
  
  <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: #F8F9FA; padding: 32px 16px;">
    <tr>
      <td align="center">
        <!-- Main Card -->
        <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 620px; background-color: #FFFFFF; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 20px rgba(0, 0, 0, 0.05); border: 1px solid #E5E7EB;">
          <!-- Top Accent Bar -->
          <tr>
            <td height="5" style="background: linear-gradient(90deg, #C2000C 0%, #E63946 100%); line-height: 5px; font-size: 5px;">&nbsp;</td>
          </tr>
          <!-- Masthead Header -->
          <tr>
            <td style="padding: 32px 40px 24px 40px; border-bottom: 1px solid #F3F4F6;">
              <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
                <tr>
                  <td align="left">
                    <span style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 13px; font-weight: 800; letter-spacing: 0.15em; color: #C2000C; text-transform: uppercase;">DOSE OF SOCIETY</span>
                  </td>
                  <td align="right">
                    <span style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 12px; color: #9CA3AF; font-weight: 500;">Real Stories • Real People</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <!-- Headline & Dek -->
          <tr>
            <td style="padding: 36px 40px 12px 40px;">
              <h1 style="font-family: Georgia, Cambria, 'Times New Roman', serif; font-size: 28px; font-weight: 700; line-height: 1.25; color: #111827; margin: 0 0 14px 0;">
                ${escapeHtml(draft.headline)}
              </h1>
              <p style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 16px; line-height: 1.5; color: #6B7280; margin: 0 0 24px 0; font-style: italic;">
                ${escapeHtml(draft.previewText)}
              </p>
            </td>
          </tr>
          <!-- Story Body -->
          <tr>
            <td style="padding: 0 40px 16px 40px;">
              ${formattedParagraphs}
            </td>
          </tr>
          <!-- Editorial Sign-off & Reflection -->
          <tr>
            <td style="padding: 16px 40px 36px 40px;">
              <div style="background-color: #FFF8F8; border-left: 3px solid #C2000C; padding: 16px 20px; border-radius: 0 8px 8px 0; margin-bottom: 28px;">
                <p style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 11px; font-weight: 700; letter-spacing: 0.1em; color: #C2000C; text-transform: uppercase; margin: 0 0 6px 0;">A DOSE TO CARRY</p>
                <p style="font-family: Georgia, Cambria, serif; font-size: 15px; line-height: 1.5; color: #4B5563; margin: 0; font-style: italic;">
                  “Every person you walk past carries a universe inside them. Listen closely.”
                </p>
              </div>
              ${
                draft.closing
                  ? `<p style="font-family: Georgia, Cambria, serif; font-size: 16px; line-height: 1.6; color: #1F2937; margin: 0 0 8px 0; white-space: pre-wrap;">${escapeHtml(
                      draft.closing
                    )}</p>`
                  : ""
              }
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="background-color: #FAFAFA; border-top: 1px solid #F3F4F6; padding: 28px 40px; text-align: center;">
              <p style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 12px; color: #9CA3AF; margin: 0 0 8px 0; line-height: 1.5;">
                You received this newsletter via the Dose of Society Editorial Engine.
              </p>
              <p style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 11px; color: #D1D5DB; margin: 0;">
                © ${new Date().getFullYear()} Dose of Society. Real stories. No scripts.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export async function deliverEmail(draft: NewsletterDraft, idempotencyKey: string) {
  const key = env("EMAIL_API_KEY") || env("resend_api_key");
  const from = env("EMAIL_FROM");
  const provider = env("EMAIL_PROVIDER") || "resend";

  if (provider === "beehiiv") {
    const { deliverBeehiivPost } = await import("@/lib/adapters/beehiiv");
    return await deliverBeehiivPost(draft, idempotencyKey);
  }

  if (provider !== "resend") {
    throw new Error("Only the Resend demo adapter is implemented (or Beehiiv via EMAIL_PROVIDER=beehiiv). Set EMAIL_PROVIDER=resend.");
  }
  if (!key || !from) throw new Error("Email is not configured. Set EMAIL_API_KEY and EMAIL_FROM; verify the sender in Resend.");
  if (!draft.recipientEmail) throw new Error("A recipient email is required before sending.");

  const html = renderNewsletterHtml(draft);

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "content-type": "application/json",
      "Idempotency-Key": idempotencyKey
    },
    body: JSON.stringify({
      from,
      to: [draft.recipientEmail],
      subject: draft.subject,
      html
    })
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(`Resend did not accept the email (${response.status}): ${errorText}`);
  }

  const data = (await response.json()) as { id?: string };
  if (!data.id) throw new Error("Resend returned no message ID; email remains unsent.");
  return data.id;
}
