import { cp, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/**
 * Agents always run against a disposable copy. The target checkout is only
 * changed later by WebMCPify's explicit review/apply boundary.
 */
export async function createAgentWorkspace(sitePath: string): Promise<string> {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "webmcpify-agent-"));
  await cp(sitePath, workspace, {
    recursive: true,
    filter: (source) =>
      !source.includes(`${path.sep}.git${path.sep}`) &&
      !source.includes(`${path.sep}.webmcpify${path.sep}`) &&
      !source.includes(`${path.sep}node_modules${path.sep}`),
  });
  return workspace;
}

export async function removeAgentWorkspace(workspace: string): Promise<void> {
  await rm(workspace, { recursive: true, force: true });
}
