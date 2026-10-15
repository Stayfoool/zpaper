// Chat-window pipeline: a free-form conversation endpoint (as opposed to the
// editor's BlockNote tool protocol). The current document is passed in as
// read-only context; the model streams a plain UI message stream back.
import { resolveProviderModel } from "./provider";
import { buildChatMockModel } from "../shared/aimock";
import { loadSettings } from "./settings";

const MAX_DOC_CHARS = 30_000;
const MAX_SELECTION_CHARS = 4_000;

export type ChatWindowContext = {
  docTitle?: string;
  docMarkdown?: string;
  docSelection?: string;
};

export async function handleChatWindow(req: Request): Promise<Response> {
  try {
    const body: any = await req.json();
    const messages: any[] = Array.isArray(body?.messages) ? body.messages : [];
    const context: ChatWindowContext = body?.context ?? {};

    let model: any;
    let label = "演示模式";
    if (process.env.ZPAPER_FORCE_MOCK !== "1") {
      const settings = loadSettings();
      const provider = (settings.providers || []).find(
        (p: any) => p.id === settings.activeProviderId,
      );
      if (provider) {
        model = await resolveProviderModel(provider);
        label = provider.name;
      }
    }
    if (!model) {
      model = await buildChatMockModel({
        docTitle: context.docTitle,
        docHasContent: !!context.docMarkdown?.trim(),
      });
      console.log("[zpaper] chat-window: no provider configured — using demo model");
    } else {
      console.log(`[zpaper] chat-window: using provider "${label}"`);
    }

    let system =
      "你是 zpaper 的 AI 对话助手。zpaper 是一款「和 AI 一起深读、一起创作」的文档编辑器" +
      "（ZCode 与 Word 编辑器的融合）。你的职责是与用户围绕文档和工作内容进行多轮讨论：" +
      "解读、总结、追问、给建议、起草片段。回答用 Markdown，简洁、结构化、直接。\n" +
      "约定：需要就地修改文档时，给出具体、可直接执行的修改建议（写明改哪段、改成什么）；" +
      "用户可以点击你回复下方的「应用到文档」，把建议转成文档里的修订（可撤销；保存 .docx 时写成 Word 原生修订标记）。" +
      "若用户引用了选区，优先围绕选区内容回答。";

    const md = (context.docMarkdown || "").trim();
    if (md) {
      const clipped = md.length > MAX_DOC_CHARS ? md.slice(0, MAX_DOC_CHARS) : md;
      system +=
        `\n\n【当前文档：${context.docTitle || "未命名"}】` +
        (md.length > MAX_DOC_CHARS ? "（内容过长，仅保留前一部分）" : "") +
        `\n\n${clipped}`;
    } else {
      system += "\n\n（当前没有打开的文档，或文档为空。）";
    }
    const sel = (context.docSelection || "").trim();
    if (sel) {
      system += `\n\n【用户当前选中的文档片段】\n${sel.slice(0, MAX_SELECTION_CHARS)}`;
    }

    const { streamText, convertToModelMessages } = await import("ai");
    const result = streamText({
      model,
      system,
      messages: await convertToModelMessages(messages),
    });
    const response = result.toUIMessageStreamResponse();
    response.headers.set("x-zpaper-agent", model ? "provider" : "demo");
    return response;
  } catch (e) {
    console.error("[zpaper] /chat-window error:", e);
    return new Response(JSON.stringify({ error: String(e) }), { status: 500 });
  }
}
