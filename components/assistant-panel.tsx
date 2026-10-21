"use client";
import { useState, useRef, useEffect, useCallback } from "react";

export interface ToolCallExecution {
  name: string;
  args: Record<string, unknown>;
  result: any;
}

export interface AssistantMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  toolCalls?: ToolCallExecution[];
  createdDraft?: {
    jobId: string;
    reelId: string;
    subject: string;
    headline: string;
  };
}

const SUGGESTIONS = {
  en: [
    "What were our top 3 most-saved clips?",
    "Find the strongest quotes on grief and loss",
    "What themes are landing hardest right now?",
    "Draft this week's issue from our highest-performing clip",
  ],
  ar: [
    "ما هي المقاطع الثلاثة الأكثر حفظاً؟",
    "ابحث عن أقوى الاقتباسات عن الحزن والفقد",
    "ما هي الموضوعات الأكثر تأثيراً حالياً؟",
    "صِغ نشرة هذا الأسبوع من المقطع الأكثر انتشاراً",
  ],
};

const I18N = {
  en: {
    title: "Dose AI Assistant",
    subtitle: "Query published interviews, engagement metrics & semantic quotes",
    placeholder: "Ask about story themes, top saves, or request a draft...",
    send: "Send",
    thinking: "Analyzing archive & metrics…",
    suggestionsTitle: "Suggested editorial queries",
    openDraft: "Open Draft in Review Drawer",
    close: "Close",
    draftReady: "✨ Draft ready for review:",
    toolMetric: "Archive Sorted by",
    toolSemantic: "Semantic Quote Match:",
    toolThemes: "Audience Resonance Analysis",
    toolDraft: "Newsletter Draft Created",
    similarity: "similarity",
    saves: "saves",
    shares: "shares",
    errorNotice: "Something went wrong. Please check your Supabase connection and try again.",
    schemaHintTitle: "Supabase Tables Needed",
    schemaHintText: "The Supabase database has not been initialized with the reels schema yet. Run db/supabase_migration.sql in the Supabase SQL Editor, then run the seed script.",
  },
  ar: {
    title: "المساعد التحريري الذكي",
    subtitle: "البحث في المقابلات المنشورة، مقاييس التفاعل والاقتباسات الدلالية",
    placeholder: "اسأل عن موضوعات القصص، المقاطع الأكثر حفظاً، أو اطلب مسودة...",
    send: "إرسال",
    thinking: "جاري تحليل الأرشيف ومقاييس التفاعل…",
    suggestionsTitle: "أسئلة تحريرية مقترحة",
    openDraft: "فتح المسودة في درج المراجعة",
    close: "إغلاق",
    draftReady: "✨ المسودة جاهزة للمراجعة:",
    toolMetric: "الأرشيف مرتب بحسب",
    toolSemantic: "تطابق اقتباس دلالي:",
    toolThemes: "تحليل تجاوب الجمهور مع الموضوعات",
    toolDraft: "تم إنشاء مسودة النشرة البريدية",
    similarity: "تطابق",
    saves: "حفظ",
    shares: "مشاركة",
    errorNotice: "حدث خطأ. يرجى التحقق من اتصال Supabase والمحاولة مجدداً.",
    schemaHintTitle: "مطلوب إعداد جداول Supabase",
    schemaHintText: "لم يتم إنشاء جداول المقابلات في قاعدة بيانات Supabase بعد. قم بتشغيل db/supabase_migration.sql في محرر SQL بـ Supabase، ثم قم بتشغيل سكريبت البيانات الأولية.",
  },
};

