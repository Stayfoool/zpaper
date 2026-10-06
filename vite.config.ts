import { defineConfig, type Connect, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import "dotenv/config";

// Web-dev only: /api/chat proxies to a real GLM model when AI_BACKEND=glm
// (key in .env), else uses a scripted mock. In the packaged app the main
// process serves the same pipeline via the ai:// scheme instead.
async function mockChat(req: Connect.IncomingMessage, res: any) {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const { messages, toolDefinitions } = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  const { streamText, convertToModelMessages } = await import("ai");
  const { aiDocumentFormats, injectDocumentStateMessages, toolDefinitionsToToolSet } =
    await import("@blocknote/xl-ai/server");

  let model: any;
  const backend = (process.env.AI_BACKEND || "mock").toLowerCase();
  if (backend === "glm" && process.env.GLM_API_KEY) {
    const { createAnthropic } = await import("@ai-sdk/anthropic");
    model = createAnthropic({
      baseURL: process.env.GLM_BASE_URL,
      apiKey: process.env.GLM_API_KEY,
      fetch: async (url: any, init: any) => {
        const t0 = Date.now();
        const res = await fetch(url, init);
        if (process.env.ZPAPER_DEBUG_AI) {
          try {
            const fs = await import("node:fs");
            const clone = res.clone();
            const bodyText = await clone.text();
            fs.writeFileSync(
              "/tmp/zpaper-ai-exchange.log",
              `=== ${new Date().toISOString()} ${url}\nREQ: ${String(init?.body).slice(0, 2000)}\nRES(${res.status}, ${Date.now() - t0}ms): ${bodyText.slice(-1500)}\n`,
              { flag: "a" },
            );
          } catch {
            /* logging only */
          }
        }
        return res;
      },
    })(process.env.GLM_MODEL || "GLM-5.2");
    console.log("[zpaper-webdev] backend = GLM:", process.env.GLM_MODEL);
  } else {
    const { buildMockModel } = await import("./src/shared/aimock");
    model = await buildMockModel({ toolDefinitions, messages });
    console.log("[zpaper-webdev] backend = mock");
  }

  const result = streamText({
    model,
    system: aiDocumentFormats.html.systemPrompt,
    messages: await convertToModelMessages(injectDocumentStateMessages(messages)),
    tools: toolDefinitionsToToolSet(toolDefinitions),
    toolChoice: "required",
  });
  const response = result.toUIMessageStreamResponse();
  res.writeHead(response.status, Object.fromEntries(response.headers));
  const { Readable } = await import("node:stream");
  Readable.fromWeb(response.body as any).pipe(res);
}

const webDevApi: Plugin = {
  name: "web-dev-ai-api",
  configureServer(server) {
    server.middlewares.use("/api/chat", (req, res, next) => {
      if (req.method !== "POST") return next();
      mockChat(req, res).catch((e) => {
        console.error("[zpaper-webdev] /api/chat error:", e);
        res.statusCode = 500;
        res.end(JSON.stringify({ error: String(e) }));
      });
    });
  },
};

export default defineConfig({
  root: "src/renderer",
  base: "./",
  plugins: [react(), webDevApi],
  build: {
    outDir: "../../dist/renderer",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: "src/renderer/index.html",
        converter: "src/renderer/converter.html",
      },
    },
  },
});
