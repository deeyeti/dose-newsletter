export const JOB_STATUSES = ["received", "downloading", "transcribing", "drafting", "ready_for_review", "sending", "sent", "failed"] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export type DraftInput = {
  subject: string;
  previewText: string;
  headline: string;
  body: string;
  closing?: string;
  recipientEmail?: string;
};

export type NewsletterDraft = DraftInput & { id: string; jobId: string; status: "draft" | "sending" | "sent"; updatedAt: string };
export type Job = {
  id: string; frameioAssetId: string; frameioProjectId?: string; filename: string; mediaType?: string;
  durationSeconds?: number; status: JobStatus; isSample: boolean; errorCode?: string; errorMessage?: string;
  createdAt: string; updatedAt: string; draftSubject?: string; recipientEmail?: string;
};

export type BeehiivPostStats = {
  email?: {
    recipients?: number;
    delivered?: number;
    opens?: number;
    uniqueOpens?: number;
    openRate?: number;
    clicks?: number;
    uniqueClicks?: number;
    clickRate?: number;
    unsubscribes?: number;
    spamReports?: number;
  };
  web?: {
    views?: number;
    clicks?: number;
  };
};

export type BeehiivPostRecord = {
  id: string;
  jobId: string;
  draftId?: string;
  publicationId: string;
  status: "draft" | "confirmed" | "archived";
  title?: string;
  subtitle?: string;
  webUrl?: string;
  previewUrl?: string;
  scheduledAt?: string | null;
  publishDate?: string | null;
  stats?: BeehiivPostStats | null;
  createdAt: string;
  updatedAt: string;
};

export type BeehiivSubscription = {
  id: string;
  email: string;
  status: "active" | "validating" | "pending" | "unsubscribed" | string;
  tier?: "free" | "premium" | string;
  created?: number | string;
  utmSource?: string;
};

