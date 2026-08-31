import path from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { runAgent } from "../lib/agent.js";
import { resolveProvider } from "../lib/ai-provider.js";
import { scoreTasks } from "../lib/eval.js";

const BASELINE_PROMPT = `
Add WebMCP tool registrations to this site for its cart, roast filter,
and checkout actions. This may be a plain site with no existing WebMCP
registrations or MCP config; treat that as the starting condition, not a
failure. After adding the tools, verify yourself that they work by calling
them through your available browser tools. Report what you did.
`;

export async function runBaseline(opts: {
  path: string;
  url: string;
  provider?: string;
}) {
  const provider = resolveProvider(opts.provider);
  const sitePath = path.resolve(opts.path);
  const cliRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../.."
  );
  const trajectoryPath = path.join(cliRoot, "trajectories/baseline.json");
  const mcpConfigPath = path.join(sitePath, ".mcp.json");

  console.log(
    `[baseline] running one-shot self-verifying ${provider} session...`
  );

  await runAgent({
    provider,
    prompt: BASELINE_PROMPT,
    cwd: sitePath,
    allowedTools: "Read,Edit,Bash,mcp__chrome-devtools__*",
    mcpConfig: existsSync(mcpConfigPath) ? mcpConfigPath : undefined,
    saveTo: trajectoryPath,
  });

  console.log("[baseline] session complete, saved to trajectories/baseline.json");
  console.log("[baseline] running independent eval check against live site...");

  const scores = await scoreTasks(opts.url);
  console.log(`[baseline] result: ${scores.passed}/${scores.total} tasks passed`);
}
