#!/usr/bin/env node
import "./lib/load-env.js";
import { Command } from "commander";
import { runGenerate } from "./commands/generate.js";
import { runReview } from "./commands/review.js";
import { runTest } from "./commands/test.js";
import { runRepair } from "./commands/repair.js";
import { runEval } from "./commands/eval.js";
import { runBaseline } from "./commands/baseline.js";

const providerHelp =
  "AI provider to use: gemini, antigravity, claude, or codex";

const program = new Command();

program
  .name("webmcpify")
  .description(
    "Audit or generate WebMCP tool registrations for a site, verified by an isolated agent driving a real browser."
  )
  .version("0.1.0");

program
  .command("generate")
  .description("Draft WebMCP tool registrations for a site (no changes applied yet)")
  .requiredOption("-p, --path <dir>", "path to the site's codebase")
  .option("--provider <name>", providerHelp, "gemini")
  .option(
    "--method <type>",
    "generation strategy: declarative, imperative, or auto",
    "auto"
  )
  .action(runGenerate);

program
  .command("review")
  .description("Start the local approval UI for drafted tools")
  .option(
    "-p, --path <dir>",
    "path to the site's codebase (defaults to the current directory)"
  )
  .option("--port <number>", "port for the review server", "4173")
  .action(runReview);

program
  .command("test")
  .description("Run an isolated agent against approved tools via chrome-devtools-mcp")
  .requiredOption("-u, --url <url>", "URL of the running site")
  .option(
    "-p, --path <dir>",
    "path to the site's codebase (defaults to the current directory)"
  )
  .option("--provider <name>", providerHelp, "gemini")
  .action(async (opts) => {
    await runTest(opts);
  });

program
  .command("repair")
  .description("Patch a failed tool based on the last test run's failure")
  .option(
    "-p, --path <dir>",
    "path to the site's codebase (defaults to the current directory)"
  )
  .option("--provider <name>", providerHelp, "gemini")
  .action(runRepair);

program
  .command("eval")
  .description("Print the pass/fail report for the last test run")
  .action(async () => {
    await runEval();
  });

program
  .command("baseline")
  .description("Run the one-shot, self-verifying baseline for comparison")
  .requiredOption("-p, --path <dir>", "path to the site's codebase")
  .requiredOption("-u, --url <url>", "URL of the running site")
  .option("--provider <name>", providerHelp, "gemini")
  .action(runBaseline);

program.parseAsync().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[webmcpify] ${message}`);
  process.exitCode = 1;
});