export function AssistantPanel({
  open,
  onClose,
  onOpenDraft,
  lang,
}: {
  open: boolean;
  onClose: () => void;
  onOpenDraft: (jobId: string) => void;
  lang: "en" | "ar";
}) {
  const t = I18N[lang];
  const initialGreeting: AssistantMessage = {
    id: "greeting",
    role: "assistant",
    content:
      lang === "ar"
        ? "أهلاً بك! أنا المساعد التحريري الذكي لـ Dose of Society. يمكنني البحث في أرشيف المقابلات بحسب مقاييس التفاعل (الحفظ والمشاركات)، وإجراء بحث دلالي في الاقتباسات، وصياغة مسودة نشرة بريدية مباشرة لأي مقطع تختاره. ما الذي تود استكشافه؟"
        : "Hello! I am your Dose AI Editorial Assistant. I can search our published street interviews by engagement metrics (saves, shares, views), run semantic vector searches for emotional themes, and turn any interview directly into a newsletter draft for your review. What story should we explore today?",
  };

  const [messages, setMessages] = useState<AssistantMessage[]>([initialGreeting]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [showSchemaNotice, setShowSchemaNotice] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = useCallback(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    if (open) {
      scrollToBottom();
    }
  }, [open, messages, loading, scrollToBottom]);

  async function handleSend(textToSend?: string) {
    const text = (textToSend || input).trim();
    if (!text || loading) return;

    const userMsg: AssistantMessage = {
      id: "u-" + Date.now(),
      role: "user",
      content: text,
    };

    const newHistory = [...messages, userMsg];
    setMessages(newHistory);
    setInput("");
    setLoading(true);

    try {
      const res = await fetch("/api/assistant/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: newHistory.map((m) => ({
            role: m.role,
            content: m.content,
          })),
        }),
      });

      const data = await res.json();
      if (!res.ok || data.error) {
        const errMsg = data.error || t.errorNotice;
        if (errMsg.includes("schema cache") || errMsg.includes("migration SQL") || errMsg.includes("Could not find the table")) {
          setShowSchemaNotice(true);
        }
        setMessages((prev) => [
          ...prev,
          {
            id: "err-" + Date.now(),
            role: "assistant",
            content: `⚠️ ${errMsg}`,
          },
        ]);
      } else {
        setShowSchemaNotice(false);
        const assistantMsg: AssistantMessage = {
          id: "a-" + Date.now(),
          role: "assistant",
          content: data.message,
          toolCalls: data.toolCalls,
          createdDraft: data.createdDraft,
        };
        setMessages((prev) => [...prev, assistantMsg]);
      }
    } catch (err: unknown) {
      setMessages((prev) => [
        ...prev,
        {
          id: "err-" + Date.now(),
          role: "assistant",
          content: `⚠️ ${t.errorNotice} (${err instanceof Error ? err.message : String(err)})`,
        },
      ]);
    } finally {
      setLoading(false);
    }
  }

  if (!open) return null;

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} />
      <aside className="drawer assistant-drawer" aria-label={t.title}>
        <div className="drawer-inner assistant-inner">
          {/* Header */}
          <div className="drawer-head assistant-head">
            <div>
              <span className="eyebrow">Dose Intelligence</span>
              <h2>{t.title}</h2>
              <p className="assistant-sub">{t.subtitle}</p>
            </div>
            <button className="icon-btn" onClick={onClose} aria-label={t.close} title={t.close}>
              ✕
            </button>
          </div>

          {/* Schema Notice banner if Supabase tables are needed */}
          {showSchemaNotice && (
            <div className="alert alert-warn assistant-schema-alert">
              <strong>{t.schemaHintTitle}</strong>
              <p>{t.schemaHintText}</p>
              <div style={{ marginTop: "8px" }}>
                <code>db/supabase_migration.sql</code>
              </div>
            </div>
          )}

          {/* Suggestions pills (shown if only initial message) */}
          {messages.length <= 1 && (
            <div className="assistant-suggestions">
              <span className="section-label">{t.suggestionsTitle}</span>
              <div className="assistant-pills">
                {SUGGESTIONS[lang].map((s) => (
                  <button
                    key={s}
                    className="assistant-suggestion-pill"
                    onClick={() => void handleSend(s)}
                    disabled={loading}
                  >
                    💬 {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Messages list */}
          <div className="assistant-messages">
            {messages.map((m) => (
              <div key={m.id} className={`assistant-bubble-row ${m.role}`}>
                <div className={`assistant-bubble ${m.role}`}>
                  <div className="assistant-bubble-meta">
                    <b>{m.role === "assistant" ? "Dose Assistant" : "You"}</b>
                  </div>
                  <div className="assistant-bubble-content">{m.content}</div>

                  {/* Render executed tool badges / cards */}
                  {m.toolCalls && m.toolCalls.length > 0 && (
                    <div className="assistant-tools-container">
                      {m.toolCalls.map((tc, idx) => (
                        <div key={idx} className="assistant-tool-card">
                          <div className="assistant-tool-title">
                            {tc.name === "query_archive_by_metric" && `📊 ${t.toolMetric} ${String(tc.args.metric || "saves").toUpperCase()}`}
                            {tc.name === "semantic_search_quotes" && `🔍 ${t.toolSemantic} “${String(tc.args.query || "")}”`}
                            {tc.name === "analyze_archive_themes" && `📈 ${t.toolThemes}`}
                            {tc.name === "send_to_newsletter_draft" && `✍️ ${t.toolDraft}`}
                          </div>

                          {/* Quick summary of tool results */}
                          {tc.name === "query_archive_by_metric" && Array.isArray(tc.result?.reels) && (
                            <div className="assistant-reel-chips">
                              {tc.result.reels.map((r: any) => (
                                <div key={r.reel_id} className="assistant-reel-chip">
                                  <strong>#{r.reel_id}</strong>
                                  <span>{r.summary || r.caption?.slice(0, 60)}</span>
                                  <small>📌 {r.saves?.toLocaleString()} {t.saves} · ↗ {r.shares?.toLocaleString()} {t.shares}</small>
                                </div>
                              ))}
                            </div>
                          )}

                          {tc.name === "semantic_search_quotes" && Array.isArray(tc.result?.quotes) && (
                            <div className="assistant-quote-chips">
                              {tc.result.quotes.map((q: any, qIdx: number) => (
                                <div key={qIdx} className="assistant-quote-chip">
                                  <em>“{q.quote}”</em>
                                  <div className="assistant-quote-meta">
                                    <span>#{q.reel_id} {q.timestamp ? `(${q.timestamp})` : ""}</span>
                                    <span>📌 {q.saves?.toLocaleString()} {t.saves}</span>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* 1-Click Action to Open Generated Draft */}
                  {m.createdDraft && (
                    <div className="assistant-draft-card">
                      <div className="assistant-draft-card-head">
                        <strong>{t.draftReady}</strong>
                        <span>{m.createdDraft.headline}</span>
                      </div>
                      <p className="assistant-draft-subject">{m.createdDraft.subject}</p>
                      <button
                        className="btn btn-primary btn-sm"
                        onClick={() => {
                          onOpenDraft(m.createdDraft!.jobId);
                          onClose();
                        }}
                      >
                        🚀 {t.openDraft}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}

            {loading && (
              <div className="assistant-bubble-row assistant">
                <div className="assistant-bubble assistant loading">
                  <div className="ai-working">
                    <span className="spinner" />
                    <span>{t.thinking}</span>
                  </div>
                </div>
              </div>
            )}
            <div ref={endRef} />
          </div>

          {/* Input form */}
          <form
            className="assistant-input-bar"
            onSubmit={(e) => {
              e.preventDefault();
              void handleSend();
            }}
          >
            <input
              type="text"
              className="assistant-input"
              placeholder={t.placeholder}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              disabled={loading}
              autoFocus
            />
            <button
              type="submit"
              className="btn btn-primary"
              disabled={loading || !input.trim()}
            >
              {loading ? "…" : t.send}
            </button>
          </form>
        </div>
      </aside>
    </>
  );
}
