import { execa } from "execa";
import { existsSync } from "node:fs";
import { lstat, mkdir, readdir, readFile, symlink } from "node:fs/promises";
import path from "node:path";

type PackageJson = {
  scripts?: Record<string, string>;
};

function packageManager(sitePath: string): string {
  if (process.env.WEBMCPIFY_PACKAGE_MANAGER) return process.env.WEBMCPIFY_PACKAGE_MANAGER;
  if (existsSync(path.join(sitePath, "pnpm-lock.yaml"))) return "pnpm";
  if (existsSync(path.join(sitePath, "yarn.lock"))) return "yarn";
  if (existsSync(path.join(sitePath, "package-lock.json"))) return "npm";
  return "pnpm";
}

async function readScripts(sitePath: string): Promise<Record<string, string>> {
  try {
    const packageJson = JSON.parse(
      await readFile(path.join(sitePath, "package.json"), "utf8")
    ) as PackageJson;
    return packageJson.scripts ?? {};
  } catch {
    return {};
  }
}

/**
 * Give the disposable workspace access to already-installed dependencies
 * without copying hundreds of megabytes or writing anything into the target's
 * node_modules. Build caches are kept local to the disposable workspace.
 */
async function linkDependencies(sitePath: string, workspace: string): Promise<boolean> {
  const targetNodeModules = path.join(sitePath, "node_modules");
  if (!existsSync(targetNodeModules)) return false;

  const workspaceNodeModules = path.join(workspace, "node_modules");
  await mkdir(path.join(workspaceNodeModules, ".tmp"), { recursive: true });
  for (const entry of await readdir(targetNodeModules, { withFileTypes: true })) {
    if (entry.name === ".tmp" || entry.name === ".cache") continue;
    const targetEntry = path.join(targetNodeModules, entry.name);
    const workspaceEntry = path.join(workspaceNodeModules, entry.name);
    // The provider or package manager may already have created this entry in
    // the disposable workspace (most commonly node_modules/.bin). Reusing it
    // makes preflight safe to retry after a generated-source repair.
    try {
      await lstat(workspaceEntry);
      continue;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    await symlink(targetEntry, workspaceEntry);
  }
  return true;
}

function outputFromError(error: unknown): string {
  if (typeof error !== "object" || error === null) return String(error);
  const record = error as { stdout?: unknown; stderr?: unknown; message?: unknown };
  const output = [record.stdout, record.stderr]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .join("\n")
    .trim();
  return output || (typeof record.message === "string" ? record.message : String(error));
}

/** Run the real project check before a generated patch can reach review. */
export async function runGenerationPreflight(
  sitePath: string,
  workspace: string,
): Promise<void> {
  const scripts = await readScripts(sitePath);
  const hasTypeScript = existsSync(path.join(sitePath, "node_modules", ".bin", "tsc"));
  const checks: Array<{ label: string; command: string; args: string[] }> = [];
  if (scripts.typecheck) {
    checks.push({ label: "typecheck", command: packageManager(sitePath), args: ["run", "typecheck"] });
  } else if (hasTypeScript) {
    checks.push({ label: "TypeScript build", command: path.join(workspace, "node_modules", ".bin", "tsc"), args: ["-b", "--pretty", "false"] });
  }
  // A typecheck does not prove that the framework bundler can resolve imports
  // or produce the deployable client/server output. Run an explicit build too
  // when the target provides one.
  if (scripts.build && !scripts.typecheck?.includes("build")) {
    checks.push({ label: "build", command: packageManager(sitePath), args: ["run", "build"] });
  }
  if (checks.length === 0) {
    console.log("[generate] preflight skipped; no typecheck, TypeScript, or build check found");
    return;
  }

  if (!(await linkDependencies(sitePath, workspace))) {
    console.warn(
      `[generate] preflight skipped; ${checks.map((check) => check.label).join(" and ")} requires dependencies but target node_modules is not installed`
    );
    return;
  }

  const startedMs = Date.now();
  console.log(`[generate] preflight running ${checks.map((check) => check.label).join(" + ")} in disposable workspace...`);

  try {
    for (const check of checks) {
      await execa(check.command, check.args, {
        cwd: workspace,
        maxBuffer: 20 * 1024 * 1024,
      });
      console.log(`[generate] preflight ${check.label} passed`);
    }
    console.log(`[generate] preflight passed (${Math.round((Date.now() - startedMs) / 1000)}s elapsed)`);
  } catch (error) {
    // The complete command output is retained by the thrown error/trajectory;
    // only the actionable tail needs to reach any focused repair prompt.
    const details = outputFromError(error).slice(-4_000);
    throw new Error(
      `Generated source failed pre-approval validation. No source patch was applied and no review approval was created.\n${details}`
    );
  }
}
