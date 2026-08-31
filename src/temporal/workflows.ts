import { proxyActivities } from "@temporalio/workflow";
import type * as activities from "./activities.js";

const { generateActivity, testActivity, reviewActivity, applyActivity } =
  proxyActivities<typeof activities>({
    startToCloseTimeout: "5 minutes",
    retry: { maximumAttempts: 3 },
  });

export interface RepairWorkflowOptions {
  path: string;
  url: string;
  task: string;
  maxRepairs?: number;
  provider?: string;
  runId?: string;
  taskSetId?: string;
}

export interface RepairWorkflowResult {
  passed: boolean;
  attempts: number;
  task: string;
  reason?: string;
}

export async function repairWorkflow(
  opts: RepairWorkflowOptions
): Promise<RepairWorkflowResult> {
  const maxRepairs = opts.maxRepairs ?? 3;
  if (!Number.isInteger(maxRepairs) || maxRepairs < 0) {
    throw new Error("maxRepairs must be a non-negative integer");
  }

  for (let attempt = 0; attempt <= maxRepairs; attempt++) {
    const result = await testActivity(opts.path, opts.url, opts.task, attempt, opts.runId, opts.taskSetId);
    if (result.passed) {
      return { passed: true, attempts: attempt, task: opts.task };
    }

    if (attempt === maxRepairs) {
      return {
        passed: false,
        attempts: attempt,
        task: opts.task,
        reason: result.detail ?? "The task still failed after the repair budget.",
      };
    }

    await generateActivity(opts.path, result.detail, opts.provider, attempt);
    const review = await reviewActivity(opts.path, attempt);
    if (!review.approved) {
      return {
        passed: false,
        attempts: attempt,
        task: opts.task,
        reason: "The owner rejected the proposed repair.",
      };
    }
    await applyActivity(opts.path);
  }

  // The loop always returns, but keeping an explicit fallback makes future
  // changes to the loop bounds type-safe and obvious.
  return {
    passed: false,
    attempts: maxRepairs,
    task: opts.task,
    reason: "The repair workflow ended without a result.",
  };
}
