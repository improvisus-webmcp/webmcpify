import path from "node:path";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { runAgent } from "../lib/agent.js";
import { resolveProvider } from "../lib/ai-provider.js";
import { scoreTasks } from "../lib/scoring.js";
import { loadApprovedTasks, taskFingerprint } from "../lib/tasks.js";
import {
  DISCOVERY_GUIDANCE,
  TOOL_PLACEMENT_GUIDANCE,
} from "../lib/prompts.js";
import {
  createTrajectoryArtifact,
  createTrajectoryPath,
} from "../lib/trajectories.js";
import { writeChromeDevtoolsMcpConfig } from "../lib/mcp-config.js";
import { createAgentWorkspace, removeAgentWorkspace } from "../lib/agent-workspace.js";

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
  readOnly?: boolean;
}) {
  const provider = resolveProvider(opts.provider);
  const sitePath = path.resolve(opts.path);
  const tasks = await loadApprovedTasks(sitePath);
  const runId = randomUUID();
  const taskSetId = taskFingerprint(tasks);
  const trajectoryPath = createTrajectoryPath("baseline", undefined, sitePath);
  const mcpConfigPath = path.join(sitePath, ".mcp.json");
  const baselineMcpConfig = opts.readOnly ? await writeChromeDevtoolsMcpConfig(sitePath) : mcpConfigPath;
  const taskContext = `Use these reviewed project tasks as the fixed evaluation
cases. Attempt them through the site's real UI or WebMCP tools, and report the
observed result for each:
${JSON.stringify(tasks, null, 2)}`;

  const baselinePrompt = opts.readOnly
    ? `This is the plain baseline level. Do not edit source files, install dependencies, create WebMCP registrations, or call WebMCP tools. Inspect and exercise only the existing user-facing UI with Chrome DevTools MCP. Use the exact reviewed tasks below and report each observed outcome.\n\n${JSON.stringify(tasks, null, 2)}`
    : `${AUDIT_PROMPT}\n\n${taskContext}`;

  console.log(`[baseline] running one-shot ${opts.readOnly ? "read-only " : ""}baseline ${provider} session...`);

  const agentWorkspace = await createAgentWorkspace(sitePath);
  let agentError: string | undefined;
  try {
    await runAgent({
      provider,
      prompt: baselinePrompt,
      cwd: agentWorkspace,
      allowedTools: "Read,mcp__chrome-devtools__*",
      mcpConfig: existsSync(baselineMcpConfig) ? baselineMcpConfig : undefined,
      saveTo: trajectoryPath,
      trajectoryMetadata: {
        role: "baseline",
        runId,
        sitePath,
        url: opts.url,
        tasksPath: path.join(sitePath, "tasks.json"),
        taskCount: tasks.length,
        taskSetId,
      },
    });
  } catch (error) {
    agentError = error instanceof Error ? error.message : String(error);
    console.error(`[baseline] agent session failed: ${agentError}`);
    console.error("[baseline] continuing with independent live-page scoring...");
  } finally {
    await removeAgentWorkspace(agentWorkspace);
  }

  if (!agentError) console.log(`[baseline] session complete, saved to ${trajectoryPath}`);
  console.log("[baseline] running independent eval check against live site...");

  const scores = await scoreTasks(opts.url, tasks);
  const evaluationPath = await createTrajectoryArtifact(
    "baseline-eval",
    { version: 1, mode: "baseline", runId, targetProject: sitePath, taskSetId, tasks, scores, agentError },
    {
      provider,
      url: opts.url,
      sourceTrajectory: trajectoryPath,
      cwd: sitePath,
      sitePath,
      runId,
      targetProject: sitePath,
      mode: "baseline",
      taskSetId,
      taskCount: scores.total,
    }
  );
  console.log(`[baseline] result: ${scores.passed}/${scores.total} tasks passed`);
  console.log(`[baseline] independent evaluation saved to ${evaluationPath}`);
  return { runId, evaluationPath, tasks, scores, agentError };
}
