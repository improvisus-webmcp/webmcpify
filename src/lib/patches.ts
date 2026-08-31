import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { createTrajectoryArtifact } from "./trajectories.js";

const execFileAsync = promisify(execFile);

export type PatchStatus = "awaiting-review" | "approved" | "rejected" | "applied" | "failed" | "invalid";

export interface PatchMetadata {
  version: 1;
  runId: string;
  timestamp: string;
  targetProject: string;
  sourceVersion?: string;
  workingTreeHash?: string;
  changedFiles: string[];
  patchStatus: PatchStatus;
  patchPath: string;
  generationTrajectory: string;
  repair?: {
    sourceEvaluation: string;
    url: string;
    taskSetId?: string;
    failedTaskIds: string[];
  };
  error?: string;
  lastApply?: { timestamp: string; status: string; error?: string };
}

function patchPath(sitePath: string): string {
  return path.join(sitePath, ".webmcpify", "pending-diff.patch");
}

export function patchMetadataPath(sitePath: string): string {
  return path.join(sitePath, ".webmcpify", "pending-diff.meta.json");
}

export function patchArtifactPath(sitePath: string): string {
  return patchPath(sitePath);
}

function textFromProviderOutput(raw: string): string {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === "string") return parsed;
    const values: string[] = [];
    const collect = (value: unknown, key?: string): void => {
      if (typeof value === "string") {
        if (!key || ["response", "result", "text", "output", "message", "content"].includes(key)) values.push(value);
        return;
      }
      if (Array.isArray(value)) { value.forEach((entry) => collect(entry)); return; }
      if (typeof value === "object" && value !== null) {
        for (const [childKey, childValue] of Object.entries(value)) collect(childValue, childKey);
      }
    };
    collect(parsed);
    if (values.length) return values.join("\n");
  } catch {
    // Provider output may be plain text.
  }
  return raw;
}

function candidatePatches(text: string): string[] {
  const candidates: string[] = [];
  for (const match of text.matchAll(/```(?:diff|patch)?\s*([\s\S]*?)```/gi)) {
    if (match[1]?.includes("diff --git ")) candidates.push(match[1].trim());
  }
  const firstDiff = text.indexOf("diff --git ");
  if (firstDiff >= 0) candidates.push(text.slice(firstDiff).trim());
  return candidates;
}

function changedFiles(patch: string): string[] {
  const files = new Set<string>();
  for (const match of patch.matchAll(/^diff --git a\/(\S+) b\/(\S+)$/gm)) {
    files.add(match[1]);
    files.add(match[2]);
  }
  return [...files];
}

function validatePatchPaths(files: string[]): void {
  if (files.length === 0) throw new Error("The diff does not contain any changed files.");
  for (const file of files) {
    if (path.isAbsolute(file) || file.startsWith("../") || file.includes("/../") || file.startsWith(".webmcpify/")) {
      throw new Error(`The diff contains an unsafe target path: ${file}`);
    }
  }
}

export function extractUnifiedDiff(rawProviderOutput: string): { patch: string; changedFiles: string[] } {
  const text = textFromProviderOutput(rawProviderOutput);
  for (const candidate of candidatePatches(text)) {
    const files = changedFiles(candidate);
    try {
      validatePatchPaths(files);
      return { patch: `${candidate.trim()}\n`, changedFiles: files };
    } catch {
      // Try the next possible fenced or embedded diff.
    }
  }
  throw new Error("The provider output did not contain a valid unified diff beginning with 'diff --git'.");
}

async function gitOutput(sitePath: string, args: string[]): Promise<string | undefined> {
  try {
    const result = await execFileAsync("git", args, { cwd: sitePath, maxBuffer: 10 * 1024 * 1024 });
    return result.stdout;
  } catch {
    return undefined;
  }
}

async function validateAgainstGit(sitePath: string, patch: string): Promise<void> {
  const temporaryPath = path.join(sitePath, ".webmcpify", `.pending-${randomUUID()}.patch`);
  await mkdir(path.dirname(temporaryPath), { recursive: true });
  await writeFile(temporaryPath, patch, "utf8");
  try {
    await execFileAsync("git", ["apply", "--check", "--whitespace=nowarn", temporaryPath], {
      cwd: sitePath,
      maxBuffer: 10 * 1024 * 1024,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`The extracted diff cannot be applied to the current target: ${detail}`);
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

export async function gitSourceSnapshot(sitePath: string): Promise<{ sourceVersion?: string; workingTreeHash?: string }> {
  const sourceVersion = (await gitOutput(sitePath, ["rev-parse", "HEAD"]))?.trim();
  if (!sourceVersion) return {};
  const diff = await gitOutput(sitePath, ["diff", "--binary", "HEAD"]) ?? "";
  const status = (await gitOutput(sitePath, ["status", "--porcelain", "--untracked-files=all"]) ?? "")
    .split("\n")
    .filter((line) => !line.includes(".webmcpify/"))
    .join("\n");
  return {
    sourceVersion,
    workingTreeHash: createHash("sha256").update(`${status}\0${diff}`).digest("hex"),
  };
}

export async function readPatchMetadata(sitePath: string): Promise<PatchMetadata> {
  return JSON.parse(await readFile(patchMetadataPath(sitePath), "utf8")) as PatchMetadata;
}

export async function writePatchMetadata(sitePath: string, metadata: PatchMetadata): Promise<void> {
  await mkdir(path.dirname(patchMetadataPath(sitePath)), { recursive: true });
  await writeFile(patchMetadataPath(sitePath), `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
}

export async function createPendingPatch(
  sitePath: string,
  rawProviderOutput: string,
  generationTrajectory: string,
  context?: Pick<PatchMetadata, "repair">,
): Promise<PatchMetadata> {
  const timestamp = new Date().toISOString();
  const runId = randomUUID();
  const base = {
    version: 1 as const,
    runId,
    timestamp,
    targetProject: sitePath,
    ...await gitSourceSnapshot(sitePath),
    patchPath: patchPath(sitePath),
    generationTrajectory,
    ...context,
  };

  try {
    const extracted = extractUnifiedDiff(rawProviderOutput);
    if (!(await gitSourceSnapshot(sitePath)).sourceVersion) {
      throw new Error("The target project must be a Git repository to validate a source diff.");
    }
    await validateAgainstGit(sitePath, extracted.patch);
    const metadata: PatchMetadata = {
      ...base,
      changedFiles: extracted.changedFiles,
      patchStatus: "awaiting-review",
    };
    await mkdir(path.dirname(patchPath(sitePath)), { recursive: true });
    await writeFile(patchPath(sitePath), extracted.patch, "utf8");
    await writePatchMetadata(sitePath, metadata);
    await createTrajectoryArtifact("patch", { ...metadata, patch: extracted.patch }, {
      sitePath,
      runId,
      patchPath: patchPath(sitePath),
      sourceTrajectory: generationTrajectory,
      changedFiles: extracted.changedFiles,
    });
    return metadata;
  } catch (error) {
    const metadata: PatchMetadata = {
      ...base,
      changedFiles: [],
      patchStatus: "invalid",
      error: error instanceof Error ? error.message : String(error),
    };
    await writePatchMetadata(sitePath, metadata);
    throw new Error(`Generation did not produce an applicable source diff: ${metadata.error}`);
  }
}

export function patchExists(sitePath: string): boolean {
  return existsSync(patchPath(sitePath)) && existsSync(patchMetadataPath(sitePath));
}
