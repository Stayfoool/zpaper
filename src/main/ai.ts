// AI pipeline for the ai:// protocol: resolves the user-configured provider
// and streams the BlockNote AI tool-call protocol back to the renderer.
// Falls back to the built-in demo model when nothing is configured.
import { resolveProviderModel, type ProviderConfig } from "./provider";
import { buildMockModel } from "../shared/aimock";
import { loadSettings } from "./settings";

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

    const result = streamText({
      model,
      system: aiDocumentFormats.html.systemPrompt,
      messages: await convertToModelMessages(injectDocumentStateMessages(messages)),
      tools: toolDefinitionsToToolSet(toolDefinitions),
      toolChoice: "required",
    });
    return result.toUIMessageStreamResponse();
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
