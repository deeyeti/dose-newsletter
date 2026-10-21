import { geminiKey, anthropicKey, env } from "@/lib/env";
import { ASSISTANT_TOOLS, executeTool, ToolDefinition } from "@/lib/assistant/tools";

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

function convertToolsToGemini(tools: ToolDefinition[]) {
  return [{
    function_declarations: tools.map((t) => ({
      name: t.name,
      description: t.description,
      parameters: {
        type: "OBJECT",
        properties: Object.fromEntries(
          Object.entries(t.parameters.properties).map(([k, v]: [string, any]) => [
            k,
            {
              type: v.type?.toUpperCase() || "STRING",
              description: v.description,
              ...(v.enum ? { enum: v.enum } : {}),
            },
          ])
        ),
        ...(t.parameters.required ? { required: t.parameters.required } : {}),
      },
    })),
  }];
}

/**
 * Claude Opus 5.5 Agent with Anthropic tool calling
 */
async function runClaudeAgent(messages: ChatMessage[]): Promise<AssistantResponse> {
  const key = anthropicKey();
  if (!key) throw new Error("Anthropic API key is not configured.");
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

/**
 * Fallback Gemini Agent
 */
async function runGeminiAgent(messages: ChatMessage[]): Promise<AssistantResponse> {
  const key = geminiKey();
  if (!key) throw new Error("Gemini API key is not configured.");
  const tools = convertToolsToGemini(ASSISTANT_TOOLS);

  const contents: any[] = messages
    .filter((m) => m.role !== "system")
    .map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));

  if (contents.length === 0) {
    contents.push({ role: "user", parts: [{ text: "Hello" }] });
  }

  const executedToolCalls: Array<{ name: string; args: any; result: any }> = [];
  let createdDraftInfo: AssistantResponse["createdDraft"] | undefined;

  const candidateModels = [
    env("GEMINI_MODEL") || "gemini-2.5-flash",
    "gemini-3.8-flash",
    "gemini-3.5-flash",
    "gemini-3.5-flash-lite",
  ];
  let activeModelIndex = 0;

  for (let round = 0; round < 4; round++) {
    const payload = {
      system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents,
      tools,
      generationConfig: {
        temperature: 0.3,
      },
    };

    let res: Response | null = null;
    let data: any = null;

    while (activeModelIndex < candidateModels.length) {
      const currentModel = candidateModels[activeModelIndex];
      const modelUrl = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(currentModel)}:generateContent?key=${encodeURIComponent(key)}`;

      res = await fetch(modelUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok && activeModelIndex + 1 < candidateModels.length) {
        console.warn(`[Gemini Agent] Model ${currentModel} returned ${res.status}. Failing over to ${candidateModels[activeModelIndex + 1]}...`);
        activeModelIndex++;
        await new Promise((resolve) => setTimeout(resolve, 300));
        continue;
      }
      break;
    }

    if (!res || !res.ok) {
      const errText = await res?.text().catch(() => "") || "";
      if (res?.status === 429) {
        throw new Error("Rate limit reached on Gemini free tier. Please wait 30 seconds and retry.");
      }
      throw new Error(`Gemini agent failed (${res?.status}): ${errText}`);
    }

    data = await res.json();

    const candidate = data.candidates?.[0];
    if (!candidate?.content) {
      throw new Error("Gemini returned empty candidate content.");
    }

    const modelContent = candidate.content;
    const parts = modelContent.parts || [];

    const fnPart = parts.find((p: any) => p.functionCall);
    if (!fnPart?.functionCall) {
      const textParts = parts.filter((p: any) => p.text).map((p: any) => p.text).join("\n\n");
      return {
        message: textParts || "I've reviewed the archive for you.",
        toolCalls: executedToolCalls.length > 0 ? executedToolCalls : undefined,
        createdDraft: createdDraftInfo,
      };
    }

    const call = fnPart.functionCall;
    const toolName = call.name;
    const toolArgs = call.args || {};

    let toolResult: any;
    try {
      toolResult = await executeTool(toolName, toolArgs);
    } catch (err: unknown) {
      toolResult = { error: String(err) };
    }

    executedToolCalls.push({
      name: toolName,
      args: toolArgs,
      result: toolResult,
    });

    if (toolName === "send_to_newsletter_draft" && toolResult?.success && toolResult?.jobId) {
      createdDraftInfo = {
        jobId: toolResult.jobId,
        reelId: toolResult.reelId,
        subject: toolResult.subject,
        headline: toolResult.headline,
      };
    }

    contents.push(modelContent);
    contents.push({
      role: "user",
      parts: [
        {
          functionResponse: {
            name: toolName,
            response: { result: toolResult },
          },
        },
      ],
    });
  }

  return {
    message: "Completed search and analysis.",
    toolCalls: executedToolCalls,
    createdDraft: createdDraftInfo,
  };
}

export async function askAssistant(messages: ChatMessage[]): Promise<AssistantResponse> {
  // Primary: Claude Opus 5.5
  if (anthropicKey()) {
    try {
      return await runClaudeAgent(messages);
    } catch (err: unknown) {
      console.warn("Claude agent failed, checking Gemini fallback:", err);
      if (geminiKey()) {
        return await runGeminiAgent(messages);
      }
      throw err;
    }
  }

  // Fallback: Gemini
  if (geminiKey()) {
    return runGeminiAgent(messages);
  }

  throw new Error("No AI provider configured for the Assistant. Please set ANTHROPIC_API_KEY.");
}
