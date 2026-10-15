// 演示用 AI transport：不依赖任何模型 API，直接在 transport 层伪造一次
// xl-ai 工具调用（改写文档前两个块），让「选中 → AI 编辑 → 审查态」的完整
// 交互在无 key 环境可演示。真实模型通道接入后整体替换此文件即可。
// 数据形状对照 packages/client 侧 ai@6 的 ChatTransport / UIMessageChunk。
import type { ChatTransport, UIMessage, UIMessageChunk } from "ai";

const DEMO_TOOL_CALL_ID = "docedit-demo-1";

/** 从请求里提取工具名（xl-ai 会把 toolDefinitions 注入 body）。 */
function readToolName(options: Record<string, unknown>): string {
  try {
    const body = options.body as { toolDefinitions?: Record<string, unknown> } | undefined;
    const name = Object.keys(body?.toolDefinitions ?? {})[0];
    if (name) return name;
  } catch {
    /* fall through */
  }
  return "applyDocumentOperations";
}

/** xl-ai 把打开文档的块 id（带 $ 后缀）注入消息元数据，取出前两个。 */
function extractBlockIds(options: Record<string, unknown>): string[] {
  try {
    const found = new Set<string>();
    for (const m of JSON.stringify(options.messages ?? []).matchAll(
      /"([A-Za-z0-9_-]+)\$"/g,
    )) {
      found.add(m[1] + "$");
    }
    return [...found].slice(0, 2);
  } catch {
    return [];
  }
}

function buildOperationsPayload(options: Record<string, unknown>): unknown {
  const ids = extractBlockIds(options);
  const operations = ids.map((id, index) => ({
    type: "update",
    id,
    block:
      index === 0
        ? "<p>✨（演示模型改写）这一段由内置演示 transport 改写：接入真实模型后，这里将是 AI 的润色与改写结果。</p>"
        : "<p>🤖（演示模型改写）选中任意文字 → 工具栏「AI 编辑」即可让 AI 就地修改，改动会以修订高亮呈现。</p>",
  }));
  // 若工具入参带 operations 包装则保持一致（与真实 xl-ai 工具 schema 对齐）
  const body = options.body as
    | { toolDefinitions?: Record<string, { inputSchema?: { properties?: Record<string, unknown> } }> }
    | undefined;
  const def = body?.toolDefinitions?.[readToolName(options)];
  return def?.inputSchema?.properties?.operations ? { operations } : operations;
}

export function createDemoDocEditTransport(): ChatTransport<UIMessage> {
  const sendMessages = (
    options: Record<string, unknown> & { abortSignal?: AbortSignal },
  ): Promise<ReadableStream<UIMessageChunk>> => {
    const toolName = readToolName(options);
    const payload = buildOperationsPayload(options);
    const stream = new ReadableStream<UIMessageChunk>({
      start(controller) {
        const chunks: UIMessageChunk[] = [
          { type: "start" },
          { type: "start-step" },
          { type: "tool-input-start", toolCallId: DEMO_TOOL_CALL_ID, toolName },
          {
            type: "tool-input-delta",
            toolCallId: DEMO_TOOL_CALL_ID,
            inputTextDelta: JSON.stringify(payload),
          },
          {
            type: "tool-input-available",
            toolCallId: DEMO_TOOL_CALL_ID,
            toolName,
            input: payload,
          },
          { type: "finish-step" },
          { type: "finish", finishReason: "tool-calls" },
        ];
        let index = 0;
        const tick = () => {
          if (options.abortSignal?.aborted) {
            controller.close();
            return;
          }
          if (index >= chunks.length) {
            controller.close();
            return;
          }
          controller.enqueue(chunks[index++]!);
          setTimeout(tick, 120);
        };
        setTimeout(tick, 400);
      },
    });
    return Promise.resolve(stream);
  };

  return {
    sendMessages: sendMessages as ChatTransport<UIMessage>["sendMessages"],
    reconnectToStream: () => Promise.resolve(null),
  };
}
