import { resolveProvider } from "../lib/ai-provider.js";

export async function runGenerate(opts: { path: string; provider?: string }) {
  const provider = resolveProvider(opts.provider);
  console.log(
    `[generate] would read codebase at ${opts.path} and draft WebMCP tools with ${provider}`
  );
  // TODO: shell out to the selected AI CLI and save output to trajectories/generate.json
}
