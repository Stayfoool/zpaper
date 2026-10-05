import { useState } from "react";
import { testProvider, type ProviderConfig, type Settings } from "./bridge";

export const PRESETS: Omit<ProviderConfig, "id" | "apiKey">[] = [
  { name: "GLM Coding Plan（z.ai）", protocol: "openai", baseURL: "https://api.z.ai/api/coding/paas/v4", model: "GLM-5.2" },
  { name: "智谱 BigModel 开放平台", protocol: "openai", baseURL: "https://open.bigmodel.cn/api/paas/v4", model: "GLM-5.2" },
  { name: "GLM（Anthropic 兼容）", protocol: "anthropic", baseURL: "https://api.z.ai/api/anthropic", model: "GLM-5.2" },
  { name: "DeepSeek", protocol: "openai", baseURL: "https://api.deepseek.com", model: "deepseek-chat" },
  { name: "Kimi（Moonshot）", protocol: "openai", baseURL: "https://api.moonshot.cn/v1", model: "kimi-k2.5" },
  { name: "OpenAI", protocol: "openai", baseURL: "https://api.openai.com/v1", model: "gpt-4.1" },
  { name: "Anthropic 官方", protocol: "anthropic", baseURL: "https://api.anthropic.com", model: "claude-sonnet-4-5" },
  { name: "自定义（OpenAI 兼容）", protocol: "openai", baseURL: "", model: "" },
];

let uid = 0;
const newId = () => `p_${Date.now().toString(36)}_${uid++}`;

export function SettingsModal(props: {
  initial: Settings;
  onSave: (s: Settings) => void;
  onCancel: () => void;
}) {
  const [providers, setProviders] = useState<ProviderConfig[]>(props.initial.providers || []);
  const [activeId, setActiveId] = useState<string | undefined>(props.initial.activeProviderId);
  const [testing, setTesting] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<Record<string, string>>({});

  const update = (id: string, patch: Partial<ProviderConfig>) => {
    setProviders((ps) => ps.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  };

  const addPreset = (i: number) => {
    const preset = PRESETS[i];
    const p: ProviderConfig = { ...preset, id: newId(), apiKey: "" };
    setProviders((ps) => [...ps, p]);
    setActiveId(activeId ?? p.id);
  };

  const test = async (p: ProviderConfig) => {
    setTesting(p.id);
    setTestResult((r) => ({ ...r, [p.id]: "" }));
    const r = await testProvider(p);
    setTesting(null);
    setTestResult((res) => ({
      ...res,
      [p.id]: r.ok ? `✅ 连接成功：${r.sample || "OK"}` : `❌ ${r.error || "连接失败"}`,
    }));
  };

  return (
    <div className="modal-overlay" onClick={props.onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>设置 · 大模型接入</h2>
        <p className="hint">
          zpaper 不内置模型。添加你有的大模型服务（API Key 只保存在你自己电脑上），并选择一个正在使用的服务。
        </p>

        <div className="preset-row">
          <span>快速添加：</span>
          <select
            value=""
            onChange={(e) => e.target.value !== "" && addPreset(Number(e.target.value))}
          >
            <option value="">选择服务…</option>
            {PRESETS.map((p, i) => (
              <option key={p.name} value={i}>
                {p.name}
              </option>
            ))}
          </select>
        </div>

        <div className="provider-list">
          {providers.length === 0 && (
            <div className="empty">还没有配置。从上方「快速添加」开始，例如选择「GLM Coding Plan（z.ai）」。</div>
          )}
          {providers.map((p) => (
            <div key={p.id} className={"provider" + (activeId === p.id ? " active" : "")}>
              <div className="provider-head">
                <label className="radio">
                  <input
                    type="radio"
                    name="active"
                    checked={activeId === p.id}
                    onChange={() => setActiveId(p.id)}
                  />
                  使用此服务
                </label>
                <input
                  className="name"
                  value={p.name}
                  onChange={(e) => update(p.id, { name: e.target.value })}
                />
                <button className="danger" onClick={() => setProviders((ps) => ps.filter((x) => x.id !== p.id))}>
                  删除
                </button>
              </div>
              <div className="provider-grid">
                <label>
                  协议
                  <select value={p.protocol} onChange={(e) => update(p.id, { protocol: e.target.value as any })}>
                    <option value="openai">OpenAI 兼容</option>
                    <option value="anthropic">Anthropic 兼容</option>
                  </select>
                </label>
                <label>
                  Base URL
                  <input value={p.baseURL} placeholder="https://…" onChange={(e) => update(p.id, { baseURL: e.target.value })} />
                </label>
                <label>
                  模型
                  <input value={p.model} placeholder="模型名" onChange={(e) => update(p.id, { model: e.target.value })} />
                </label>
                <label>
                  API Key
                  <input
                    type="password"
                    value={p.apiKey}
                    placeholder="sk-…"
                    onChange={(e) => update(p.id, { apiKey: e.target.value })}
                  />
                </label>
              </div>
              <div className="provider-foot">
                <button disabled={testing === p.id} onClick={() => test(p)}>
                  {testing === p.id ? "测试中…" : "测试连接"}
                </button>
                <span className={"test-result" + (testResult[p.id]?.startsWith("✅") ? " ok" : "")}>
                  {testResult[p.id]}
                </span>
              </div>
            </div>
          ))}
        </div>

        <div className="modal-foot">
          <button onClick={props.onCancel}>取消</button>
          <button
            className="primary"
            onClick={() => props.onSave({ providers, activeProviderId: activeId })}
          >
            保存
          </button>
        </div>
      </div>
    </div>
  );
}
