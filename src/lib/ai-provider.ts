export const AI_PROVIDERS = ["gemini", "antigravity", "claude"] as const;

export type AIProvider = (typeof AI_PROVIDERS)[number];

const DEFAULT_PROVIDER: AIProvider = "gemini";

export function resolveProvider(provider?: string): AIProvider {
  const selected = provider ?? process.env.WEBMCPIFY_PROVIDER ?? DEFAULT_PROVIDER;

  if ((AI_PROVIDERS as readonly string[]).includes(selected)) {
    return selected as AIProvider;
  }

  throw new Error(
    `Unknown provider "${selected}". Choose one of: ${AI_PROVIDERS.join(", ")}.`
  );
}
