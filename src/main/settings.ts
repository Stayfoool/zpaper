import * as fs from "node:fs";
import * as path from "node:path";
import { app } from "electron";

export type ProviderConfig = {
  id: string;
  name: string;
  protocol: "openai" | "anthropic";
  baseURL: string;
  apiKey: string;
  model: string;
};

export type ZpaperSettings = {
  providers: ProviderConfig[];
  activeProviderId?: string;
};

const settingsPath = () => path.join(app.getPath("userData"), "settings.json");

export function loadSettings(): ZpaperSettings {
  try {
    return JSON.parse(fs.readFileSync(settingsPath(), "utf8"));
  } catch {
    return { providers: [] };
  }
}

export function saveSettings(s: ZpaperSettings) {
  fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
  fs.writeFileSync(settingsPath(), JSON.stringify(s, null, 2), "utf8");
}
