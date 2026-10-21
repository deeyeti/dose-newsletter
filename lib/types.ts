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
