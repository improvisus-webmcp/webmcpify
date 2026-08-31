import { runGenerate } from "../commands/generate.js";
import {
  runReviewPrompt,
  type ReviewResult,
} from "../commands/review.js";
import { scoreTasks } from "../lib/eval.js";
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

/** Score one of the existing independent browser tasks. */
export async function testActivity(
  url: string,
  task: string,
  attempt?: number
): Promise<ActivityTaskResult> {
  const { tasks } = await scoreTasks(url);
  const result = tasks.find((candidate) => candidate.name === task);
  if (!result) {
    throw new Error(
      `Unknown scoring task "${task}". Available tasks: ${tasks
        .map((candidate) => candidate.name)
        .join(", ")}`
    );
  }

  const taskResult = {
    task: result.name,
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
