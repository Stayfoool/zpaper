// Chat -> document edit plans. The conversation panel's「应用到文档」action
// turns a discussed proposal into a strict JSON edit plan (find/replace/
// insert/delete on block text) which the renderer applies against the live
// editor. The agent-side chat sessions stay plan-mode/read-only; this
// endpoint is the only sanctioned path from chat to document edits.
import { resolveProviderModel } from "./provider";
import { loadSettings } from "./settings";
import { sanitizeDocEditPlan, MAX_PLAN_OPS } from "../shared/docEdits";

const MAX_DOC_CHARS = 30_000;
const MAX_SELECTION_CHARS = 4_000;
const MAX_FREEFORM = 6_000;

export type DocEditBrief = {
  instruction: string;
  proposal?: string;
  docTitle?: string;
  docMarkdown: string;
  docSelection?: string;
};

export async function handleDocEditPlan(req: Request): Promise<Response> {
  try {
    const body: any = await req.json();
    const brief: DocEditBrief = {
      instruction: String(body?.instruction ?? "").slice(0, MAX_FREEFORM),
      proposal: body?.proposal ? String(body.proposal).slice(0, MAX_FREEFORM) : undefined,
      docTitle: body?.docTitle ? String(body.docTitle).slice(0, 200) : undefined,
      docMarkdown: String(body?.docMarkdown ?? "").slice(0, MAX_DOC_CHARS),
      docSelection: body?.docSelection ? String(body.docSelection).slice(0, MAX_SELECTION_CHARS) : undefined,
    };
    if (!brief.instruction.trim()) {
      return new Response(JSON.stringify({ error: "缺少修改指令" }), { status: 400 });
    }

    const plan = await generatePlan(brief);
    return new Response(JSON.stringify({ plan }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  } catch (e) {
    console.error("[zpaper] /doc-edit error:", e);
    return new Response(JSON.stringify({ error: String((e as Error)?.message || e) }), { status: 500 });
  }
}

async function generatePlan(brief: DocEditBrief) {
  if (process.env.ZPAPER_FORCE_MOCK !== "1") {
    const settings = loadSettings();
    const provider = (settings.providers || []).find((p: any) => p.id === settings.activeProviderId);
    if (provider) {
      const plan = await planWithProvider(provider, brief);
      if (plan) return plan;
    }
  }
  return demoPlan(brief);
}

async function planWithProvider(provider: any, brief: DocEditBrief) {
  try {
    const model = await resolveProviderModel(provider);
    const { generateText, tool, jsonSchema } = await import("ai");
    const result = await generateText({
      model,
      system: buildSystemPrompt(),
      prompt: buildUserPrompt(brief),
      tools: {
        applyDocumentEdits: tool({
          description: "提交对文档的具体修改方案。只在确有修改必要时调用。",
          inputSchema: jsonSchema({
            type: "object",
            properties: {
              explanation: { type: "string", description: "一句话说明修改思路" },
              ops: {
                type: "array",
                maxItems: MAX_PLAN_OPS,
                items: {
                  type: "object",
                  oneOf: [
                    {
                      type: "object",
                      properties: {
                        action: { type: "string", const: "replace" },
                        find: { type: "string" },
                        replaceWith: { type: "string" },
                      },
                      required: ["action", "find", "replaceWith"],
                      additionalProperties: false,
                    },
                    {
                      type: "object",
                      properties: {
                        action: { type: "string", const: "insert" },
                        text: { type: "string" },
                        after: { type: "string" },
                      },
                      required: ["action", "text"],
                      additionalProperties: false,
                    },
                    {
                      type: "object",
                      properties: {
                        action: { type: "string", const: "delete" },
                        find: { type: "string" },
                      },
                      required: ["action", "find"],
                      additionalProperties: false,
                    },
                  ],
                },
              },
            },
            required: ["ops"],
            additionalProperties: false,
          }),
        }),
      },
      toolChoice: "required",
      maxOutputTokens: 4096,
    });
    const call = result.toolCalls?.[0];
    if (!call) return null;
    return sanitizeDocEditPlan((call as any).input ?? JSON.parse(String((call as any).args ?? "{}")));
  } catch (e) {
    console.warn("[zpaper] doc-edit: provider plan failed:", String((e as Error)?.message || e).slice(0, 200));
    return null;
  }
}

function buildSystemPrompt(): string {
  return [
    "你是 zpaper 的文档修订规划器。根据用户的修改指令，对给定文档产出一组可执行的结构化编辑操作（ops）。",
    "",
    "硬性规则：",
    `1. replace 的 find 必须是文档原文中**逐字连续**的片段（通常是一个段落内的一段话，长度适中），绝不能改写、缩写或猜测原文。`,
    "2. find 不能跨段落。跨段落的修改拆成多个操作。",
    "3. insert 的 text 是一个新段落的纯文本；after 填锚点段落的原文片段（可选）。新内容应追加在相关段落后。",
    "4. delete 删除 find 片段所在的整个段落——只用于整段删除。",
    "5. 按文档中出现顺序给出 ops；没有可执行的修改就不要调用工具。",
    "6. 不要在 replaceWith 里编造用户没有要求的内容；改写保持原文语言与语气。",
  ].join("\n");
}

function buildUserPrompt(brief: DocEditBrief): string {
  const md = brief.docMarkdown.trim();
  const doc = md
    ? `【当前文档：${brief.docTitle || "未命名"}】${brief.docMarkdown.length >= MAX_DOC_CHARS ? "（过长，仅保留前一部分）" : ""}\n${brief.docMarkdown}`
    : "【当前文档】（空）";
  const selection = brief.docSelection?.trim()
    ? `\n\n【用户当前选中的文档片段】\n${brief.docSelection}`
    : "";
  const proposal = brief.proposal?.trim()
    ? `\n\n【对话中讨论到的修改建议（供参考，以指令为准）】\n${brief.proposal}`
    : "";
  return `${doc}${selection}${proposal}\n\n【用户指令】\n${brief.instruction}\n\n请产出修改方案。`;
}

// Deterministic plan for demo mode / provider failures, so the whole
// chain (plan -> apply -> undo -> redline save) stays testable without a key.
function demoPlan(brief: DocEditBrief): { explanation?: string; ops: any[] } {
  const sel = brief.docSelection?.trim();
  if (sel) {
    const find = sel.replace(/\s+/g, " ").trim().slice(0, 120);
    return {
      explanation: "演示模式：将选中文字替换为示例改写",
      ops: [{ action: "replace", find, replaceWith: `（演示修订：已按「${brief.instruction.slice(0, 30)}」改写选中内容）` }],
    };
  }
  return {
    explanation: "演示模式：在文档末尾追加一条示例段落",
    ops: [{ action: "insert", text: `（演示修订：来自指令「${brief.instruction.slice(0, 40)}」。配置真实模型后，这里将给出逐段的具体修改。）` }],
  };
}
