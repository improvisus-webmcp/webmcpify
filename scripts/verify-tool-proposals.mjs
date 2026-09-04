import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { discoverProject } from "../dist/lib/discovery.js";
import { extractAndValidateProposedTools, writeProposedTools } from "../dist/lib/tool-proposals.js";

const targets = process.argv.slice(2);
if (targets.length === 0) targets.push("/home/olumide/Desktop/webmcp-coffee-store", "/home/olumide/Desktop/commerce");

for (const target of targets) {
  const sitePath = path.resolve(target);
  const discovery = await discoverProject(sitePath);
  const file = discovery.actions[0]?.file ?? discovery.forms[0]?.file;
  assert.ok(file, `${sitePath}: no actionable discovery signal`);
  const tool = {
    id: "discovered_action",
    name: "discovered_action",
    description: "Runs a discovered action.",
    title: "Discovered action",
    parameters: { type: "object", properties: {}, required: [], additionalProperties: false },
    annotations: { readOnlyHint: false, untrustedContentHint: false, consequentialHint: true },
    implementation: { handler: `${file}#handler`, action: "discovered action" },
    placement: { strategy: "imperative", file, rationale: "Uses the discovered action location." },
    sourceFiles: [file],
  };
  const validTools = extractAndValidateProposedTools(JSON.stringify({ tools: [tool] }), discovery);
  assert.equal(validTools.length, 1);
  const temporaryProject = await mkdtemp(path.join(os.tmpdir(), "webmcpify-tools-"));
  const proposalPath = await writeProposedTools(temporaryProject, validTools, "discovery.json", "generation.json");
  assert.equal(JSON.parse(await readFile(proposalPath, "utf8")).tools.length, 1);
  await rm(temporaryProject, { recursive: true, force: true });
  assert.throws(() => extractAndValidateProposedTools(JSON.stringify({ tools: [tool, { ...tool, id: "other_action" }] }), discovery), /Duplicate tool name/);
  assert.throws(() => extractAndValidateProposedTools(JSON.stringify({ tools: [{ ...tool, sourceFiles: ["missing.ts"], placement: { ...tool.placement, file: "missing.ts" } }] }), discovery), /no source file/);
  assert.throws(() => extractAndValidateProposedTools(JSON.stringify({ tools: [{ id: "bad", name: "bad", description: "missing schema" }] }), discovery), /parameters/);
  console.log(`${sitePath}: structured proposal validation passed`);
}
