import { resolveProvider } from "../lib/ai-provider.js";

export async function runBaseline(opts: {
  path: string;
  url: string;
  provider?: string;
}) {
  const provider = resolveProvider(opts.provider);
  console.log(
    `[baseline] would run the one-shot baseline for ${opts.path} at ${opts.url} with ${provider}`
  );
  // TODO: run and save the self-verifying baseline trajectory.
}
