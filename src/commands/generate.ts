import path from "node:path";
import { existsSync } from "node:fs";
import { runAgent } from "../lib/agent.js";
import { resolveProvider } from "../lib/ai-provider.js";
import { trajectoryPath } from "../lib/paths.js";

export const GENERATE_ONLY_PROMPT = `
Explore this website's codebase and identify its core user-facing actions.
Draft WebMCP tool registrations for each one — declarative (HTML form
attributes) for simple single-input actions, imperative
(navigator.modelContext) for actions needing custom logic or state.
Output as a diff only. Do not deploy, do not verify — that happens
in a separate step.
`.trim();

export const GENERATION_METHODS = [
  "declarative",
  "imperative",
  "auto",
] as const;

export type GenerationMethod = (typeof GENERATION_METHODS)[number];

function resolveMethod(method?: string): GenerationMethod {
  const selected = method ?? "auto";
  if ((GENERATION_METHODS as readonly string[]).includes(selected)) {
    return selected as GenerationMethod;
  }

  throw new Error(
    `Unknown generation method "${selected}". Choose one of: ${GENERATION_METHODS.join(
      ", "
    )}.`
  );
}

function methodInstruction(method: GenerationMethod): string {
  switch (method) {
    case "declarative":
      return `For this run, use the declarative approach for every drafted
tool: prefer HTML form attributes and existing form submit behavior.`;
    case "imperative":
      return `For this run, use the imperative approach for every drafted
tool: register through navigator.modelContext with explicit schemas and
handlers.`;
    case "auto":
      return "";
  }
}

export interface GenerateOptions {
  path: string;
  provider?: string;
  method?: string;
  context?: string;
}

export async function runGenerate(opts: GenerateOptions) {
  const provider = resolveProvider(opts.provider);
  const method = resolveMethod(opts.method);
  const sitePath = path.resolve(opts.path);

  if (!existsSync(sitePath)) {
    throw new Error(`Site path does not exist: ${sitePath}`);
  }

  const saveTo = trajectoryPath("generate.json");
  const strategy = methodInstruction(method);
  const failureContext = opts.context
    ? `A previous independent test reported this failure. Use it to focus the
drafted repair, but still inspect the code rather than assuming the diagnosis:
${opts.context}`
    : "";
  const prompt = [GENERATE_ONLY_PROMPT, strategy, failureContext]
    .filter(Boolean)
    .join("\n\n");

  console.log(
    `[generate] drafting WebMCP tools for ${sitePath} via ${provider} (${method})...`
  );

  await runAgent({
    provider,
    prompt,
    cwd: sitePath,
    // Generation is a draft stage. The prompt and this provider-specific
    // permission hint both keep the site untouched until review/approval.
    allowedTools: "Read",
    saveTo,
  });

  console.log(`[generate] draft saved to ${saveTo}`);
}
