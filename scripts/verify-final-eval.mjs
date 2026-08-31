import assert from "node:assert/strict";
import { buildFinalEvalPlan, compareTaskSets } from "../dist/commands/final-eval.js";

const tasks = [
  { id: "compare", description: "Compare two products", verify: "document.body.dataset.compare === 'true'" },
  { id: "flight", description: "Build a tasting flight", verify: "document.body.dataset.flight === 'true'" },
];
assert.deepEqual(buildFinalEvalPlan(), [
  "prepare-and-review",
  "baseline",
  "apply-and-test",
  "repair-if-needed",
  "temporal-evaluation",
  "compare-and-record",
]);
compareTaskSets(tasks, structuredClone(tasks));
assert.throws(() => compareTaskSets(tasks, [{ ...tasks[0], verify: "false" }, tasks[1]]), /exact same task definitions/);
console.log("final-eval verification passed: ordered orchestration and exact task-set guard");
