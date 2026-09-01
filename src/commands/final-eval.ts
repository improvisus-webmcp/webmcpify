import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { runApply } from "./apply.js";
import { runBaseline } from "./baseline.js";
import { runGenerate } from "./generate.js";
import { runRepair } from "./repair.js";
import { runReviewPrompt } from "./review.js";
import { runTest, type StoredTestEvaluation } from "./test.js";
import { loadApprovedTasks, taskFingerprint, type Task } from "../lib/tasks.js";
import { gitSourceSnapshot } from "../lib/patches.js";
import { createTrajectoryArtifact, latestTrajectoryPath } from "../lib/trajectories.js";
import type { TaskScoreSummary, TaskResult } from "../lib/scoring.js";

export interface FinalEvalOptions {
  path: string;
  url?: string;
  provider?: string;
  reviewPort?: string;
}

interface LevelResult {
  level: "baseline" | "webmcp" | "temporal";
  runId: string;
  targetProject: string;
  taskSetId: string;
  tasks: Task[];
  scores: TaskScoreSummary;
  evaluationPath?: string;
  status: "completed" | "failed";
  error?: string;
}

export interface FinalEvalResult {
  version: 1;
  runId: string;
  targetProject: string;
  taskSetId: string;
  tasks: Task[];
  levels: LevelResult[];
  repair?: { beforeEvaluation?: string; afterEvaluation?: string; status: string };
}

export function buildFinalEvalPlan(): string[] {
  return ["prepare-and-review", "baseline", "apply-and-test", "repair-if-needed", "temporal-evaluation", "compare-and-record"];
}

export function compareTaskSets(tasks: Task[], candidate: Task[]): void {
  if (taskFingerprint(tasks) !== taskFingerprint(candidate)) {
    throw new Error("Final evaluation levels do not use the exact same task definitions.");
  }
}

function failedSummary(tasks: Task[], error: unknown): TaskScoreSummary {
  const detail = error instanceof Error ? error.message : String(error);
  return { passed: 0, total: tasks.length, results: tasks.map((task) => ({ task: task.id, passed: false, detail })) };
}

async function readEvaluation(sitePath: string, role: "baseline-eval" | "test-eval"): Promise<{ path: string; value: StoredTestEvaluation }> {
  const evaluationPath = await latestTrajectoryPath(role, sitePath);
  if (!evaluationPath || !existsSync(evaluationPath)) throw new Error(`No project-scoped ${role} artifact was recorded for ${sitePath}.`);
  return { path: evaluationPath, value: JSON.parse(await readFile(evaluationPath, "utf8")) as StoredTestEvaluation };
}

async function runTemporalLevel(sitePath: string, url: string, provider: string, tasks: Task[], runId: string, taskSetId: string): Promise<LevelResult> {
  const { Client, Connection } = await import("@temporalio/client");
  const connection = await Connection.connect({ address: process.env.WEBMCPIFY_TEMPORAL_ADDRESS ?? "localhost:7233" });
  try {
    const client = new Client({ connection, namespace: process.env.WEBMCPIFY_TEMPORAL_NAMESPACE ?? "default" });
    const results: TaskResult[] = [];
    for (const task of tasks) {
      const workflowId = `final-eval-${runId}-${task.id}`;
      const handle = await client.workflow.start("repairWorkflow", {
        taskQueue: process.env.WEBMCPIFY_TEMPORAL_TASK_QUEUE ?? "webmcpify",
        workflowId,
        args: [{ path: sitePath, url, task: task.id, maxRepairs: 1, provider, runId, taskSetId }],
      });
      const result = await handle.result();
      results.push({ task: task.id, passed: result.passed, detail: result.reason ?? `durable workflow completed after ${result.attempts} repair attempt(s)` });
    }
    const scores = { passed: results.filter((result) => result.passed).length, total: tasks.length, results };
    return { level: "temporal", runId, targetProject: sitePath, taskSetId, tasks, scores, status: "completed" };
  } finally {
    await connection.close();
  }
}

