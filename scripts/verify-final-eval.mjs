import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildFinalEvalPlan, compareTaskSets } from "../dist/commands/final-eval.js";
import { initializeAgentWorkspace, readAgentWorkspaceDiff } from "../dist/lib/agent-workspace.js";

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

const workspace = await mkdtemp(path.join(os.tmpdir(), "webmcpify-final-eval-diff-"));
try {
  await mkdir(path.join(workspace, "src"));
  await writeFile(path.join(workspace, "src", "main.tsx"), "export const app = true;\n");
  await initializeAgentWorkspace(workspace);
  await writeFile(path.join(workspace, "src", "main.tsx"), "import { registerGlobalTools } from './webmcp';\nexport const app = true;\n");
  await writeFile(path.join(workspace, "src", "webmcp.ts"), "export function registerGlobalTools() {}\n");
  await mkdir(path.join(workspace, ".agents"));
  await writeFile(path.join(workspace, ".agents", "mcp_config.json"), "{}\n");
  await mkdir(path.join(workspace, ".webmcpify"));
  await writeFile(path.join(workspace, ".webmcpify", "discovery.json"), "{}\n");
  await writeFile(path.join(workspace, "tasks.json"), "[]\n");
  const diff = await readAgentWorkspaceDiff(workspace);
  assert.ok(diff.includes("new file mode 100644"));
  assert.ok(diff.includes("src/webmcp.ts"));
  assert.equal(diff.includes("mcp_config"), false);
  assert.equal(diff.includes("discovery.json"), false);
  assert.equal(diff.includes("tasks.json"), false);
} finally {
  await rm(workspace, { recursive: true, force: true });
}

console.log("final-eval verification passed: orchestration, exact task-set guard, and new-file diff capture");
