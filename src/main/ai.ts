// AI pipeline for the ai:// protocol: resolves the user-configured provider
// and streams the BlockNote AI tool-call protocol back to the renderer.
// Falls back to the built-in demo model when nothing is configured.
import { resolveProviderModel, type ProviderConfig } from "./provider";
import { buildMockModel } from "../shared/aimock";
import { loadSettings, saveSettings } from "./settings";
import { gatherWorkspaceContext, detectZcodeCli } from "./zcodeAgent";

export { loadSettings, saveSettings } from "./settings";

function forceMock() {
  return process.env.ZPAPER_FORCE_MOCK === "1";
}

export async function handleChat(req: Request): Promise<Response> {
  try {
    const body: any = await req.json();
    const { messages, toolDefinitions } = body;
    const { streamText, convertToModelMessages } = await import("ai");
    const {
      aiDocumentFormats,
      injectDocumentStateMessages,
      toolDefinitionsToToolSet,
    } = await import("@blocknote/xl-ai/server");

    let model: any;
    let label = "demo";
    if (!forceMock()) {
      const provider = getActiveProvider();
      if (provider) {
        model = await resolveProviderModel(provider);
        label = provider.name;
      }
    }
    if (!model) {
      model = await buildMockModel({ toolDefinitions, messages });
      console.log("[zpaper] AI: no provider configured — using demo model");
    } else {
      console.log(`[zpaper] AI: using provider "${label}"`);
    }

    let system = aiDocumentFormats.html.systemPrompt;
    let agentState = "off";

    // agent mode: research the workspace with the local ZCode agent, then
    // inject the digest into the editing request
    const ws = loadSettings()?.workspace;
    if (ws?.enabled && ws.path) {
      if (!detectZcodeCli()) {
        agentState = "no-cli";
        console.warn("[zpaper] agent: ZCode CLI not found");
      } else {
        console.log("[zpaper] agent: gathering workspace context from", ws.path);
        const r = await gatherWorkspaceContext({
          workspacePath: ws.path,
          instruction: lastUserText(messages) || "按要求修改文档",
          docTitle: "当前文档",
        });
        if (r.ok && r.digest) {
          agentState = "ok";
          system +=
            `\n\n【工作区参考资料（由 ZCode agent 从用户工作区收集）】\n${r.digest}\n` +
            `请结合以上资料完成对文档的修改；资料与文档冲突时以文档为准。`;
          console.log(`[zpaper] agent: context digest ${r.digest.length} chars in ${r.ms}ms`);
        } else {
          agentState = "fail";
          console.warn("[zpaper] agent: research failed:", r.output.slice(0, 200));
        }
      }
    }

    const result = streamText({
      model,
      system,
      messages: await convertToModelMessages(injectDocumentStateMessages(messages)),
      tools: toolDefinitionsToToolSet(toolDefinitions),
      toolChoice: "required",
    });
    const response = result.toUIMessageStreamResponse();
    response.headers.set("x-zpaper-agent", agentState);
    return response;
  } catch (e) {
    console.error("[zpaper] /chat error:", e);
    return new Response(JSON.stringify({ error: String(e) }), { status: 500 });
  }
}

// Connectivity test from the settings dialog: send a tiny request.
export async function handleTest(req: Request): Promise<Response> {
  try {
    const provider: ProviderConfig = await req.json();
    const { streamText } = await import("ai");
    const model = await resolveProviderModel(provider);
    const result = streamText({
      model,
      prompt: 'Reply with exactly: OK',
      maxOutputTokens: 16,
    });
    const text = await result.text;
    return new Response(JSON.stringify({ ok: true, sample: text.slice(0, 60) }));
  } catch (e: any) {
    return new Response(
      JSON.stringify({ ok: false, error: String(e?.message || e).slice(0, 300) }),
      { status: 200 },
    );
  }
}

function getActiveProvider(): ProviderConfig | null {
  const settings = loadSettings();
  const id = settings?.activeProviderId;
  if (!id) return null;
  return (settings.providers || []).find((p: any) => p.id === id) || null;
}

/** Best-effort extraction of the user's instruction text from UIMessages. */
function lastUserText(messages: any): string {
  try {
    const s = JSON.stringify(messages);
    const m = s.match(/"text":"([^"]{1,120})"/);
    return m ? m[1] : "";
  } catch {
    return "";
  }
}

export { detectZcodeCli };
