import { resolveProvider } from "../lib/ai-provider.js";

export async function runRepair(opts: { provider?: string }) {
  const provider = resolveProvider(opts.provider);
  console.log(`[repair] would patch the failed tool using ${provider}`);
  // TODO: read the last test failure and save the repair trajectory.
}
