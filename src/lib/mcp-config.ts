import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const CHROME_DEVTOOLS_CONFIG = {
  mcpServers: {
    "chrome-devtools": {
      command: "npx",
      args: [
        "-y",
        "chrome-devtools-mcp@1.7.0",
        "--category-experimental-webmcp",
        "--autoConnect",
        "--no-usage-statistics",
      ],
      directTools: [
        "navigate_page",
        "list_webmcp_tools",
        "execute_webmcp_tool",
      ],
      approveTools: ["execute_webmcp_tool"],
    },
  },
};

/**
 * Return an existing site MCP config, or create a project-local fallback for
 * the isolated test command. Existing user configuration is never replaced.
 */
export async function writeChromeDevtoolsMcpConfig(
  sitePath: string
): Promise<string> {
  const existingConfig = path.join(sitePath, ".mcp.json");
  if (existsSync(existingConfig)) return existingConfig;

  const configDirectory = path.join(sitePath, ".webmcpify");
  const generatedConfig = path.join(
    configDirectory,
    "chrome-devtools-mcp.json"
  );
  await mkdir(configDirectory, { recursive: true });
  await writeFile(
    generatedConfig,
    JSON.stringify(CHROME_DEVTOOLS_CONFIG, null, 2) + "\n",
    "utf8"
  );
  return generatedConfig;
}
