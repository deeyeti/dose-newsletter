import test from "node:test";
import assert from "node:assert/strict";
import { store } from "@/lib/db";
import { isSupabaseConfigured, supabaseFindTranscript } from "@/lib/supabase";

test("Supabase transcript caching & local hydration", async () => {
  const assetId = "test-cached-asset-" + Date.now();
  const filename = "interview-cached.mp4";

  // 1. Create a job
  const { job } = store.createJob({
    assetId,
    filename,
  });
  assert.ok(job.id);

  // 2. Set transcript for this job
  const sampleTranscript = "This is a recorded transcript stored in Supabase cache.";
  store.setTranscript(job.id, sampleTranscript, "whisper-large-v3-turbo", "en");

  // 3. Verify transcript is saved and retrieved locally
  const detail = store.jobDetail(job.id);
  assert.equal(detail?.transcript?.text, sampleTranscript);

  // 4. Test seedJob and seedDetail
  const mockRemoteJob = {
    id: "remote-job-123",
    frameioAssetId: "remote-asset-456",
    filename: "remote-video.mp4",
    status: "sent" as const,
    isSample: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  store.seedJob(mockRemoteJob);
  const found = store.getJob("remote-job-123");
  assert.equal(found?.id, "remote-job-123");
  assert.equal(found?.filename, "remote-video.mp4");

  // Clean up
  store.deleteJob(job.id);
  store.deleteJob("remote-job-123");
  assert.equal(store.getJob(job.id), undefined);
  assert.equal(store.getJob("remote-job-123"), undefined);
});
