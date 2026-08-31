import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export interface WebmcpifyConfig {
  durable: boolean;
  provider: string;
}

const DEFAULT_CONFIG: WebmcpifyConfig = {
  durable: false,
  provider: "gemini",
};

function configPath(basePath = process.cwd()): string {
  return path.join(basePath, ".webmcpify", "config.json");
}

export async function readConfig(
  basePath = process.cwd()
): Promise<WebmcpifyConfig> {
  try {
    const parsed = JSON.parse(
      await readFile(configPath(basePath), "utf8")
    ) as Partial<WebmcpifyConfig>;

    return {
      durable:
        typeof parsed.durable === "boolean"
          ? parsed.durable
          : DEFAULT_CONFIG.durable,
      provider:
        typeof parsed.provider === "string" && parsed.provider.length > 0
          ? parsed.provider
          : DEFAULT_CONFIG.provider,
    };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export async function writeConfig(
  config: Partial<WebmcpifyConfig>,
  basePath = process.cwd()
): Promise<WebmcpifyConfig> {
  const existing = await readConfig(basePath);
  const next = {
    ...existing,
    ...config,
  };
  const destination = configPath(basePath);

  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, JSON.stringify(next, null, 2) + "\n", "utf8");
  return next;
}

export async function resolveDurable(
  flag: boolean | undefined,
  basePath = process.cwd()
): Promise<boolean> {
  if (flag !== undefined) return flag;

  const environmentValue = process.env.WEBMCPIFY_DURABLE;
  if (environmentValue !== undefined) {
    const normalized = environmentValue.trim().toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false") return false;
    throw new Error(
      `Invalid WEBMCPIFY_DURABLE value "${environmentValue}". Use true or false.`
    );
  }

  const config = await readConfig(basePath);
  return config.durable;
}
