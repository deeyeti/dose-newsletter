import { getSupabase } from "@/lib/supabase";
import { chunkTranscript, scoreTextRelevance } from "@/lib/assistant/embeddings";
import { store } from "@/lib/db";
import { writeNewsletter } from "@/lib/adapters/claude";
import { env } from "@/lib/env";

export type MetricType = "saves" | "shares" | "engagement_rate" | "views" | "likes";

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export const ASSISTANT_TOOLS: ToolDefinition[] = [
  {
    name: "query_archive_by_metric",
    description: "Queries the Supabase archive of published interview reels ordered by a performance metric (e.g. saves, shares, views, engagement_rate). Use this when the editor asks for the best performing clips or clips from a certain time window.",
    parameters: {
      type: "object",
      properties: {
        metric: {
          type: "string",
          enum: ["saves", "shares", "engagement_rate", "views", "likes"],
          description: "The metric to sort by. 'saves' is the strongest signal for emotional resonance.",
        },
        days: {
          type: "number",
          description: "Optional time window in days (e.g. 30, 60, 90, 365). Default is all-time.",
        },
        limit: {
          type: "number",
          description: "Number of clips to return (default 3, max 10).",
        },
      },
      required: ["metric"],
    },
  },
  {
    name: "semantic_search_quotes",
    description: "Searches verbatim interview transcript chunks by emotional themes, topics, and keywords. Use this to find quotes on specific topics (e.g. 'grief and loss', 'family sacrifice', 'regret and money').",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "The thematic search query or concept (e.g. 'unspoken sacrifice for family' or 'regret about working too much').",
        },
        min_saves: {
          type: "number",
          description: "Optional minimum save count to filter for high-resonance stories.",
        },
        limit: {
          type: "number",
          description: "Number of quote chunks to return (default 3, max 10).",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "analyze_archive_themes",
    description: "Analyzes aggregate audience resonance across key story themes (e.g. family, grief, kindness, ambition) to see what topics are currently landing hardest with audiences.",
    parameters: {
      type: "object",
      properties: {
        days: {
          type: "number",
          description: "Optional lookback window in days (e.g. 30, 60, 90).",
        },
      },
    },
  },
  {
    name: "send_to_newsletter_draft",
    description: "Takes a specific reel from the Supabase archive by reel_id, writes a publication-grade newsletter draft using the editorial engine, and inserts it into the review queue so the editor can inspect and edit it in the drawer.",
    parameters: {
      type: "object",
      properties: {
        reel_id: {
          type: "string",
          description: "The ID of the reel in Supabase to draft into a newsletter.",
        },
        custom_angle: {
          type: "string",
          description: "Optional editorial direction or angle to focus on (e.g. 'focus on the grandmother's advice').",
        },
      },
      required: ["reel_id"],
    },
  },
];

/**
 * Execute tool calls against Supabase and local newsletter store.
 */
