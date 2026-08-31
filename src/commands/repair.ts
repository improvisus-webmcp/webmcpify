import path from "node:path";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { runAgent } from "../lib/agent.js";
import { resolveProvider } from "../lib/ai-provider.js";
import { resolveDurable } from "../lib/config.js";
import { writeChromeDevtoolsMcpConfig } from "../lib/mcp-config.js";
import {
  DISCOVERY_GUIDANCE,
  TOOL_PLACEMENT_GUIDANCE,
} from "../lib/prompts.js";
import {
  createTrajectoryArtifact,
  createTrajectoryPath,
  latestTrajectoryPath,
} from "../lib/trajectories.js";
import type { TaskResult } from "../lib/scoring.js";
import type { StoredTestEvaluation } from "./test.js";

export interface RepairOptions {
  provider?: string;
  path?: string;
  url?: string;
  task?: string;
  durable?: boolean;
  maxRepairs?: number | string;
}

async function readLastEvaluation(sitePath: string): Promise<{
  evaluation: StoredTestEvaluation;
  path: string;
}> {
  const evaluationPath = await latestTrajectoryPath("test-eval", sitePath);
  if (!evaluationPath || !existsSync(evaluationPath)) {
    throw new Error(
      `No test evaluation found in trajectories. Run "webmcpify test" first.`
    );
  }

  try {
    return {
      evaluation: JSON.parse(
        await readFile(evaluationPath, "utf8")
      ) as StoredTestEvaluation,
      path: evaluationPath,
    };
  } catch (error) {
    throw new Error(
      `Could not read the last test evaluation: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}

async function runPlainRepair(opts: RepairOptions): Promise<void> {
  const provider = resolveProvider(opts.provider);
  const sitePath = path.resolve(opts.path ?? process.cwd());
  const {
    evaluation,
    path: evaluationPath,
  } = await readLastEvaluation(sitePath);
  const failedTasks = evaluation.scores.results.filter((task) => !task.passed);

  if (failedTasks.length === 0) {
    throw new Error("The last test passed every task; there is nothing to repair.");
  }

  const mcpConfigPath = await writeChromeDevtoolsMcpConfig(sitePath);
  const repairTrajectory = createTrajectoryPath("repair");
  const failures = failedTasks
    .map(
      (task: TaskResult) =>
        `- ${task.task}: ${task.detail ?? "failed without additional detail"}`
    )
    .join("\n");

  const prompt = `Repair the failed WebMCP behavior in this site. The last
independent test ran against ${evaluation.url} and produced these failures:
${failures}

Inspect the relevant source and the existing WebMCP registrations. Patch only
the cause of these failures, preserve the approved tool names and schemas, and
avoid unrelated refactors.

Before patching, perform the focused discovery below rather than scanning the
entire repository file by file:

${DISCOVERY_GUIDANCE}

${TOOL_PLACEMENT_GUIDANCE}

After editing, use the browser MCP tools to verify the repaired behavior
against ${evaluation.url}. Report the files changed, placement and wiring for
each affected tool, and the verification result.`;

  console.log(`[repair] patching ${failedTasks.length} failed task(s) via ${provider}...`);

  await runAgent({
    provider,
    prompt,
    cwd: sitePath,
    allowedTools: "Read,Edit,Bash,mcp__chrome-devtools__*",
    mcpConfig: existsSync(mcpConfigPath) ? mcpConfigPath : undefined,
    saveTo: repairTrajectory,
    trajectoryMetadata: {
      role: "repair",
      sitePath,
      url: evaluation.url,
      sourceEvaluation: evaluationPath,
      failures: failedTasks,
    },
  });

  console.log(`[repair] repair trajectory saved to ${repairTrajectory}`);
  console.log('[repair] run "webmcpify test" again to measure the repair independently');
}

function workflowSlug(value: string): string {
  return (
    value
      .trim()
      .replace(/[^a-zA-Z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "task"
  );
}

async function runDurableRepair(opts: RepairOptions): Promise<void> {
  if (!opts.url) {
    throw new Error('Durable repair requires "--url <url>".');
  }
  if (!opts.task) {
    throw new Error('Durable repair requires "--task <task>".');
  }

  const maxRepairs =
    opts.maxRepairs === undefined ? 3 : Number(opts.maxRepairs);
  if (!Number.isInteger(maxRepairs) || maxRepairs < 0) {
    throw new Error("--max-repairs must be a non-negative integer.");
  }

  const { Client, Connection } = await import("@temporalio/client");
  const connection = await Connection.connect({
    address: process.env.WEBMCPIFY_TEMPORAL_ADDRESS ?? "localhost:7233",
  });

  try {
    const client = new Client({
      connection,
      namespace: process.env.WEBMCPIFY_TEMPORAL_NAMESPACE ?? "default",
    });
    const workflowId = `repair-${workflowSlug(opts.task)}-${Date.now()}`;
    const startedAt = new Date().toISOString();
    const workflowOptions = {
      path: path.resolve(opts.path ?? process.cwd()),
      url: opts.url,
      task: opts.task,
      maxRepairs,
      provider: opts.provider,
    };
    const handle = await client.workflow.start("repairWorkflow", {
      taskQueue: process.env.WEBMCPIFY_TEMPORAL_TASK_QUEUE ?? "webmcpify",
      workflowId,
      args: [workflowOptions],
    });

    console.log(`[repair] durable workflow started: ${handle.workflowId}`);
    try {
      const result = await handle.result();
      const trajectory = await createTrajectoryArtifact(
        "temporal-repair",
        result,
        {
          workflowId,
          task: opts.task,
          url: opts.url,
          sitePath: workflowOptions.path,
          provider: opts.provider,
          maxRepairs,
          startedAt,
          finishedAt: new Date().toISOString(),
        }
      );
      console.log(`[repair] result: ${JSON.stringify(result)}`);
      console.log(`[repair] workflow artifact saved to ${trajectory}`);
    } catch (error) {
      const trajectory = await createTrajectoryArtifact(
        "temporal-repair",
        {
          error: error instanceof Error ? error.message : String(error),
          workflowId,
        },
        {
          status: "failed",
          workflowId,
          task: opts.task,
          url: opts.url,
          sitePath: workflowOptions.path,
          provider: opts.provider,
          maxRepairs,
          startedAt,
          finishedAt: new Date().toISOString(),
        }
      );
      console.log(`[repair] failed workflow artifact saved to ${trajectory}`);
      throw error;
    }
  } finally {
    await connection.close();
  }
}

export async function runRepair(opts: RepairOptions): Promise<void> {
  const sitePath = path.resolve(opts.path ?? process.cwd());
  const useDurable = await resolveDurable(opts.durable, sitePath);

  if (useDurable) {
    await runDurableRepair(opts);
    return;
  }

  await runPlainRepair(opts);
}
