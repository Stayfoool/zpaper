import type { ProviderConfig } from "./settings";

export async function resolveProviderModel(p: ProviderConfig) {
  if (p.protocol === "anthropic") {
    const { createAnthropic } = await import("@ai-sdk/anthropic");
    const provider = createAnthropic({
      baseURL: p.baseURL || undefined,
      apiKey: p.apiKey,
    });
    return provider(p.model);
  }
  const { createOpenAI } = await import("@ai-sdk/openai");
  const provider = createOpenAI({
    baseURL: p.baseURL || undefined,
    apiKey: p.apiKey,
  });
  return provider(p.model);
}
