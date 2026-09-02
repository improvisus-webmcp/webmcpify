import path from "node:path";
import { existsSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
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
import {
  createAgentWorkspace,
  initializeAgentWorkspace,
  readAgentWorkspaceDiff,
  removeAgentWorkspace,
} from "../lib/agent-workspace.js";

export const GENERATE_ONLY_PROMPT = `
${DISCOVERY_GUIDANCE}

After discovery, draft WebMCP tool registrations for the proposed actions —
declarative (HTML form attributes) for simple single-input actions, imperative
(navigator.modelContext) for actions needing custom logic or state. Report the
discovery findings first, then output the proposed diff and a concise
placement/wiring summary for each tool. Use explicit file paths in the diff.
Do not deploy or verify — that happens in a separate step.

You are working in a disposable workspace, not the target checkout. Make the
proposed source edits in this workspace so WebMCPify can capture the exact
working-tree diff. Never edit .webmcpify artifacts and never claim a diff for
files you did not actually inspect.

The current working directory is the only project you may access. Do not use
absolute paths, inspect parent directories, or access any checkout outside it.

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
  preserveApprovalState?: boolean;
}

async function invalidateApprovalState(sitePath: string): Promise<void> {
  const stateDirectory = path.join(sitePath, ".webmcpify");
  const staleDirectory = path.join(stateDirectory, "stale");
  await mkdir(staleDirectory, { recursive: true });
  // tasks.json belongs to the target project's approved evaluation state. Do
  // not move or rewrite it during generation; a new task set replaces it only
  // when the human approval transaction completes.
  for (const file of [path.join(stateDirectory, "approved-tools.json")]) {
    if (!existsSync(file)) continue;
    await rename(file, path.join(staleDirectory, `${Date.now()}-${path.basename(file)}`));
  }
}

export async function runGenerate(opts: GenerateOptions) {
  const provider = resolveProvider(opts.provider);
  const method = resolveMethod(opts.method);
  const sitePath = path.resolve(opts.path);

  if (!existsSync(sitePath)) {
    throw new Error(`Site path does not exist: ${sitePath}`);
  }

  if (!opts.preserveApprovalState) await invalidateApprovalState(sitePath);

  const discovery = await runDiscovery(sitePath);

  const saveTo = createTrajectoryPath("generate", undefined, sitePath);
  const strategy = methodInstruction(method);
  const failureContext = opts.context
    ? `A previous independent test reported this failure. Use it to focus the
drafted repair, but still inspect the code rather than assuming the diagnosis:
${opts.context}`
    : "";
  // Do not expose the real checkout path to an unrestricted provider process.
  // The provider receives a local copy in its disposable workspace below.
  const agentDiscovery = { ...discovery, targetProject: "." };
  const prompt = [GENERATE_ONLY_PROMPT, `The structured discovery has been completed and is available at ./.webmcpify/discovery.json in the current workspace. Use this data as the source of truth and do not invent actions:\n${JSON.stringify(agentDiscovery, null, 2)}`, strategy, failureContext]
    .filter(Boolean)
    .join("\n\n");

  console.log(
    `[generate] drafting WebMCP tools for ${sitePath} via ${provider} (${method})...`
  );

  const agentWorkspace = await createAgentWorkspace(sitePath);
  await initializeAgentWorkspace(agentWorkspace);
  await mkdir(path.join(agentWorkspace, ".webmcpify"), { recursive: true });
  await writeFile(
    path.join(agentWorkspace, ".webmcpify", "discovery.json"),
    `${JSON.stringify({ ...discovery, targetProject: "." }, null, 2)}\n`,
    "utf8",
  );
  let workspaceDiff = "";
  try {
    await runAgent({
      provider,
      prompt,
      cwd: agentWorkspace,
      // Providers may ignore permission hints. The disposable workspace is
      // the actual safety boundary keeping the target checkout untouched.
      allowedTools: "Read,Edit",
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
    workspaceDiff = await readAgentWorkspaceDiff(agentWorkspace);
  } finally {
    await removeAgentWorkspace(agentWorkspace);
  }

  try {
    const tools = extractAndValidateProposedTools(await readFile(saveTo, "utf8"), discovery);
    const proposalFile = await writeProposedTools(sitePath, tools, discoveryPath(sitePath), saveTo);
    const patch = await createPendingPatch(
      sitePath,
      workspaceDiff || await readFile(saveTo, "utf8"),
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
