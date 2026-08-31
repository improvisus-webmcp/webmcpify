import { runGenerate } from "../commands/generate.js";
import {
  runReviewPrompt,
  type ReviewResult,
} from "../commands/review.js";
import { scoreTasks } from "../lib/eval.js";

export interface ActivityTaskResult {
  task: string;
  passed: boolean;
  detail?: string;
}

/** Thin Temporal wrapper around the existing draft generator. */
export async function generateActivity(
  path: string,
  failureDetail?: string,
  provider?: string
): Promise<void> {
  await runGenerate({ path, context: failureDetail, provider });
}

/** Score one of the existing independent browser tasks. */
export async function testActivity(
  url: string,
  task: string
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

  return {
    task: result.name,
    passed: result.passed,
    detail: result.detail,
  };
}

/** Block on the existing localhost approval page until the owner decides. */
export async function reviewActivity(path: string): Promise<ReviewResult> {
  return runReviewPrompt(path);
}
