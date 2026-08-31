import path from "node:path";
import { existsSync } from "node:fs";
import { runAgent } from "../lib/agent.js";
import { resolveProvider } from "../lib/ai-provider.js";
import {
  DISCOVERY_GUIDANCE,
  TASK_AUTHORING_PROMPT,
  TOOL_PLACEMENT_GUIDANCE,
  TOOL_PROPOSAL_PROMPT,
} from "../lib/prompts.js";
import { createTrajectoryPath } from "../lib/trajectories.js";
import { createPendingPatch } from "../lib/patches.js";
import { readFile } from "node:fs/promises";
import { discoveryPath, runDiscovery } from "../lib/discovery.js";
import { extractAndValidateProposedTools, writeProposedTools } from "../lib/tool-proposals.js";

export const GENERATE_ONLY_PROMPT = `
${DISCOVERY_GUIDANCE}

After discovery, draft WebMCP tool registrations for the proposed actions —
declarative (HTML form attributes) for simple single-input actions, imperative
(navigator.modelContext) for actions needing custom logic or state. Report the
discovery findings first, then output the proposed diff and a concise
placement/wiring summary for each tool. Use explicit file paths in the diff.
Do not deploy or verify — that happens in a separate step.

${TOOL_PLACEMENT_GUIDANCE}

${TOOL_PROPOSAL_PROMPT}

${TASK_AUTHORING_PROMPT}
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
  trajectoryMetadata?: Record<string, unknown>;
}

export async function runGenerate(opts: GenerateOptions) {
  const provider = resolveProvider(opts.provider);
  const method = resolveMethod(opts.method);
  const sitePath = path.resolve(opts.path);

  if (!existsSync(sitePath)) {
    throw new Error(`Site path does not exist: ${sitePath}`);
  }

  const discovery = await runDiscovery(sitePath);

  const saveTo = createTrajectoryPath("generate");
  const strategy = methodInstruction(method);
  const failureContext = opts.context
    ? `A previous independent test reported this failure. Use it to focus the
drafted repair, but still inspect the code rather than assuming the diagnosis:
${opts.context}`
    : "";
  const prompt = [GENERATE_ONLY_PROMPT, `The structured discovery has been completed and saved at ${discoveryPath(sitePath)}. Use this data as the source of truth and do not invent actions:\n${JSON.stringify(discovery, null, 2)}`, strategy, failureContext]
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
    trajectoryMetadata: {
      role: "generate",
      sitePath,
      method,
      context: opts.context,
      discoveryPath: discoveryPath(sitePath),
      ...opts.trajectoryMetadata,
    },
  });

  try {
    const tools = extractAndValidateProposedTools(await readFile(saveTo, "utf8"), discovery);
    const proposalFile = await writeProposedTools(sitePath, tools, discoveryPath(sitePath), saveTo);
    const patch = await createPendingPatch(
      sitePath,
      await readFile(saveTo, "utf8"),
      saveTo,
    );
    console.log(`[generate] draft saved to ${saveTo}`);
    console.log(`[generate] proposed tools: ${proposalFile}`);
    console.log(`[generate] validated ${tools.length} tool proposal(s)`);
    console.log(`[generate] generated source changes: ${patch.changedFiles.join(", ")}`);
    console.log(`[generate] patch: ${patch.patchPath}`);
    console.log("[generate] status: awaiting review");
  } catch (error) {
    console.error(`[generate] ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}
