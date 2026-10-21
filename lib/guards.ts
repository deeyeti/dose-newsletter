export const MAX_VIDEO_SECONDS = 90;
export function rejectLongVideo(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) throw new Error("Could not determine video duration with FFprobe.");
  if (seconds > MAX_VIDEO_SECONDS) throw new Error(`This video is ${Math.ceil(seconds)} seconds. Dose Engine only processes videos up to ${MAX_VIDEO_SECONDS} seconds.`);
}
