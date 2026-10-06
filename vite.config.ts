import { defineConfig, type Connect, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

// Web-dev only: a scripted mock of the model so the renderer can be developed
// and browser-tested without Electron or a real model. In the packaged app the
// main process serves the same protocol via the ai:// scheme instead.
async function mockChat(req: Connect.IncomingMessage, res: any) {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const { messages, toolDefinitions } = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  const { streamText, convertToModelMessages } = await import("ai");
  const { aiDocumentFormats, injectDocumentStateMessages, toolDefinitionsToToolSet } =
    await import("@blocknote/xl-ai/server");
  const { buildMockModel } = await import("./src/shared/aimock");
  const fs = await import("node:fs");
  fs.writeFileSync("/tmp/zpaper-webdev-last-request.json", JSON.stringify({ messages, toolDefinitions }, null, 2));
  const model = await buildMockModel({ messages, toolDefinitions });
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
