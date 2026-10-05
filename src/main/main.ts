import { app, BrowserWindow, dialog, ipcMain, protocol } from "electron";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { handleChat, handleTest, loadSettings, saveSettings, detectZcodeCli } from "./ai";

// this bundle is ESM, derive the classic dirname for locating the preload
const dirname = path.dirname(fileURLToPath(import.meta.url));

// must run before app.ready for fetch()/streaming on the custom scheme
protocol.registerSchemesAsPrivileged([
  {
    scheme: "ai",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      corsEnabled: false,
    },
  },
]);

const DEV_URL = process.env.ELECTRON_RENDERER_URL;

// CI/test smoke runs use an isolated userData so real user settings are untouched
if (process.env.ZPAPER_SMOKE_USERDATA) {
  app.setPath("userData", process.env.ZPAPER_SMOKE_USERDATA);
}

let win: BrowserWindow | null = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 620,
    title: "zpaper",
    show: false,
    webPreferences: {
      preload: path.join(dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  if (DEV_URL) {
    win.loadURL(DEV_URL);
    win.webContents.openDevTools({ mode: "detach" });
  } else {
    win.loadFile(path.join(dirname, "../renderer/index.html"));
  }
  win.once("ready-to-show", () => win?.show());
  win.webContents.on("console-message", (_e, level, message) => {
    if (level >= 3) console.log("[zpaper:renderer-error]", message.slice(0, 300));
  });
}

app.whenReady().then(async () => {
  protocol.handle("ai", (req) => {
    const url = new URL(req.url);
    if (url.pathname.endsWith("/chat")) return handleChat(req);
    if (url.pathname.endsWith("/test")) return handleTest(req);
    return new Response(JSON.stringify({ error: "unknown ai endpoint" }), { status: 404 });
  });

  ipcMain.handle("zpaper:settings:get", () => loadSettings());
  ipcMain.handle("zpaper:settings:set", (_e, settings) => {
    saveSettings(settings);
    return true;
  });

  ipcMain.handle("zpaper:workspace:pick", async () => {
    const r = await dialog.showOpenDialog(win!, {
      title: "选择工作区文件夹（AI 将只读取该目录下的文件作为参考）",
      properties: ["openDirectory"],
    });
    if (r.canceled || !r.filePaths[0]) return { canceled: true };
    return { canceled: false, path: r.filePaths[0] };
  });

  ipcMain.handle("zpaper:zcode:status", () => {
    const cli = detectZcodeCli();
    return { found: !!cli, kind: cli?.kind ?? null };
  });

  ipcMain.handle("zpaper:file:open", async () => {
    const r = await dialog.showOpenDialog(win!, {
      title: "打开文档",
      filters: [
        { name: "Markdown / 文本", extensions: ["md", "markdown", "txt"] },
        { name: "所有文件", extensions: ["*"] },
      ],
      properties: ["openFile"],
    });
    if (r.canceled || !r.filePaths[0]) return { canceled: true };
    const p = r.filePaths[0];
    return { canceled: false, path: p, name: path.basename(p), content: fs.readFileSync(p, "utf8") };
  });

  ipcMain.handle("zpaper:file:save", async (_e, payload: { content: string; path?: string }) => {
    let p = payload.path;
    if (!p) {
      const r = await dialog.showSaveDialog(win!, {
        title: "保存文档",
        defaultPath: "未命名.md",
        filters: [{ name: "Markdown", extensions: ["md"] }],
      });
      if (r.canceled || !r.filePath) return { canceled: true };
      p = r.filePath;
    }
    fs.writeFileSync(p, payload.content, "utf8");
    return { canceled: false, path: p, name: path.basename(p) };
  });

  createWindow();

  // CI smoke: exercise the full chat pipeline (agent research -> mock model)
  // against the ai:// protocol from the main process.
  if (process.env.ZPAPER_SMOKE_AI === "1") {
    setTimeout(async () => {
      try {
        const { net } = await import("electron");
        const doFetch = (async () => {
          const { net } = await import("electron");
          return await net.fetch("ai://local/chat", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              messages: [
                { id: "m1", role: "user", parts: [{ type: "text", text: "请修改文档" }] },
              ],
              toolDefinitions: {
                applyDocumentOperations: {
                  description: "test",
                  inputSchema: {
                    type: "object",
                    properties: { operations: { type: "array", items: { type: "object" } } },
                  },
                  outputSchema: { type: "object" },
                },
              },
            }),
          });
        })();
        const r = await Promise.race([
          doFetch,
          new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout")), 15000)),
        ]);
        const text = await r.text();
        console.log(
          "[zpaper] smoke chat result: status",
          r.status,
          "agent-header:",
          r.headers.get("x-zpaper-agent"),
          "stream bytes:",
          text.length,
        );
      } catch (e) {
        console.error("[zpaper] smoke chat:", String(e && (e as any).message || e).slice(0, 200));
      }
    }, 3000);
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

// CI smoke test hook: quit shortly after launch so packaging pipelines can
// verify the app boots without a human looking at the window.
if (process.env.ZPAPER_SMOKE_EXIT) {
  const ms = Number(process.env.ZPAPER_SMOKE_EXIT) || 8000;
  setTimeout(() => {
    console.log("[zpaper] smoke exit");
    app.quit();
  }, ms);
}
