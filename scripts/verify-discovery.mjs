import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { discoverProject, discoveryPath } from "../dist/lib/discovery.js";

const targets = process.argv.slice(2);
if (targets.length === 0) {
  targets.push("/home/olumide/Desktop/webmcp-coffee-store", "/home/olumide/Desktop/commerce");
}

for (const target of targets) {
  const sitePath = path.resolve(target);
  assert.ok(existsSync(discoveryPath(sitePath)), `${sitePath}: discovery.json missing`);
  const stored = JSON.parse(readFileSync(discoveryPath(sitePath), "utf8"));
  assert.equal(stored.version, 1);
  assert.equal(stored.targetProject, sitePath);
  assert.ok(Array.isArray(stored.stack.language));
  assert.ok(Array.isArray(stored.routes));
  assert.ok(Array.isArray(stored.actions));
  assert.ok(Array.isArray(stored.apis));
  assert.ok(stored.filesScanned > 0);
  const fresh = await discoverProject(sitePath);
  assert.equal(fresh.stack.framework, stored.stack.framework);
  console.log(`${sitePath}: valid discovery (${stored.filesScanned} files, ${stored.routes.length} routes, ${stored.actions.length} actions)`);
}
