import { runGenerate } from "../commands/generate.js";
import {
  runReviewPrompt,
  type ReviewResult,
} from "../commands/review.js";
import { scoreTasks } from "../lib/scoring.js";
import { loadTasks } from "../lib/tasks.js";
import { createTrajectoryArtifact } from "../lib/trajectories.js";

export interface ActivityTaskResult {
  task: string;
  passed: boolean;
  detail?: string;
}

/** Thin Temporal wrapper around the existing draft generator. */
export async function generateActivity(
  path: string,
  failureDetail?: string,
  provider?: string,
  attempt?: number
): Promise<void> {
  await runGenerate({
    path,
    context: failureDetail,
    provider,
    trajectoryMetadata: {
      durable: true,
      attempt,
    },
  });
}

/** Score one approved project task through the independent browser scorer. */
export async function testActivity(
  sitePath: string,
  url: string,
  task: string,
  attempt?: number
): Promise<ActivityTaskResult> {
  const tasks = await loadTasks(sitePath);
  const { results } = await scoreTasks(url, tasks);
  const result = results.find((candidate) => candidate.task === task);
  if (!result) {
    throw new Error(
      `Unknown scoring task "${task}". Available tasks: ${tasks
        .map((candidate) => candidate.id)
        .join(", ")}`
    );
  }

  const taskResult = {
    task: result.task,
    passed: result.passed,
    detail: result.detail,
  };
  await createTrajectoryArtifact(
    "temporal-test",
    {
      url,
      task: taskResult,
      attempt,
    },
    {
      url,
      task,
      attempt,
      tasksPath: `${sitePath}/tasks.json`,
      durable: true,
    }
  );
  return taskResult;
}

/** Block on the existing localhost approval page until the owner decides. */
export async function reviewActivity(
  path: string,
  attempt?: number
): Promise<ReviewResult> {
  return runReviewPrompt(path, undefined, {
    durable: true,
    attempt,
  });
}
