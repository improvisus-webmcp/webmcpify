import path from "node:path";
import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { runAgent } from "../lib/agent.js";
import { resolveProvider } from "../lib/ai-provider.js";
import { writeChromeDevtoolsMcpConfig } from "../lib/mcp-config.js";
import { trajectoryPath } from "../lib/paths.js";
import type { StoredTestEvaluation } from "./test.js";

export interface RepairOptions {
  provider?: string;
  path?: string;
}

async function readLastEvaluation(): Promise<StoredTestEvaluation> {
  const evaluationPath = trajectoryPath("test-eval.json");
  if (!existsSync(evaluationPath)) {
    throw new Error(
      `No test evaluation found at ${evaluationPath}. Run "webmcpify test" first.`
    );
  }

  try {
    return JSON.parse(
      await readFile(evaluationPath, "utf8")
    ) as StoredTestEvaluation;
  } catch (error) {
    throw new Error(
      `Could not read the last test evaluation: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}

export async function runRepair(
  opts: RepairOptions
): Promise<void> {
  const provider = resolveProvider(opts.provider);
  const evaluation = await readLastEvaluation();
  const failedTasks = evaluation.scores.tasks.filter((task) => !task.passed);

  if (failedTasks.length === 0) {
    throw new Error("The last test passed every task; there is nothing to repair.");
  }

  const sitePath = path.resolve(opts.path ?? process.cwd());
  const mcpConfigPath = await writeChromeDevtoolsMcpConfig(sitePath);
  const repairTrajectory = trajectoryPath("repair.json");
  const failures = failedTasks
    .map(
      (task) =>
        `- ${task.name}: ${task.detail ?? "failed without additional detail"}`
    )
    .join("\n");

  const prompt = `Repair the failed WebMCP behavior in this site. The last
independent test ran against ${evaluation.url} and produced these failures:
${failures}

Inspect the relevant source and the existing WebMCP registrations. Patch only
the cause of these failures, preserve the approved tool names and schemas, and
avoid unrelated refactors. After editing, use the browser MCP tools to verify
the repaired behavior against ${evaluation.url}. Report the files changed and
the verification result.`;

  console.log(`[repair] patching ${failedTasks.length} failed task(s) via ${provider}...`);

  await runAgent({
    provider,
    prompt,
    cwd: sitePath,
    allowedTools: "Read,Edit,Bash,mcp__chrome-devtools__*",
    mcpConfig: existsSync(mcpConfigPath) ? mcpConfigPath : undefined,
    saveTo: repairTrajectory,
  });

  console.log(`[repair] repair trajectory saved to ${repairTrajectory}`);
  console.log('[repair] run "webmcpify test" again to measure the repair independently');
}
