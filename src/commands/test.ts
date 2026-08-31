import path from "node:path";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { runAgent } from "../lib/agent.js";
import { resolveProvider } from "../lib/ai-provider.js";
import { scoreTasks, type TaskScoreSummary } from "../lib/scoring.js";
import { loadTasks, type Task } from "../lib/tasks.js";
import { writeChromeDevtoolsMcpConfig } from "../lib/mcp-config.js";
import {
  createTrajectoryArtifact,
  createTrajectoryPath,
} from "../lib/trajectories.js";

const TEST_EVALUATION_VERSION = 1;

export interface TestOptions {
  url: string;
  provider?: string;
  path?: string;
}

export interface StoredTestEvaluation {
  version: number;
  provider: string;
  url: string;
  recordedAt: string;
  tasks: Task[];
  scores: TaskScoreSummary;
}

async function readApprovalContext(sitePath: string): Promise<string> {
  const approvalPath = path.join(
    sitePath,
    ".webmcpify",
    "approved-tools.json"
  );

  if (!existsSync(approvalPath)) {
    throw new Error(
      `No approved tools manifest found at ${approvalPath}. Run "webmcpify review" first.`
    );
  }

  const approved = await readFile(approvalPath, "utf8");
  return `The human-approved tool manifest is at ${approvalPath}. Read it and
use only the tools listed there. Its contents are:\n${approved}`;
}

export async function runTest(opts: TestOptions): Promise<StoredTestEvaluation> {
  const provider = resolveProvider(opts.provider);
  const sitePath = path.resolve(opts.path ?? process.cwd());
  const tasks = await loadTasks(sitePath);
  const trajectory = createTrajectoryPath("test", "all-tasks");
  const approvalPath = path.join(
    sitePath,
    ".webmcpify",
    "approved-tools.json"
  );
  const approvalContext = await readApprovalContext(sitePath);
  const hadMcpConfig = existsSync(path.join(sitePath, ".mcp.json"));
  const mcpConfig = await writeChromeDevtoolsMcpConfig(sitePath);

  if (!hadMcpConfig) {
    console.log(`[test] no .mcp.json found; created ${mcpConfig} for this audit`);
  }

  const prompt = `Run an isolated WebMCP audit against the already-running site at
${opts.url}. Do not edit the site's files. Use the chrome-devtools MCP tools to
inspect the live page, infer its core user-facing actions, list the available
WebMCP tools, and exercise the approved tools through their real tool
interface.

For every discovered tool, report its name, input used, execution result, and
any state-dependent registration or unregistration. Also check the site's
important UI flows, such as search, filtering, navigation, form submission,
adding or removing items, authentication, or checkout when those actions are
actually present. Do not assume a domain or invent actions that the site does
not expose.

${approvalContext}

The reviewed task list for this run is:
${JSON.stringify(tasks, null, 2)}
Attempt every task using only the live browser and approved WebMCP tools.

Report each check as pass or fail, include observed details, and do not claim a
pass from assumptions or from merely inspecting source code.`;

  console.log(`[test] running isolated ${provider} browser audit against ${opts.url}...`);

  await runAgent({
    provider,
    prompt,
    cwd: sitePath,
    allowedTools: "mcp__chrome-devtools__*",
    mcpConfig,
    saveTo: trajectory,
    trajectoryMetadata: {
      role: "test",
      sitePath,
      url: opts.url,
      approvalPath,
      isolation: "mcp-only; no source access",
    },
  });

  console.log("[test] agent session complete; running independent evaluator...");
  const scores = await scoreTasks(opts.url, tasks);
  const evaluation: StoredTestEvaluation = {
    version: TEST_EVALUATION_VERSION,
    provider,
    url: opts.url,
    recordedAt: new Date().toISOString(),
    tasks,
    scores,
  };

  const evaluationPath = await createTrajectoryArtifact(
    "test-eval",
    evaluation,
    {
      provider,
      url: opts.url,
      sitePath,
      taskCount: scores.total,
      sourceTrajectory: trajectory,
      approvalPath,
    }
  );

  console.log(`[test] result: ${scores.passed}/${scores.total} tasks passed`);
  console.log(`[test] raw trajectory saved to ${trajectory}`);
  console.log(`[test] evaluation saved to ${evaluationPath}`);
  return evaluation;
}
