// Scripted mock model: adapts to whatever document the client sends by
// extracting $-suffixed block ids from the injected document state, then
// issuing two "update" operations. Lets the full AI state machine
// (thinking -> ai-writing -> user-reviewing -> accept/revert) run without a
// real model — used in the packaged app when no provider is configured,
// and in web-dev mode.
export async function buildMockModel(args: {
  toolDefinitions: any;
  messages?: any;
}) {
  const { toolDefinitions, messages } = args;
  const { MockLanguageModelV3, simulateReadableStream } = await import("ai/test");
  const toolName = Object.keys(toolDefinitions ?? {})[0] ?? "operations";
  const def = toolDefinitions?.[toolName];
  const wrap = (ops: any[]) =>
    def?.inputSchema?.properties?.operations ? { operations: ops } : ops;

  const ids = extractBlockIds(messages);
  const ops: any[] = [];
  if (ids[0]) {
    ops.push({
      type: "update",
      id: ids[0],
      block:
        "<p>✨（AI 演示模式改写）这一段由 zpaper 内置的演示模型改写：配置你的大模型后，这里将是真实 AI 的润色、续写与改写结果。</p>",
    });
  }
  if (ids[1]) {
    ops.push({
      type: "update",
      id: ids[1],
      block:
        "<p>🤖（AI 演示模式改写）打开右上角「设置」接入 GLM / DeepSeek / Kimi / OpenAI 等任意大模型后即可开始真实创作。</p>",
    });
  }
  const payload = wrap(ops);

  return new MockLanguageModelV3({
    doStream: async () => ({
      stream: simulateReadableStream({
        initialDelayInMs: 600,
        chunkDelayInMs: 120,
        chunks: [
          { type: "stream-start", warnings: [] },
          { type: "tool-input-start", id: "tc1", toolName },
          { type: "tool-input-delta", id: "tc1", delta: JSON.stringify(payload) },
          { type: "tool-input-end", id: "tc1" },
          { type: "tool-call", toolCallId: "tc1", toolName, input: JSON.stringify(payload) },
          {
            type: "finish",
            finishReason: "tool-calls",
            usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
          },
        ],
      }),
    }),
  });
}

// The AI extension runs in suggestion mode, where operation ids carry a "$"
// suffix. The injected document state in the message metadata contains those
// suffixed ids — pull them out for any document the user happens to have open.
export function extractBlockIds(messages: any): string[] {
  if (!messages) return [];
  const s = JSON.stringify(messages);
  const found = new Set<string>();
  for (const m of s.matchAll(/"([A-Za-z0-9_-]+)\$"/g)) found.add(m[1] + "$");
  return [...found].slice(0, 4);
}
