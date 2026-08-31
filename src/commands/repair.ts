import path from "node:path";
import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { runAgent } from "../lib/agent.js";
import { resolveProvider } from "../lib/ai-provider.js";
import { resolveDurable } from "../lib/config.js";
import { writeChromeDevtoolsMcpConfig } from "../lib/mcp-config.js";
import { trajectoryPath } from "../lib/paths.js";
import type { StoredTestEvaluation } from "./test.js";

export interface RepairOptions {
  provider?: string;
  path?: string;
  url?: string;
  task?: string;
  durable?: boolean;
  maxRepairs?: number | string;
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

async function runPlainRepair(opts: RepairOptions): Promise<void> {
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
    const result = await handle.result();
    console.log(`[repair] result: ${JSON.stringify(result)}`);
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
