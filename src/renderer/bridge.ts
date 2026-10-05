// Bridge to the Electron main process, with graceful fallbacks for plain-web
// development (vite dev server without Electron).
import { WELCOME_MD } from "./welcome";

export type ProviderConfig = {
  id: string;
  name: string;
  protocol: "openai" | "anthropic";
  baseURL: string;
  apiKey: string;
  model: string;
};

export type Settings = {
  providers: ProviderConfig[];
  activeProviderId?: string;
  workspace?: WorkspaceSettings;
};

const native = (window as any).zpaper;
export const isElectron = !!native;

export type WorkspaceSettings = { path?: string; enabled?: boolean };

export async function getSettings(): Promise<Settings> {
  if (native) return (await native.getSettings()) as Settings;
  try {
    return JSON.parse(localStorage.getItem("zpaper:settings") || "") as Settings;
  } catch {
    return { providers: [] };
  }
}

export async function setSettings(s: Settings) {
  if (native) return native.setSettings(s);
  localStorage.setItem("zpaper:settings", JSON.stringify(s));
}

export type OpenedFile = { canceled: boolean; path?: string; name?: string; content?: string };

export async function openFile(): Promise<OpenedFile> {
  if (native) return native.openFile();
  return { canceled: false, path: "welcome.md", name: "欢迎.md", content: WELCOME_MD };
}

export async function saveFile(content: string, path?: string): Promise<OpenedFile> {
  if (native) return native.saveFile({ content, path });
  const blob = new Blob([content], { type: "text/markdown" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = path || "文档.md";
  a.click();
  return { canceled: false, path: path || "downloaded.md", name: "文档.md" };
}

export const CHAT_API = isElectron ? "ai://local/chat" : "/api/chat";

export async function testProvider(p: ProviderConfig): Promise<{ ok: boolean; error?: string; sample?: string }> {
  try {
    const url = isElectron ? "ai://local/test" : "/api/test";
    const r = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(p),
    });
    return await r.json();
  } catch (e: any) {
    return { ok: false, error: String(e?.message || e) };
  }
}

export async function pickWorkspace(): Promise<{ canceled: boolean; path?: string }> {
  if (native) return native.pickWorkspace();
  return { canceled: true };
}

export async function zcodeStatus(): Promise<{ found: boolean; kind: string | null }> {
  if (native) return native.zcodeStatus();
  return { found: false, kind: null };
}
