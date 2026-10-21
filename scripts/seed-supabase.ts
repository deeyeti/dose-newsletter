import { getSupabase } from "../lib/supabase";
import { generateEmbedding, chunkTranscript } from "../lib/assistant/embeddings";

const SAMPLE_REELS = [
  {
    id: "dose-84920",
    permalink: "https://www.instagram.com/reel/C84920dose",
    thumbnail_url: "https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&w=400&q=80",
    caption: "“I never asked her who she was before us.” On mending coats, old watches, and the quiet dreams our parents kept to themselves. #DoseOfSociety #HumanStories",
    published_at: "2026-03-12T14:30:00Z",
    summary: "A coat mender reflects on discovering his late mother's hidden passion for the cello and realizing our parents lived whole lives before having us.",
    key_themes: ["family", "grief", "regret", "kindness"],
    transcript: "I realized after my mom passed that I never asked her who she was before us. You spend your whole life seeing your parents as these permanent fixtures, like walls in a house. But she had dreams. She wanted to play the cello. She told me once she played until her hands couldn't take it anymore. And now every time I mend someone's coat or fix an old watch, I wonder what dreams got tucked away in the pockets.",
    metrics: {
      views: 384000,
      likes: 29500,
      comments: 1420,
      shares: 42100,
      saves: 16400,
    },
  },
  {
    id: "dose-71402",
    permalink: "https://www.instagram.com/reel/C71402dose",
    thumbnail_url: "https://images.unsplash.com/photo-1509099836639-18ba1795216d?auto=format&fit=crop&w=400&q=80",
    caption: "“You just dance a little slower so the music lasts longer.” 92-year-old dancer on losing her partner and choosing joy. #DoseOfSociety",
    published_at: "2026-03-24T18:00:00Z",
    summary: "A 92-year-old woman shares why dancing alone in her living room after her husband's passing is an act of honoring fifty years of shared joy.",
    key_themes: ["aging", "joy", "resilience", "grief"],
    transcript: "People tell you that getting older means giving things up. That's nonsense. You just dance a little slower so the music lasts longer. When my husband died twenty years ago, the silence in the living room was deafening. So I put on Benny Goodman and danced by myself. It wasn't sad. It was saying: we had fifty years of joy, and I am not giving that back to the darkness.",
    metrics: {
      views: 512000,
      likes: 44100,
      comments: 2310,
      shares: 38900,
      saves: 14800,
    },
  },
  {
    id: "dose-63119",
    permalink: "https://www.instagram.com/reel/C63119dose",
    thumbnail_url: "https://images.unsplash.com/photo-1509440159596-0249088772ff?auto=format&fit=crop&w=400&q=80",
    caption: "“Bread is the first thing someone eats before a difficult day.” A second-generation baker on quiet dignity. #DoseOfSociety",
    published_at: "2026-02-18T10:15:00Z",
    summary: "A baker in Naples explains why giving yesterday's loaves with dignity quietly heals a neighborhood.",
    key_themes: ["tradition", "food", "family", "kindness"],
    transcript: "My father woke up at 3:30 AM every day for forty-four years. He always said, bread isn't just flour and water; it's the first thing someone eats before they go out to face a difficult day. If the bread is made with love, maybe their morning won't be as heavy. That's why we give the yesterday loaves to whoever knocks quietly on the back door. Dignity costs nothing.",
    metrics: {
      views: 275000,
      likes: 19800,
      comments: 890,
      shares: 18200,
      saves: 9100,
    },
  },
  {
    id: "dose-59821",
    permalink: "https://www.instagram.com/reel/C59821dose",
    thumbnail_url: "https://images.unsplash.com/photo-1507679799987-c73779587ccf?auto=format&fit=crop&w=400&q=80",
    caption: "“Golden handcuffs are still handcuffs.” Leaving high finance to teach kids in inner-city schools. #DoseOfSociety",
    published_at: "2026-01-29T16:45:00Z",
    summary: "A former investment banker recalls leaving half a million a year to teach kids to code, and finally earning his father's true respect.",
    key_themes: ["money", "regret", "career", "purpose", "family"],
    transcript: "I was twenty-eight making half a million dollars a year, and I couldn't look in the mirror without feeling like a fraud. Everyone tells you money buys freedom. What they don't tell you is that golden handcuffs are still handcuffs. The day I resigned, my father yelled at me. Three years later, seeing me teach underprivileged kids how to code, he cried and told me he had never been prouder. Don't trade your peace for someone else's definition of success.",
    metrics: {
      views: 420000,
      likes: 31200,
      comments: 1950,
      shares: 28400,
      saves: 12300,
    },
  },
  {
    id: "dose-91234",
    permalink: "https://www.instagram.com/reel/C91234dose",
    thumbnail_url: "https://images.unsplash.com/photo-1579684385127-1ef15d508118?auto=format&fit=crop&w=400&q=80",
    caption: "“In the ICU at 3 AM, nobody asks about their stock portfolio.” Night shift nurse on the questions that truly matter. #DoseOfSociety",
    published_at: "2026-04-05T21:00:00Z",
    summary: "An intensive care nurse reveals the only two questions people ask at the very end of life, and why she holds the hands of those who are alone.",
    key_themes: ["death", "compassion", "humanity", "loneliness", "love"],
    transcript: "In the ICU at 3 AM, nobody asks about their stock portfolio. Nobody asks what car they drove. They hold your hand and ask: 'Did I love enough? Was I kind?' That is why I hold the hands of people whose families couldn't make it in time. No human being should leave this earth without another human touching their shoulder and saying: 'You did well. Rest now.'",
    metrics: {
      views: 680000,
      likes: 58000,
      comments: 3400,
      shares: 62000,
      saves: 24500,
    },
  },
];

