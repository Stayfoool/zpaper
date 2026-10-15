// Hidden-window based document conversion: runs in the renderer (real
// Chromium DOM), so BlockNote parsing and the browser build of mammoth work
// without any Node-side DOM polyfills. Used by the docx open/save pipeline.
import { app, BrowserWindow } from "electron";
import * as path from "node:path";
import * as fs from "node:fs";

let win: BrowserWindow | null = null;
let seq = 0;

const CONVERTER_TIMEOUT_MS = 20_000;

function ensureWindow() {
  if (win && !win.isDestroyed()) return win;
  win = new BrowserWindow({
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL + "/converter.html");
  } else {
    void win.loadFile(path.join(dirname(), "../renderer/converter.html"));
  }
  win.on("closed", () => (win = null));
  return win;
}

function dirname() {
  return path.dirname(__filename);
}

/** Call window.__zpaperConvert(op, payload) in the hidden window. */
export async function callConverter<T = any>(op: string, payload: any): Promise<T> {
  if (!app.isReady()) throw new Error("app not ready");
  const w = ensureWindow();
  await new Promise<void>((resolve) => {
    if (w.webContents.isLoading()) {
      w.webContents.once("did-finish-load", () => resolve());
    } else resolve();
  });
  // wait until the converter script has registered itself
  await new Promise<void>((resolve) => {
    const started = Date.now();
    const check = async () => {
      try {
        const ok = await w.webContents.executeJavaScript("!!window.__zpaperConvert");
        if (ok) return resolve();
      } catch {
        /* page not ready */
      }
      if (Date.now() - started > CONVERTER_TIMEOUT_MS) return resolve();
      setTimeout(check, 200);
    };
    void check();
  });

  const id = `cv_${++seq}`;
  const callPromise = w.webContents.executeJavaScript(
    `window.__zpaperConvert(${JSON.stringify(op)}, ${JSON.stringify(id)}, ${JSON.stringify(payload)})`,
    true,
  );
  const result = await Promise.race([
    callPromise,
    new Promise<never>((_, rej) =>
      setTimeout(() => rej(new Error("转换超时")), CONVERTER_TIMEOUT_MS),
    ),
  ]);
  if (!result || result.id !== id) throw new Error("转换器返回无效结果");
  if (result.error) throw new Error(result.error);
  return result.data as T;
}

/** docx buffer -> BlockNote blocks (mammoth runs in the converter window). */
export async function docxBufferToBlocks(buf: Buffer): Promise<any[]> {
  const { html } = await callConverter<{ html: string }>("docxToHtml", {
    base64: buf.toString("base64"),
  });
  const { blocks } = await callConverter<{ blocks: any[] }>("htmlToBlocks", { html });
  return blocks;
}

export async function blocksToDocxBuffer(blocks: any[]): Promise<Buffer> {
  const { html } = await callConverter<{ html: string }>("blocksToHtml", { blocks });
  const htmlToDocx = (await import("html-to-docx")).default;
  const out = await htmlToDocx(html, undefined, { table: { row: { cantSplit: true } } });
  return Buffer.from(out);
}

// keep fs imported for potential direct writes by callers (no-op here)
void fs;
