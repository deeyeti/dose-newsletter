import { anthropicKey, env } from "@/lib/env";
import { ASSISTANT_TOOLS, executeTool } from "@/lib/assistant/tools";

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface AssistantResponse {
  message: string;
  toolCalls?: Array<{
    name: string;
    args: Record<string, unknown>;
    result: unknown;
  }>;
  createdDraft?: {
    jobId: string;
    reelId: string;
    subject: string;
    headline: string;
  };
}

const SYSTEM_PROMPT = `You are the Dose of Society AI Editorial Assistant.
Your purpose is to help the newsletter editorial team find the most resonant stories from the archive of published street interviews and audience engagement metrics (Instagram Reels views, shares, saves, engagement rates).

Your Core Responsibilities:
1. Always ground your editorial recommendations in real audience resonance — prioritizing 'saves' and 'shares' as the most truthful signals of emotional depth and human connection.
2. When answering, cite specific Reel IDs, exact verbatim quotes from the transcripts, timestamps, and save/share counts.
3. When the editor wants to turn a clip into a newsletter, use the \`send_to_newsletter_draft\` tool to generate the draft and send it to the review drawer.
4. Support both English and Arabic queries. If the user asks in Arabic, respond in Arabic.
5. Keep your tone warm, insightful, literary, and editorially astute. Avoid generic corporate fluff.
6. When referencing a clip that was drafted, provide a clear indication that it is ready for human approval.`;

/**
 * Claude Opus 5.5 Agent with Anthropic tool calling
 */
async function runClaudeAgent(messages: ChatMessage[]): Promise<AssistantResponse> {
  const key = anthropicKey();
  if (!key) throw new Error("Anthropic API key is not configured. Set ANTHROPIC_API_KEY.");
  const model = env("CLAUDE_MODEL") || "claude-opus-5-5";
  const workspaceId = env("ANTHROPIC_WORKSPACE_ID") || env("anthropic_workspace_id");

  const reqHeaders: Record<string, string> = {
    "x-api-key": key,
    "anthropic-version": "2023-06-01",
    "content-type": "application/json",
  };
  if (workspaceId) {
    reqHeaders["anthropic-workspace-id"] = workspaceId;
  }

  const tools = ASSISTANT_TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: {
      type: "object",
      properties: t.parameters.properties,
      ...(t.parameters.required ? { required: t.parameters.required } : {}),
    },
  }));

  const anthropicMessages: any[] = messages
    .filter((m) => m.role !== "system")
    .map((m) => ({
      role: m.role,
      content: m.content,
    }));

  if (anthropicMessages.length === 0) {
    anthropicMessages.push({ role: "user", content: "Hello" });
  }

  const executedToolCalls: Array<{ name: string; args: any; result: any }> = [];
  let createdDraftInfo: AssistantResponse["createdDraft"] | undefined;

  // Multi-turn tool calling loop (up to 5 rounds)
  for (let round = 0; round < 5; round++) {
    const payload = {
      model,
      max_tokens: 2500,
      temperature: 0.2,
      system: SYSTEM_PROMPT,
      tools,
      messages: anthropicMessages,
    };

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: reqHeaders,
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`Claude agent failed (${res.status}): ${errText}`);
    }

    const data = await res.json();
    const content = data.content || [];

    // Check for tool_use blocks
    const toolUseBlocks = content.filter((part: any) => part.type === "tool_use");

    if (toolUseBlocks.length === 0) {
      const textParts = content
        .filter((part: any) => part.type === "text")
        .map((part: any) => part.text)
        .join("\n\n");

      return {
        message: textParts || "I've reviewed the archive for you.",
        toolCalls: executedToolCalls.length > 0 ? executedToolCalls : undefined,
        createdDraft: createdDraftInfo,
      };
    }

    // Append assistant's response to history
    anthropicMessages.push({
      role: "assistant",
      content,
    });

    // Execute each tool call and prepare tool_result blocks
    const toolResultBlocks: any[] = [];
    for (const toolUse of toolUseBlocks) {
      let toolResult: any;
      try {
        toolResult = await executeTool(toolUse.name, toolUse.input || {});
      } catch (err: unknown) {
        toolResult = { error: String(err) };
      }

      executedToolCalls.push({
        name: toolUse.name,
        args: toolUse.input || {},
        result: toolResult,
      });

      if (toolUse.name === "send_to_newsletter_draft" && toolResult?.success && toolResult?.jobId) {
        createdDraftInfo = {
          jobId: toolResult.jobId,
          reelId: toolResult.reelId,
          subject: toolResult.subject,
          headline: toolResult.headline,
        };
      }

      toolResultBlocks.push({
        type: "tool_result",
        tool_use_id: toolUse.id,
        content: JSON.stringify(toolResult),
      });
    }

    // Feed tool results back to Claude
    anthropicMessages.push({
      role: "user",
      content: toolResultBlocks,
    });
  }

  return {
    message: "Completed search and analysis.",
    toolCalls: executedToolCalls,
    createdDraft: createdDraftInfo,
  };
}

export async function askAssistant(messages: ChatMessage[]): Promise<AssistantResponse> {
  return runClaudeAgent(messages);
}
