import { execa } from "execa";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { runClaude } from "./claude.js";
import type { AIProvider } from "./ai-provider.js";
import {
  executableOnPath,
  findCodexExecutable,
  resolveExecutable,
} from "./executables.js";
import {
  recordTrajectoryMetadata,
  type TrajectoryMetadata,
} from "./trajectories.js";

export interface AgentRunOptions {
  provider: AIProvider;
  prompt: string;
  cwd: string;
  allowedTools?: string;
  mcpConfig?: string;
  saveTo: string;
  trajectoryMetadata?: Record<string, unknown>;
}

type ProviderInvocation = {
  command: string;
  args: string[];
  jsonLines?: boolean;
};

function getInvocation(opts: AgentRunOptions): ProviderInvocation {
  switch (opts.provider) {
    case "gemini":
      return {
        command: resolveExecutable("gemini", "WEBMCPIFY_GEMINI_BIN"),
        args: ["-p", opts.prompt, "--output-format", "json", "--yolo"],
      };
    case "codex":
      return {
        command: findCodexExecutable(),
        args: [
          "exec",
          "--json",
          "--cd",
          opts.cwd,
          "--dangerously-bypass-approvals-and-sandbox",
          opts.prompt,
        ],
        jsonLines: true,
      };
    case "antigravity": {
      const command =
        process.env.WEBMCPIFY_ANTIGRAVITY_BIN ??
        executableOnPath("agy") ??
        "agy";
      return {
        command,
        args: [
          "-p",
          opts.prompt,
          "--output-format",
          "json",
          "--dangerously-skip-permissions",
          "--print-timeout",
          process.env.WEBMCPIFY_ANTIGRAVITY_TIMEOUT ?? "15m",
        ],
      };
    }
    case "claude":
      throw new Error("Claude is handled by runClaude().");
  }
}