export async function runFinalEval(opts: FinalEvalOptions): Promise<FinalEvalResult> {
  const sitePath = path.resolve(opts.path);
  const url = opts.url ?? process.env.WEBMCPIFY_URL ?? "http://localhost:3000";
  const provider = opts.provider ?? "antigravity";
  const runId = randomUUID();

  console.log(`[final-eval] target: ${sitePath}`);
  console.log(`[final-eval] URL: ${url}`);
  console.log("[final-eval] preparing discovery, structured proposals, and human review...");
  await runGenerate({ path: sitePath, provider, trajectoryMetadata: { finalEvalRunId: runId, level: "preparation" } });
  const review = await runReviewPrompt(sitePath, opts.reviewPort ?? "4173", { finalEvalRunId: runId, level: "preparation" });
  if (!review.approved) throw new Error("Final evaluation stopped because the WebMCP proposal was rejected.");

  const tasks = await loadApprovedTasks(sitePath);
  const taskSetId = taskFingerprint(tasks);
  console.log(`[final-eval] fixed approved task set: ${taskSetId} (${tasks.length} tasks)`);

  console.log("[final-eval] Level 1 — baseline (plain, read-only)...");
  const baselineSource = await gitSourceSnapshot(sitePath);
  const baseline = await runBaseline({ path: sitePath, url, provider, readOnly: true });
  compareTaskSets(tasks, baseline.tasks);
  const afterBaselineSource = await gitSourceSnapshot(sitePath);
  if (baselineSource.sourceVersion !== afterBaselineSource.sourceVersion || baselineSource.workingTreeHash !== afterBaselineSource.workingTreeHash) {
    throw new Error("The read-only baseline changed target source; refusing to continue to WebMCP application.");
  }
  const baselineLevel: LevelResult = { level: "baseline", runId: baseline.runId, targetProject: sitePath, taskSetId, tasks, scores: baseline.scores, evaluationPath: baseline.evaluationPath, status: "completed" };

  console.log("[final-eval] Level 2 — applying approved WebMCP change...");
  await runApply({ path: sitePath });
  const webmcpEvaluation = await runTest({ path: sitePath, url, provider });
  compareTaskSets(tasks, webmcpEvaluation.tasks);
  const webmcpArtifact = await readEvaluation(sitePath, "test-eval");
  const webmcpLevel: LevelResult = { level: "webmcp", runId: webmcpEvaluation.runId, targetProject: sitePath, taskSetId, tasks, scores: webmcpEvaluation.scores, evaluationPath: webmcpArtifact.path, status: "completed" };

  let repair: FinalEvalResult["repair"];
  if (webmcpLevel.scores.results.some((result) => !result.passed)) {
    console.log("[final-eval] WebMCP failures found; starting approved repair flow...");
    const beforeEvaluation = webmcpArtifact.path;
    await runRepair({ path: sitePath, url, provider, durable: false });
    const repairReview = await runReviewPrompt(sitePath, process.env.WEBMCPIFY_REPAIR_REVIEW_PORT ?? "4174", { finalEvalRunId: runId, level: "repair" });
    if (repairReview.approved) {
      await runApply({ path: sitePath });
      const repairedEvaluation = await runTest({ path: sitePath, url, provider });
      compareTaskSets(tasks, repairedEvaluation.tasks);
      const afterEvaluation = (await readEvaluation(sitePath, "test-eval")).path;
      repair = { beforeEvaluation, afterEvaluation, status: repairedEvaluation.scores.passed > webmcpLevel.scores.passed ? "improved" : repairedEvaluation.scores.passed < webmcpLevel.scores.passed ? "regressed" : "unchanged" };
      webmcpLevel.scores = repairedEvaluation.scores;
      webmcpLevel.runId = repairedEvaluation.runId;
      webmcpLevel.evaluationPath = afterEvaluation;
    } else {
      repair = { beforeEvaluation, status: "rejected" };
    }
  }

  console.log("[final-eval] Level 3 — durable Temporal evaluation...");
  let temporalLevel: LevelResult;
  try {
    temporalLevel = await runTemporalLevel(sitePath, url, provider, tasks, runId, taskSetId);
  } catch (error) {
    temporalLevel = { level: "temporal", runId, targetProject: sitePath, taskSetId, tasks, scores: failedSummary(tasks, error), status: "failed", error: error instanceof Error ? error.message : String(error) };
  }

  const result: FinalEvalResult = { version: 1, runId, targetProject: sitePath, taskSetId, tasks, levels: [baselineLevel, webmcpLevel, temporalLevel], repair };
  const artifact = await createTrajectoryArtifact("final-eval", result, { sitePath, targetProject: sitePath, runId, taskSetId, provider, url, levels: result.levels.map((level) => ({ level: level.level, status: level.status, passed: level.scores.passed, total: level.scores.total })), repair });
  console.log("\n[final-eval] comparison");
  for (const level of result.levels) console.log(`  ${level.level}: ${level.scores.passed}/${level.scores.total} (${level.status})`);
  console.log(`[final-eval] trajectory: ${artifact}`);
  if (temporalLevel.status === "failed") throw new Error(`Temporal level failed: ${temporalLevel.error}`);
  return result;
}
