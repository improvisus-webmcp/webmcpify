import path from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { runAgent } from "../lib/agent.js";
import { resolveProvider } from "../lib/ai-provider.js";
import { scoreTasks } from "../lib/eval.js";

export const AUDIT_PROMPT = `
Explore this website's codebase to understand its core user-facing actions
(e.g. search, filtering, adding/removing items, submitting forms, checkout,
or other primary interactions — infer these from the code, don't assume
any specific domain).

If WebMCP tools already exist in the codebase, verify each one by
discovering it (list_webmcp_tools) and calling it through your available
browser tools. Report tool discovery, each execution and its result, and
any dynamic registration/unregistration behavior you observe (e.g. tools
that appear or disappear based on app state).

If no WebMCP tools exist yet, draft appropriate tool registrations for
the site's key actions, choosing declarative (HTML form attributes) or
imperative (navigator.modelContext) per action based on what fits best,
then verify your own work the same way.

Report: what actions you identified, what you found or built, and the
verification result for each tool.
`.trim();

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
    prompt: AUDIT_PROMPT,
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
