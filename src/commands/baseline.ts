import path from "node:path";
import { existsSync } from "node:fs";
import { runAgent } from "../lib/agent.js";
import { resolveProvider } from "../lib/ai-provider.js";
import { scoreTasks } from "../lib/eval.js";
import {
  DISCOVERY_GUIDANCE,
  TOOL_PLACEMENT_GUIDANCE,
} from "../lib/prompts.js";
import {
  createTrajectoryArtifact,
  createTrajectoryPath,
} from "../lib/trajectories.js";

export const AUDIT_PROMPT = `
${DISCOVERY_GUIDANCE}

If WebMCP tools already exist in the codebase, verify each one by
discovering it (list_webmcp_tools) and calling it through your available
browser tools. Report tool discovery, each execution and its result, and
any dynamic registration/unregistration behavior you observe (e.g. tools
that appear or disappear based on app state).

If no WebMCP tools exist yet, draft appropriate tool registrations for
the site's key actions, choosing declarative (HTML form attributes) or
imperative (navigator.modelContext) per action based on what fits best,
then verify your own work the same way.

${TOOL_PLACEMENT_GUIDANCE}

Report the discovery findings before describing any changes: what actions you
identified, what you found or built, and the verification result for each
tool.
`.trim();

export async function runBaseline(opts: {
  path: string;
  url: string;
  provider?: string;
}) {
  const provider = resolveProvider(opts.provider);
  const sitePath = path.resolve(opts.path);
  const trajectoryPath = createTrajectoryPath("baseline");
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
    trajectoryMetadata: {
      role: "baseline",
      sitePath,
      url: opts.url,
    },
  });

  console.log(`[baseline] session complete, saved to ${trajectoryPath}`);
  console.log("[baseline] running independent eval check against live site...");

  const scores = await scoreTasks(opts.url);
  const evaluationPath = await createTrajectoryArtifact(
    "baseline-eval",
    scores,
    {
      provider,
      url: opts.url,
      sourceTrajectory: trajectoryPath,
      cwd: sitePath,
    }
  );
  console.log(`[baseline] result: ${scores.passed}/${scores.total} tasks passed`);
  console.log(`[baseline] independent evaluation saved to ${evaluationPath}`);
}