export async function seedSupabaseArchive() {
  const supabase = getSupabase();
  console.log("Starting Supabase archive seed...");

  for (const item of SAMPLE_REELS) {
    console.log(`Processing Reel: ${item.id} (${item.summary})`);

    // 1. Upsert Reel
    const { error: reelErr } = await supabase.from("reels").upsert({
      id: item.id,
      permalink: item.permalink,
      thumbnail_url: item.thumbnail_url,
      caption: item.caption,
      published_at: item.published_at,
      transcript: item.transcript,
      summary: item.summary,
      key_themes: item.key_themes,
    });

    if (reelErr) {
      console.error(`Failed to upsert reel ${item.id}:`, reelErr.message);
      continue;
    }

    // 2. Insert Reel Metrics
    const { error: metricErr } = await supabase.from("reel_metrics").insert({
      reel_id: item.id,
      views: item.metrics.views,
      likes: item.metrics.likes,
      comments: item.metrics.comments,
      shares: item.metrics.shares,
      saves: item.metrics.saves,
    });

    if (metricErr) {
      console.warn(`Metric insert note for ${item.id}:`, metricErr.message);
    }

    // 3. Chunk transcript and generate embeddings
    const chunks = chunkTranscript(item.transcript, 40);
    console.log(`Generating embeddings for ${chunks.length} chunks...`);

    for (const chunk of chunks) {
      try {
        const embedding = await generateEmbedding(chunk.chunkText);
        const { error: embErr } = await supabase.from("reel_embeddings").insert({
          reel_id: item.id,
          chunk_text: chunk.chunkText,
          speaker_timestamp: chunk.speakerTimestamp,
          embedding,
        });

        if (embErr) {
          console.warn(`Embedding insert error for chunk:`, embErr.message);
        }
      } catch (err: unknown) {
        console.error(`Embedding generation failed for chunk:`, err);
      }
    }
  }

  console.log("✅ Supabase seeding completed!");
}

if (process.argv[1]?.endsWith("seed-supabase.ts")) {
  seedSupabaseArchive().catch(console.error);
}
