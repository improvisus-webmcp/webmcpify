import { resolveProvider } from "../lib/ai-provider.js";

export async function runTest(opts: { url: string; provider?: string }) {
  const provider = resolveProvider(opts.provider);
  console.log(`[test] would run ${provider} against approved tools at ${opts.url}`);
  // TODO: run an isolated browser agent through chrome-devtools-mcp.
}
