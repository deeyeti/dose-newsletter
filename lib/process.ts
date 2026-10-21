import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { store } from "@/lib/db";
import { env } from "@/lib/env";
import { getFrameFile } from "@/lib/adapters/frameio";
import { transcribeWithGroq } from "@/lib/adapters/groq";
import { writeNewsletter } from "@/lib/adapters/claude";
import fsSync from "node:fs";
import { rejectLongVideo } from "@/lib/guards";

const exec = promisify(execFile);
const SAMPLE_TRANSCRIPT = "I grew up watching my grandmother repair clothes at the kitchen table. She never called it sustainability. She just said, if something still has life in it, why throw it away? Years later, I began mending my friends' jackets after work. People would tell me about the places those clothes had been. That is when I understood I was not only fixing fabric; I was helping people hold on to a memory.";

function ensureMediaToolsOnPath() {
  if (process.platform === "win32") {
    const wingetBase = path.join(os.homedir(), "AppData", "Local", "Microsoft", "WinGet", "Packages");
    if (fsSync.existsSync(wingetBase)) {
      try {
        const matches = fsSync.readdirSync(wingetBase).filter((d) => d.startsWith("Gyan.FFmpeg"));
        for (const match of matches) {
          const fullBuild = path.join(wingetBase, match);
          const inner = fsSync.readdirSync(fullBuild).find((d) => d.startsWith("ffmpeg-"));
          if (inner) {
            const bin = path.join(fullBuild, inner, "bin");
            if (fsSync.existsSync(path.join(bin, "ffmpeg.exe")) && !process.env.PATH?.includes(bin)) {
              process.env.PATH = `${bin};${process.env.PATH || ""}`;
              break;
            }
          }
        }
      } catch {}
    }
  }
}

async function mediaTools(): Promise<boolean> {
  ensureMediaToolsOnPath();
  try {
    await Promise.all([exec("ffprobe", ["-version"]), exec("ffmpeg", ["-version"])]);
    return true;
  } catch {
    return false;
  }
}

async function duration(file: string): Promise<number | undefined> {
  try {
    const { stdout } = await exec("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      file,
    ]);
    const seconds = Number.parseFloat(stdout);
    return Number.isFinite(seconds) ? seconds : undefined;
  } catch {
    return undefined;
  }
}

async function extractAudio(source: string, target: string): Promise<boolean> {
  try {
    await exec("ffmpeg", ["-y", "-i", source, "-map", "0:a:0", "-ar", "16000", "-ac", "1", "-c:a", "flac", target]);
    return true;
  } catch {
    return false;
  }
}

export async function processSample(jobId: string) {
  const job = store.getJob(jobId);
  if (!job?.isSample) throw new Error("Sample processing is available only for labelled sample jobs.");
  store.setJob(jobId, "transcribing", { durationSeconds: 42 });
  store.setTranscript(jobId, SAMPLE_TRANSCRIPT, "sample transcript", "en");
  store.setJob(jobId, "drafting");
  store.saveDraft(jobId, {
    subject: "What we choose to hold on to",
    previewText: "A small act of repair can carry a much larger story.",
    headline: "The life still left in a jacket",
    body: "She grew up watching her grandmother repair clothes at the kitchen table. It was never presented as a statement. Just a simple question: if something still has life in it, why throw it away?\n\nYears later, mending friends’ jackets after work became its own kind of listening. Every tear came with a place, a season, or a person attached to it. The work was not only about fabric. It was about making room for a memory to stay with someone a little longer.",
    closing: "This is labelled sample content — it was not fetched from Frame.io or transcribed by Groq.",
    recipientEmail: env("DEMO_RECIPIENT_EMAIL") || undefined,
  });
  store.setJob(jobId, "ready_for_review");
}

export async function processLiveJob(jobId: string) {
  const job = store.getJob(jobId);
  if (!job) throw new Error("Job not found.");
  if (job.isSample) return processSample(jobId);
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "dose-engine-"));
  try {
    store.setJob(jobId, "downloading");
    const file = await getFrameFile(job.frameioAssetId);
    store.setMetadata(jobId, { filename: file.name, mediaType: file.mediaType, projectId: file.projectId });
    if (!file.mediaType?.startsWith("video/") && !/\.(mp4|mov|webm|mkv|m4v)$/i.test(file.name)) {
      throw new Error("Frame.io asset is not a supported video file.");
    }

    const hasTools = await mediaTools();
    const source = path.join(temporary, `source-${randomUUID()}${path.extname(file.name) || ".mp4"}`);
    const response = await fetch(file.downloadUrl);
    if (!response.ok || !response.body) throw new Error(`Frame.io video download failed (${response.status}).`);
    await fs.writeFile(source, Buffer.from(await response.arrayBuffer()));

    const seconds = await duration(source);
    if (seconds !== undefined) {
      store.setJob(jobId, "downloading", { durationSeconds: seconds });
      rejectLongVideo(seconds);
    }

    let audioPath = source;
    if (hasTools) {
      const audioFlac = path.join(temporary, "audio.flac");
      const ok = await extractAudio(source, audioFlac);
      if (ok) audioPath = audioFlac;
    }

    store.setJob(jobId, "transcribing");
    const transcript = await transcribeWithGroq(audioPath);
    store.setTranscript(jobId, transcript.text, transcript.model, transcript.language);
    store.setJob(jobId, "drafting");
    const draft = await writeNewsletter(transcript.text);
    store.saveDraft(jobId, { ...draft, recipientEmail: env("DEMO_RECIPIENT_EMAIL") || undefined });
    store.setJob(jobId, "ready_for_review");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected processing error.";
    store.fail(jobId, /90 seconds/.test(message) ? "DURATION_LIMIT" : "PROCESSING_FAILED", message);
  } finally {
    await fs.rm(temporary, { recursive: true, force: true });
  }
}

export function enqueue(jobId: string) {
  setTimeout(() => {
    void processLiveJob(jobId);
  }, 0);
}
