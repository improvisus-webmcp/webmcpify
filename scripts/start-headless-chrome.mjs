#!/usr/bin/env node
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const suppliedUrl = process.env.WEBMCPIFY_URL ?? process.argv[2] ?? "http://localhost:3000";
const markdownLink = suppliedUrl.trim().match(/^\[([^\]]+)\]\((https?:\/\/[^)]+)\)$/);
const url = markdownLink?.[2] ?? suppliedUrl.trim();
const port = process.env.WEBMCPIFY_CDP_PORT ?? "9222";
const chrome = process.env.WEBMCPIFY_CHROME_BIN ?? "google-chrome";
const profile = await mkdtemp(path.join(os.tmpdir(), "webmcpify-headless-chrome-"));

const child = spawn(chrome, [
  "--headless=new",
  "--remote-debugging-address=127.0.0.1",
  `--remote-debugging-port=${port}`,
  "--enable-features=DevToolsWebMCPSupport,WebMCP",
  `--user-data-dir=${profile}`,
  "--no-first-run",
  "--no-default-browser-check",
  url,
], { stdio: "inherit" });

console.log(`[chrome] headless Google Chrome listening at http://127.0.0.1:${port}`);
console.log(`[chrome] target: ${url}`);
console.log(`[chrome] profile: ${profile}`);

const stop = () => {
  if (!child.killed) child.kill("SIGTERM");
};
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
child.once("exit", (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0);
});
