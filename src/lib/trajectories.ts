import { randomUUID } from "node:crypto";
import { access, appendFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { packageRoot } from "./paths.js";

export type TrajectoryStatus = "running" | "completed" | "failed";

export interface TrajectoryMetadata {
  role: string;
  status: TrajectoryStatus;
  startedAt?: string;
  finishedAt?: string;
  durationMs?: number;
  provider?: string;
  cwd?: string;
  prompt?: string;
  allowedTools?: string;
  mcpConfig?: string;
  [key: string]: unknown;
}

const trajectoryDirectory = path.join(packageRoot(), "trajectories");
const trajectoryIndex = path.join(trajectoryDirectory, "README.md");

function safeSegment(value: string): string {
  return (
    value
      .trim()
      .replace(/[^a-zA-Z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "run"
  );
}

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function metadataPath(rawPath: string): string {
  return rawPath.endsWith(".json")
    ? `${rawPath.slice(0, -5)}.meta.json`
    : `${rawPath}.meta.json`;
}

function relativeTrajectoryPath(filePath: string): string {
  return path.relative(trajectoryDirectory, filePath).split(path.sep).join("/");
}

function tableValue(value: unknown): string {
  return String(value ?? "—")
    .replaceAll("|", "\\|")
    .replace(/\r?\n/g, " ");
}

async function ensureIndex(): Promise<void> {
  await mkdir(trajectoryDirectory, { recursive: true });
  try {
    await access(trajectoryIndex);
  } catch {
    await writeFile(
      trajectoryIndex,
      `# WebMCPify trajectories

Each run keeps the provider's raw output in a JSON file and stores the run
instructions, target, permissions, timing, status, and related artifacts in the
matching \`.meta.json\` file. Structured evaluation, review, and Temporal
checkpoint artifacts are indexed here as well.

| Recorded | Role | Status | Provider | Task | Raw/artifact | Metadata |
| --- | --- | --- | --- | --- | --- | --- |
`,
      "utf8"
    );
  }
}

async function appendIndexEntry(
  rawPath: string,
  metadataFilePath: string,
  metadata: TrajectoryMetadata
): Promise<void> {
  await ensureIndex();
  const recordedAt = metadata.finishedAt ?? metadata.startedAt;
  const rawName = relativeTrajectoryPath(rawPath);
  const metadataName = relativeTrajectoryPath(metadataFilePath);
  await appendFile(
    trajectoryIndex,
    `| ${tableValue(recordedAt)} | ${tableValue(metadata.role)} | ${tableValue(
      metadata.status
    )} | ${tableValue(metadata.provider)} | ${tableValue(
      metadata.task
    )} | [${tableValue(rawName)}](./${rawName}) | [metadata](./${metadataName}) |\n`,
    "utf8"
  );
}

export function createTrajectoryPath(role: string, label?: string): string {
  const suffix = label ? `-${safeSegment(label)}` : "";
  return path.join(
    trajectoryDirectory,
    `${safeSegment(role)}-${timestamp()}-${randomUUID().slice(0, 8)}${suffix}.json`
  );
}

export async function recordTrajectoryMetadata(
  rawPath: string,
  metadata: TrajectoryMetadata
): Promise<string> {
  const metadataFilePath = metadataPath(rawPath);
  await mkdir(path.dirname(rawPath), { recursive: true });
  await writeFile(
    metadataFilePath,
    JSON.stringify(
      {
        version: 1,
        ...metadata,
        trajectory: relativeTrajectoryPath(rawPath),
      },
      null,
      2
    ) + "\n",
    "utf8"
  );
  await appendIndexEntry(rawPath, metadataFilePath, metadata);
  return metadataFilePath;
}

export async function writeTrajectoryArtifact(
  rawPath: string,
  value: unknown,
  metadata: TrajectoryMetadata
): Promise<string> {
  await mkdir(path.dirname(rawPath), { recursive: true });
  await writeFile(rawPath, JSON.stringify(value, null, 2) + "\n", "utf8");
  return recordTrajectoryMetadata(rawPath, metadata);
}

export async function createTrajectoryArtifact(
  role: string,
  value: unknown,
  metadata: Omit<TrajectoryMetadata, "role" | "status"> &
    Partial<Pick<TrajectoryMetadata, "status">>,
  label?: string
): Promise<string> {
  const rawPath = createTrajectoryPath(role, label);
  await writeTrajectoryArtifact(rawPath, value, {
    ...metadata,
    role,
    status: metadata.status ?? "completed",
  });
  return rawPath;
}

export async function latestTrajectoryPath(
  role: string,
  sitePath?: string
): Promise<string | undefined> {
  await mkdir(trajectoryDirectory, { recursive: true });
  const prefix = `${safeSegment(role)}-`;
  const entries = await readdir(trajectoryDirectory, { withFileTypes: true });
  const dynamic = entries
    .filter(
      (entry) =>
        entry.isFile() &&
        entry.name.startsWith(prefix) &&
        entry.name.endsWith(".json") &&
        !entry.name.endsWith(".meta.json")
    )
    .map((entry) => entry.name)
    .sort();

  if (dynamic.length > 0) {
    const candidates = dynamic.reverse();
    if (!sitePath) return path.join(trajectoryDirectory, candidates[0]);
    const target = path.resolve(sitePath);
    for (const candidate of candidates) {
      const candidatePath = path.join(trajectoryDirectory, candidate);
      try {
        const metadata = JSON.parse(await readFile(metadataPath(candidatePath), "utf8")) as Record<string, unknown>;
        const recordedSite = metadata.sitePath ?? metadata.cwd ?? metadata.targetProject;
        if (typeof recordedSite === "string" && path.resolve(recordedSite) === target) return candidatePath;
      } catch {
        // Ignore malformed/unrelated artifacts while searching for this project.
      }
    }
    return undefined;
  }

  const legacy = path.join(trajectoryDirectory, `${safeSegment(role)}.json`);
  try {
    await access(legacy);
    if (!sitePath) return legacy;
    const metadata = JSON.parse(await readFile(metadataPath(legacy), "utf8")) as Record<string, unknown>;
    const recordedSite = metadata.sitePath ?? metadata.cwd ?? metadata.targetProject;
    return typeof recordedSite === "string" && path.resolve(recordedSite) === path.resolve(sitePath)
      ? legacy
      : undefined;
  } catch {
    return undefined;
  }
}

export function trajectoryDirectoryPath(): string {
  return trajectoryDirectory;
}
