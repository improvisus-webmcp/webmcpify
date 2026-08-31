import { existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

export function executableOnPath(name: string): string | undefined {
  const pathValue = process.env.PATH ?? "";
  for (const directory of pathValue.split(path.delimiter)) {
    if (!directory) continue;
    const candidate = path.join(directory, name);
    try {
      if (existsSync(candidate) && statSync(candidate).isFile()) {
        return candidate;
      }
    } catch {
      // Ignore inaccessible PATH entries and continue searching.
    }
  }
  return undefined;
}

export function resolveExecutable(name: string, envName: string): string {
  return process.env[envName] ?? executableOnPath(name) ?? name;
}

export function findCodexExecutable(): string {
  const configured = process.env.WEBMCPIFY_CODEX_BIN;
  if (configured) return configured;

  const pathExecutable = executableOnPath("codex");
  if (pathExecutable) return pathExecutable;

  // Codex may be installed inside the OpenAI VS Code extension without a
  // shell PATH entry. Support that installation on Linux and macOS.
  const extensionRoot = path.join(homedir(), ".vscode", "extensions");
  if (existsSync(extensionRoot)) {
    const platformDirectory =
      process.platform === "darwin"
        ? process.arch === "arm64"
          ? "darwin-arm64"
          : "darwin-x86_64"
        : "linux-x86_64";
    const extension = readdirSync(extensionRoot)
      .filter((name) => name.startsWith("openai.chatgpt-"))
      .sort()
      .reverse()
      .find((name) =>
        existsSync(
          path.join(extensionRoot, name, "bin", platformDirectory, "codex")
        )
      );

    if (extension) {
      return path.join(
        extensionRoot,
        extension,
        "bin",
        platformDirectory,
        "codex"
      );
    }
  }

  return "codex";
}