function parseOutput(stdout: string, jsonLines = false): unknown {
  if (!jsonLines) return JSON.parse(stdout);

  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

async function codexMcpArgs(mcpConfig?: string): Promise<string[]> {
  if (!mcpConfig || !existsSync(mcpConfig)) return [];

  let config: {
    mcpServers?: Record<
      string,
      { command?: string; args?: string[]; env?: Record<string, string> }
    >;
  };

  try {
    config = JSON.parse(await readFile(mcpConfig, "utf8")) as typeof config;
  } catch (error) {
    throw new Error(
      `Could not read MCP config at ${mcpConfig}: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }

  const args: string[] = [];
  for (const [name, server] of Object.entries(config.mcpServers ?? {})) {
    if (!server.command) continue;
    const key = `mcp_servers.${name}`;
    args.push("-c", `${key}.command=${JSON.stringify(server.command)}`);
    if (server.args) {
      args.push("-c", `${key}.args=${JSON.stringify(server.args)}`);
    }
    if (server.env) {
      args.push("-c", `${key}.env=${JSON.stringify(server.env)}`);
    }
  }
  return args;
}

async function prepareAntigravityMcpConfig(opts: AgentRunOptions): Promise<void> {
  if (!opts.mcpConfig || !existsSync(opts.mcpConfig)) return;

  const workspaceConfig = path.join(opts.cwd, ".agents", "mcp_config.json");
  await mkdir(path.dirname(workspaceConfig), { recursive: true });
  await writeFile(workspaceConfig, await readFile(opts.mcpConfig, "utf8"), "utf8");
}

function errorProperty(error: unknown, property: string): unknown {
  if (typeof error !== "object" || error === null) return undefined;
  return property in error ? error[property as keyof typeof error] : undefined;
}

function inferredRole(saveTo: string): string {
  return path.basename(saveTo).split("-")[0]?.replace(/\.json$/, "") || "agent";
}

function trajectoryMetadata(
  opts: AgentRunOptions,
  status: TrajectoryMetadata["status"],
  startedAt: string,
  startedMs: number,
  finishedAt: string
): TrajectoryMetadata {
  const extra = opts.trajectoryMetadata ?? {};
  return {
    ...extra,
    role:
      typeof extra.role === "string" ? extra.role : inferredRole(opts.saveTo),
    status,
    startedAt,
    finishedAt,
    durationMs: Date.now() - startedMs,
    provider: opts.provider,
    cwd: opts.cwd,
    prompt: opts.prompt,
    allowedTools: opts.allowedTools,
    mcpConfig: opts.mcpConfig,
  };
}

async function recordAgentMetadata(
  opts: AgentRunOptions,
  status: TrajectoryMetadata["status"],
  startedAt: string,
  startedMs: number,
  extra: Record<string, unknown> = {}
): Promise<void> {
  try {
    await recordTrajectoryMetadata(
      opts.saveTo,
      trajectoryMetadata(
        { ...opts, trajectoryMetadata: { ...opts.trajectoryMetadata, ...extra } },
        status,
        startedAt,
        startedMs,
        new Date().toISOString()
      )
    );
  } catch (metadataError) {
    console.error(
      `[trajectory] could not record metadata: ${
        metadataError instanceof Error ? metadataError.message : String(metadataError)
      }`
    );
  }
}

async function preserveFailedOutput(
  opts: AgentRunOptions,
  error: unknown
): Promise<void> {
  if (existsSync(opts.saveTo)) return;

  const stdout = errorProperty(error, "stdout");
  const output =
    typeof stdout === "string"
      ? stdout
      : JSON.stringify(
          {
            error: error instanceof Error ? error.message : String(error),
          },
          null,
          2
        ) + "\n";

  try {
    await mkdir(path.dirname(opts.saveTo), { recursive: true });
    await writeFile(opts.saveTo, output, "utf8");
  } catch (writeError) {
    console.error(
      `[trajectory] could not preserve failed output: ${
        writeError instanceof Error ? writeError.message : String(writeError)
      }`
    );
  }
}

export async function runAgent(opts: AgentRunOptions): Promise<unknown> {
  const startedMs = Date.now();
  const startedAt = new Date(startedMs).toISOString();

  try {
    if (opts.provider === "claude") {
      const result = await runClaude({
        prompt: opts.prompt,
        cwd: opts.cwd,
        allowedTools: opts.allowedTools,
        mcpConfig: opts.mcpConfig,
        saveTo: opts.saveTo,
      });
      await recordAgentMetadata(opts, "completed", startedAt, startedMs);
      return result;
    }

    if (opts.provider === "antigravity") {
      await prepareAntigravityMcpConfig(opts);
    }

    const invocation = getInvocation(opts);
    if (opts.provider === "codex") {
      const mcpArgs = await codexMcpArgs(opts.mcpConfig);
      invocation.args.splice(1, 0, ...mcpArgs);
    }
    let stdout: string;
    const subprocess = execa(invocation.command, invocation.args, {
      cwd: opts.cwd,
    });

    let pendingJsonLine = "";
    subprocess.stdout?.on("data", (chunk: Buffer | string) => {
      if (opts.provider !== "codex") return;

      pendingJsonLine += chunk.toString();
      const lines = pendingJsonLine.split(/\r?\n/);
      pendingJsonLine = lines.pop() ?? "";
      for (const line of lines) {
        try {
          const event = JSON.parse(line) as { type?: string };
          if (event.type) console.log(`[codex] ${event.type}`);
        } catch {
          // Keep the raw output for the trajectory; progress logging is best effort.
        }
      }
    });

    subprocess.stderr?.on("data", (chunk: Buffer | string) => {
      const message = chunk.toString().trim();
      if (message) console.error(`[${opts.provider}] ${message}`);
    });

    ({ stdout } = await subprocess);

    await mkdir(path.dirname(opts.saveTo), { recursive: true });
    await writeFile(opts.saveTo, stdout, "utf8");

    const result = parseOutput(stdout, invocation.jsonLines);
    await recordAgentMetadata(opts, "completed", startedAt, startedMs);
    return result;
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      const missingCliError = new Error(
        `Could not find the ${opts.provider} CLI. Install it or set WEBMCPIFY_${opts.provider.toUpperCase()}_BIN to its executable path.`
      );
      await preserveFailedOutput(opts, missingCliError);
      await recordAgentMetadata(opts, "failed", startedAt, startedMs, {
        error: missingCliError.message,
      });
      throw missingCliError;
    }

    await preserveFailedOutput(opts, error);
    await recordAgentMetadata(opts, "failed", startedAt, startedMs, {
      error: error instanceof Error ? error.message : String(error),
      stderr: errorProperty(error, "stderr"),
    });
    throw error;
  }
}