export async function executeTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  const supabase = getSupabase();

  if (name === "query_archive_by_metric") {
    const metric = (args.metric as MetricType) || "saves";
    const limit = Math.min(Math.max(Number(args.limit) || 3, 1), 10);
    const days = args.days ? Number(args.days) : undefined;

    // Check if tables exist
    try {
      let query = supabase
        .from("reel_metrics")
        .select(`
          reel_id,
          views,
          likes,
          comments,
          shares,
          saves,
          engagement_rate,
          recorded_at,
          reels (
            id,
            permalink,
            caption,
            summary,
            key_themes,
            published_at,
            transcript
          )
        `)
        .order(metric, { ascending: false })
        .limit(limit);

      if (days) {
        const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
        query = query.gte("recorded_at", since);
      }

      const { data, error } = await query;
      if (error) {
        return {
          error: `Supabase query failed: ${error.message}. If tables are not created yet, please run the migration SQL.`,
        };
      }

      return {
        metric,
        count: data?.length || 0,
        reels: (data || []).map((item) => {
          const r = Array.isArray(item.reels) ? item.reels[0] : item.reels;
          return {
            reel_id: item.reel_id,
            views: item.views,
            shares: item.shares,
            saves: item.saves,
            engagement_rate: item.engagement_rate,
            caption: r?.caption,
            summary: r?.summary,
            key_themes: r?.key_themes,
            published_at: r?.published_at,
            permalink: r?.permalink,
            transcript_snippet: r?.transcript ? r.transcript.slice(0, 300) + "..." : undefined,
          };
        }),
      };
    } catch (err: unknown) {
      return { error: String(err) };
    }
  }

  if (name === "semantic_search_quotes") {
    const query = String(args.query || "");
    const limit = Math.min(Math.max(Number(args.limit) || 3, 1), 10);
    const minSaves = args.min_saves ? Number(args.min_saves) : 0;

    try {
      // 1. Fetch available reels and their metrics
      const { data: reels, error: reelsErr } = await supabase
        .from("reels")
        .select("id, summary, key_themes, permalink, caption, transcript");

      if (reelsErr || !reels || reels.length === 0) {
        return {
          error: `Archive query unavailable: ${reelsErr?.message || "No reels found in Supabase"}. If tables are not created yet, please run the migration SQL or seed script.`,
        };
      }

      const { data: metrics } = await supabase
        .from("reel_metrics")
        .select("reel_id, saves, shares, views, engagement_rate");

      const metricMap = new Map((metrics || []).map((m) => [m.reel_id, m]));
      const reelMap = new Map(reels.map((r) => [r.id, r]));

      // 2. Fetch raw chunks from reel_embeddings if available, or generate from transcript
      const { data: rawChunks } = await supabase
        .from("reel_embeddings")
        .select("reel_id, chunk_text, speaker_timestamp")
        .limit(200);

      interface CandidateChunk {
        reel_id: string;
        chunk_text: string;
        speaker_timestamp?: string;
        similarity: number;
      }

      let allChunks: CandidateChunk[] = [];

      if (rawChunks && rawChunks.length > 0) {
        allChunks = rawChunks.map((c) => {
          const reel = reelMap.get(c.reel_id);
          const score = scoreTextRelevance(query, c.chunk_text, reel?.key_themes || []);
          return {
            reel_id: c.reel_id,
            chunk_text: c.chunk_text,
            speaker_timestamp: c.speaker_timestamp,
            similarity: score,
          };
        });
      } else {
        // Fallback: chunk transcripts on the fly
        for (const reel of reels) {
          if (!reel.transcript) continue;
          const chunks = chunkTranscript(reel.transcript, 40);
          for (const ch of chunks) {
            const score = scoreTextRelevance(query, ch.chunkText, reel.key_themes || []);
            allChunks.push({
              reel_id: reel.id,
              chunk_text: ch.chunkText,
              speaker_timestamp: ch.speakerTimestamp,
              similarity: score,
            });
          }
        }
      }

      // Filter by minSaves, sort by relevance score descending
      const results = allChunks
        .filter((c) => {
          if (!minSaves) return true;
          const m = metricMap.get(c.reel_id);
          return m ? m.saves >= minSaves : false;
        })
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, limit)
        .map((c) => {
          const r = reelMap.get(c.reel_id);
          const m = metricMap.get(c.reel_id);
          return {
            reel_id: c.reel_id,
            quote: c.chunk_text,
            timestamp: c.speaker_timestamp,
            similarity_score: Math.round(c.similarity * 100) / 100,
            saves: m?.saves || 0,
            shares: m?.shares || 0,
            summary: r?.summary,
            key_themes: r?.key_themes,
            permalink: r?.permalink,
          };
        });

      return {
        query,
        count: results.length,
        quotes: results,
      };
    } catch (err: unknown) {
      return { error: String(err) };
    }
  }

  if (name === "analyze_archive_themes") {
    try {
      const { data, error } = await supabase
        .from("reels")
        .select(`
          id,
          key_themes,
          reel_metrics (
            views,
            saves,
            shares,
            engagement_rate
          )
        `);

      if (error || !data) {
        return { error: `Could not analyze themes: ${error?.message}` };
      }

      const themeStats: Record<string, { count: number; totalSaves: number; totalViews: number; totalShares: number }> = {};

      for (const item of data) {
        const m = Array.isArray(item.reel_metrics) ? item.reel_metrics[0] : item.reel_metrics;
        if (!m || !item.key_themes) continue;
        for (const theme of item.key_themes) {
          const t = theme.toLowerCase().trim();
          if (!themeStats[t]) {
            themeStats[t] = { count: 0, totalSaves: 0, totalViews: 0, totalShares: 0 };
          }
          themeStats[t].count++;
          themeStats[t].totalSaves += m.saves || 0;
          themeStats[t].totalViews += m.views || 0;
          themeStats[t].totalShares += m.shares || 0;
        }
      }

      const analysis = Object.entries(themeStats)
        .map(([theme, s]) => ({
          theme,
          clipCount: s.count,
          avgSaves: Math.round(s.totalSaves / s.count),
          avgSaveRate: s.totalViews > 0 ? `${((s.totalSaves / s.totalViews) * 100).toFixed(2)}%` : "N/A",
          avgShares: Math.round(s.totalShares / s.count),
        }))
        .sort((a, b) => b.avgSaves - a.avgSaves);

      return {
        analyzedThemesCount: analysis.length,
        ranking: analysis,
      };
    } catch (err: unknown) {
      return { error: String(err) };
    }
  }

  if (name === "send_to_newsletter_draft") {
    const reelId = String(args.reel_id || "");
    const customAngle = args.custom_angle ? String(args.custom_angle) : undefined;

    if (!reelId) return { error: "reel_id is required" };

    try {
      const { data: reel, error } = await supabase
        .from("reels")
        .select("id, transcript, summary, caption")
        .eq("id", reelId)
        .single();

      if (error || !reel) {
        return { error: `Reel #${reelId} not found in Supabase: ${error?.message}` };
      }

      // Generate the newsletter draft from transcript
      const draftInput = await writeNewsletter(
        customAngle ? `${reel.transcript}\n\nEditorial Angle Instruction: Focus specifically on: ${customAngle}` : reel.transcript
      );

      // Create a job in SQLite store so it opens in the Dose Engine human-in-the-loop drawer
      const assetId = `reel-${reel.id}`;
      const filename = `reel-${reel.id}.mp4`;
      const { job } = store.createJob({
        assetId,
        filename,
        mediaType: "video/mp4",
        sample: false,
      });

      store.setTranscript(job.id, reel.transcript, "Supabase Reel Archive", "en");
      store.setJob(job.id, "drafting");
      const savedDraft = store.saveDraft(job.id, {
        ...draftInput,
        recipientEmail: env("DEMO_RECIPIENT_EMAIL") || undefined,
      });
      store.setJob(job.id, "ready_for_review");

      return {
        success: true,
        jobId: job.id,
        reelId: reel.id,
        subject: savedDraft.subject,
        headline: savedDraft.headline,
        previewText: savedDraft.previewText,
        message: `Newsletter draft created successfully for Reel #${reel.id}! It is now waiting in the review drawer for human approval.`,
      };
    } catch (err: unknown) {
      return { error: `Failed to create draft: ${err instanceof Error ? err.message : String(err)}` };
    }
  }

  return { error: `Unknown tool: ${name}` };
}
