import { execa } from "execa";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { resolveExecutable } from "./executables.js";

export interface ClaudeRunOptions {
  prompt: string;
  cwd: string;
  allowedTools?: string;
  mcpConfig?: string;
  saveTo: string;
}

export async function runClaude(opts: ClaudeRunOptions): Promise<unknown> {
  const args = ["-p", opts.prompt, "--output-format", "json"];
  if (opts.allowedTools) args.push("--allowedTools", opts.allowedTools);
  if (opts.mcpConfig) args.push("--mcp-config", opts.mcpConfig);

  const command = resolveExecutable("claude", "WEBMCPIFY_CLAUDE_BIN");
  let stdout: string;
  try {
    ({ stdout } = await execa(command, args, { cwd: opts.cwd }));
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      throw new Error(
        "Could not find the Claude CLI. Install it, add it to PATH, or set WEBMCPIFY_CLAUDE_BIN in .env."
      );
    }
    throw error;
  }

  await mkdir(path.dirname(opts.saveTo), { recursive: true });
  await writeFile(opts.saveTo, stdout, "utf8");

  return JSON.parse(stdout);
}
