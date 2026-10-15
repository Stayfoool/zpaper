// 文档编辑 pane 的真实模型 transport：把 xl-ai 的工具调用协议桥接到
// ZCode agent runtime 的 workspace/generateText —— 凭证与账号层完全复用
// 宿主现有通道（与 Git 提交消息生成同一底座），渲染端不经手任何 API key。
// 消息侧复用 @blocknote/xl-ai/server 的文档状态注入，再适配到
// ZCodeWorkspaceModelMessage 协议（strict 字段，见 @zcode/shared）。
import type { ChatTransport, UIMessage, UIMessageChunk } from "ai";
import { convertToModelMessages } from "ai";
import { injectDocumentStateMessages } from "@blocknote/xl-ai/server";

/** @zcode/shared 协议的模型消息子集（zcode-protocol/index.ts）。 */
type ProtocolModelMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; toolCalls?: { id: string; name: string; input: unknown }[] }
  | { role: "tool"; content: string; toolCallId: string; toolName: string };

type ProtocolTool = { name: string; description?: string; inputSchema: Record<string, unknown> };

export type DocEditAgentBridge = {
  generateWorkspaceText: (params: {
    workspacePath: string;
    workspaceKey: string;
    workspaceIdentity?: string;
    selection: { providerId: string; modelId: string; options?: Record<string, unknown> };
    messages?: ProtocolModelMessage[];
    tools?: ProtocolTool[];
    querySource: string;
    maxOutputTokens?: number;
    requestTimeoutMs?: number;
  }) => Promise<{
    text: string;
    toolCalls?: { id: string; name: string; input: unknown }[];
    finishReason?: string;
  }>;
  readPreferredSelection: () => Promise<{
    providerId: string;
    modelId: string;
    options?: Record<string, unknown>;
  } | null>;
};

const QUERY_SOURCE = "doc_edit_pane";
const MAX_OUTPUT_TOKENS = 8192;
const REQUEST_TIMEOUT_MS = 5 * 60_000;

/** ai sdk ModelMessage → 协议消息：content 一律压平为纯文本。 */
function toProtocolMessage(message: any): ProtocolModelMessage | null {
  const text = flattenContent(message?.content);
  switch (message?.role) {
    case "system":
      return { role: "system", content: text };
    case "user":
      return { role: "user", content: text };
    case "assistant": {
      const toolCalls = Array.isArray(message.toolCalls)
        ? message.toolCalls
            .filter((tc: any) => typeof tc?.toolCallId === "string" && typeof tc?.toolName === "string")
            .map((tc: any) => ({ id: tc.toolCallId, name: tc.toolName, input: tc.input ?? {} }))
        : undefined;
      return {
        role: "assistant",
        content: text,
        ...(toolCalls && toolCalls.length > 0 ? { toolCalls } : {}),
      };
    }
    case "tool":
      return typeof message?.toolCallId === "string"
        ? {
            role: "tool",
            content: text,
            toolCallId: message.toolCallId,
            toolName: typeof message.toolName === "string" ? message.toolName : "unknown",
          }
        : null;
    default:
      return null;
  }
}

function flattenContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const part of content) {
    if (typeof part === "string") parts.push(part);
    else if (part?.type === "text" && typeof part.text === "string") parts.push(part.text);
    else if (part?.type === "tool-result") {
      // 工具结果压成短文本，保证协议 strict content(string) 可传输
      parts.push(`[tool result ${part.toolName ?? part.toolCallId ?? ""}]`);
    }
    // 图片等不可文本化的 part：一期文档编辑通道不支持，静默丢弃
  }
  return parts.join("\n").trim();
}

function extractTools(body: unknown): ProtocolTool[] {
  const defs = (body as { toolDefinitions?: Record<string, any> } | undefined)?.toolDefinitions;
  if (!defs || typeof defs !== "object") return [];
  return Object.entries(defs)
    .filter(([, def]) => def && typeof def === "object")
    .map(([name, def]) => ({
      name,
      ...(typeof def.description === "string" ? { description: def.description } : {}),
      inputSchema:
        def.inputSchema && typeof def.inputSchema === "object"
          ? (def.inputSchema as Record<string, unknown>)
          : { type: "object", properties: {} },
    }));
}

export function createAgentDocEditTransport(
  bridge: DocEditAgentBridge,
  workspace: { path: string; key: string; identity?: string },
): ChatTransport<UIMessage> {
  const sendMessages = async (
    options: {
      messages: UIMessage[];
      abortSignal?: AbortSignal;
      body?: unknown;
    } & Record<string, unknown>,
  ): Promise<ReadableStream<UIMessageChunk>> => {
    const selection = await bridge.readPreferredSelection();
    if (!selection) {
      throw new Error("未读取到当前模型（请先在 ZCode 中选择模型）");
    }
    const tools = extractTools(options.body);
    // xl-ai 把文档当前状态注入消息元数据；先走它的注入器，再转协议消息
    const injected = injectDocumentStateMessages(options.messages);
    const modelMessages = await convertToModelMessages(injected as UIMessage[]);
    const protocolMessages = modelMessages
      .map(toProtocolMessage)
      .filter((m): m is ProtocolModelMessage => m !== null);

    const result = await bridge.generateWorkspaceText({
      workspacePath: workspace.path,
      workspaceKey: workspace.key,
      ...(workspace.identity ? { workspaceIdentity: workspace.identity } : {}),
      selection: {
        providerId: selection.providerId,
        modelId: selection.modelId,
        ...(selection.options ? { options: selection.options } : {}),
      },
      messages: protocolMessages,
      ...(tools.length > 0 ? { tools } : {}),
      querySource: QUERY_SOURCE,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      requestTimeoutMs: REQUEST_TIMEOUT_MS,
    });

    const chunks: UIMessageChunk[] = [{ type: "start" }, { type: "start-step" }];
    const calls = result.toolCalls ?? [];
    if (calls.length > 0) {
      for (const call of calls) {
        chunks.push({ type: "tool-input-start", toolCallId: call.id, toolName: call.name });
        chunks.push({
          type: "tool-input-delta",
          toolCallId: call.id,
          inputTextDelta: JSON.stringify(call.input ?? {}),
        });
        chunks.push({
          type: "tool-input-available",
          toolCallId: call.id,
          toolName: call.name,
          input: call.input ?? {},
        });
      }
    } else if (result.text) {
      chunks.push({ type: "text-start", id: "docedit-text-1" });
      chunks.push({ type: "text-delta", id: "docedit-text-1", delta: result.text });
      chunks.push({ type: "text-end", id: "docedit-text-1" });
    }
    chunks.push({ type: "finish-step" });
    chunks.push({
      type: "finish",
      finishReason: calls.length > 0 ? "tool-calls" : "stop",
    });

    return new ReadableStream<UIMessageChunk>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk);
        controller.close();
      },
    });
  };

  return {
    sendMessages: sendMessages as ChatTransport<UIMessage>["sendMessages"],
    reconnectToStream: () => Promise.resolve(null),
  };
}
