import path from "node:path";
import { existsSync } from "node:fs";
import { runAgent } from "../lib/agent.js";
import { resolveProvider } from "../lib/ai-provider.js";
import { trajectoryPath } from "../lib/paths.js";

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
      return `Use WebMCP's declarative approach. Derive tools from existing HTML
<form> elements wherever possible, using the WebMCP declarative attributes and
the form's submit behavior.`;
    case "imperative":
      return `Use WebMCP's imperative approach. Register tools through
navigator.modelContext with explicit input schemas and handler functions that
call the site's existing application state and UI APIs.`;
    case "auto":
      return `Choose the approach per action: use declarative registration for
simple forms and imperative registration for actions requiring custom logic or
application state, such as cart mutations and checkout.`;
  }
}

export interface GenerateOptions {
  path: string;
  provider?: string;
  method?: string;
}

export async function runGenerate(opts: GenerateOptions) {
  const provider = resolveProvider(opts.provider);
  const method = resolveMethod(opts.method);
  const sitePath = path.resolve(opts.path);

  if (!existsSync(sitePath)) {
    throw new Error(`Site path does not exist: ${sitePath}`);
  }

  const saveTo = trajectoryPath("generate.json");
  const prompt = `Read this site's codebase and draft WebMCP tool registrations for
its cart, roast filter, and checkout actions.

${methodInstruction(method)}

Return a unified diff containing the proposed source changes and a short
explanation of each tool. Do not edit, deploy, or otherwise change any files;
this is a draft for human review. If the site already has WebMCP registrations,
preserve them and propose only the missing or incorrect pieces.`;

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
