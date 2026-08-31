import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { latestTrajectoryPath } from "../lib/trajectories.js";
import type { StoredTestEvaluation } from "./test.js";

function displaySymbol(passed: boolean): string {
  return passed ? "PASS" : "FAIL";
}

export async function runEval() {
  const evaluationPath = await latestTrajectoryPath("test-eval");
  if (!evaluationPath || !existsSync(evaluationPath)) {
    throw new Error(
      "No test evaluation found in trajectories. Run \"webmcpify test\" first."
    );
  }

  let evaluation: StoredTestEvaluation;
  try {
    evaluation = JSON.parse(
      await readFile(evaluationPath, "utf8")
    ) as StoredTestEvaluation;
  } catch (error) {
    throw new Error(
      `Could not read the last test evaluation: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }

  console.log(
    `[eval] ${evaluation.scores.passed}/${evaluation.scores.total} tasks passed ` +
      `(provider: ${evaluation.provider}, url: ${evaluation.url})`
  );
  for (const task of evaluation.scores.tasks) {
    const detail = task.detail ? ` — ${task.detail}` : "";
    console.log(`  [${displaySymbol(task.passed)}] ${task.name}${detail}`);
  }

  return evaluation;
}
