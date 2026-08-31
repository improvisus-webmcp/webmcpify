import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { DiscoveryResult } from "./discovery.js";
import { createTrajectoryArtifact } from "./trajectories.js";

export interface ProposedTool {
  id: string;
  name: string;
  description: string;
  parameters: { type: "object"; properties: Record<string, unknown>; required?: string[]; additionalProperties?: boolean };
  implementation: { handler: string; action: string; state?: string };
  placement: { strategy: "declarative" | "imperative"; file: string; rationale: string };
  sourceFiles: string[];
}

export interface ProposedToolsDocument {
  version: 1;
  status: "valid";
  generatedAt: string;
  targetProject: string;
  discoveryPath: string;
  tools: ProposedTool[];
}

export function proposedToolsPath(sitePath: string): string {
  return path.join(sitePath, ".webmcpify", "proposed-tools.json");
}

function textFromOutput(raw: string): string {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === "string") return parsed;
    const values: string[] = [];
    const collect = (value: unknown, key?: string): void => {
      if (typeof value === "string") {
        if (!key || ["response", "result", "text", "output", "message", "content"].includes(key)) values.push(value);
      } else if (Array.isArray(value)) value.forEach((entry) => collect(entry));
      else if (typeof value === "object" && value !== null) Object.entries(value).forEach(([childKey, childValue]) => collect(childValue, childKey));
    };
    collect(parsed);
    if (values.length) return values.join("\n");
  } catch { /* plain provider output */ }
  return raw;
}

function jsonCandidates(text: string): string[] {
  const candidates: string[] = [];
  for (const match of text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)) if (match[1]) candidates.push(match[1].trim());
  candidates.push(text.trim());
  const objectStart = text.indexOf("{");
  const objectEnd = text.lastIndexOf("}");
  if (objectStart >= 0 && objectEnd > objectStart) candidates.push(text.slice(objectStart, objectEnd + 1));
  const arrayStart = text.indexOf("[");
  const arrayEnd = text.lastIndexOf("]");
  if (arrayStart >= 0 && arrayEnd > arrayStart) candidates.push(text.slice(arrayStart, arrayEnd + 1));
  return candidates;
}

function proposalValue(parsed: unknown): unknown {
  if (Array.isArray(parsed)) return { tools: parsed };
  if (typeof parsed !== "object" || parsed === null) return parsed;
  const record = parsed as Record<string, unknown>;
  if (Array.isArray(record.tools)) return { tools: record.tools };
  if (Array.isArray(record.proposedTools)) return { tools: record.proposedTools };
  return parsed;
}

function normalizeTool(value: unknown, index: number): ProposedTool {
  if (typeof value !== "object" || value === null) throw new Error(`Tool ${index + 1} must be an object.`);
  const candidate = value as Record<string, unknown>;
  const name = typeof candidate.name === "string" ? candidate.name.trim() : typeof candidate.id === "string" ? candidate.id.trim() : "";
  const id = typeof candidate.id === "string" ? candidate.id.trim() : name;
  const implementation = candidate.implementation as Record<string, unknown> | undefined;
  const placement = candidate.placement as Record<string, unknown> | undefined;
  const parameters = (candidate.parameters ?? candidate.schema) as Record<string, unknown> | undefined;
  if (!/^[a-z][a-z0-9_-]*$/i.test(name) || !/^[a-z][a-z0-9_-]*$/i.test(id)) throw new Error(`Tool ${index + 1} has an invalid id/name.`);
  if (typeof candidate.description !== "string" || !candidate.description.trim()) throw new Error(`Tool "${name}" needs a description.`);
  if (!parameters || parameters.type !== "object" || typeof parameters.properties !== "object" || parameters.properties === null || Array.isArray(parameters.properties)) throw new Error(`Tool "${name}" needs an object JSON-schema parameters definition.`);
  if (!implementation || typeof implementation.handler !== "string" || typeof implementation.action !== "string") throw new Error(`Tool "${name}" needs implementation.handler and implementation.action.`);
  if (!placement || (placement.strategy !== "declarative" && placement.strategy !== "imperative") || typeof placement.file !== "string" || typeof placement.rationale !== "string") throw new Error(`Tool "${name}" needs valid placement information.`);
  if (!Array.isArray(candidate.sourceFiles) || candidate.sourceFiles.length === 0 || candidate.sourceFiles.some((file) => typeof file !== "string" || !file.trim())) throw new Error(`Tool "${name}" needs sourceFiles.`);
  if (parameters.required !== undefined && (!Array.isArray(parameters.required) || parameters.required.some((field) => typeof field !== "string"))) throw new Error(`Tool "${name}" has an invalid required parameter list.`);
  return { id, name, description: candidate.description.trim(), parameters: parameters as ProposedTool["parameters"], implementation: { handler: implementation.handler, action: implementation.action, ...(typeof implementation.state === "string" ? { state: implementation.state } : {}) }, placement: { strategy: placement.strategy, file: placement.file, rationale: placement.rationale }, sourceFiles: [...new Set((candidate.sourceFiles as string[]).map((file) => file.trim()))] };
}

function relatedSignals(tool: ProposedTool, discovery: DiscoveryResult): string[] {
  const sourceFiles = new Set(discovery.sourceFiles ?? []);
  const signals = [...discovery.forms, ...discovery.buttons, ...discovery.actions, ...discovery.apis, ...discovery.authentication, ...discovery.state, ...discovery.existingWebMCP];
  return signals.filter((signal) => tool.sourceFiles.includes(signal.file) || tool.placement.file === signal.file || tool.implementation.handler.startsWith(signal.file)).map((signal) => signal.kind);
}

function validateSupport(tool: ProposedTool, discovery: DiscoveryResult): void {
  const knownFiles = new Set(discovery.sourceFiles ?? []);
  const knownSourceFiles = tool.sourceFiles.filter((file) => knownFiles.has(file));
  if (knownSourceFiles.length === 0) throw new Error(`Tool "${tool.name}" references no source file present in discovery.`);
  if (tool.placement.strategy === "declarative" && !knownFiles.has(tool.placement.file)) throw new Error(`Declarative tool "${tool.name}" must be placed in an existing discovered source file.`);
  if (!tool.sourceFiles.includes(tool.placement.file)) throw new Error(`Tool "${tool.name}" placement.file must be listed in sourceFiles.`);
  const kinds = new Set(relatedSignals(tool, discovery));
  if (kinds.size === 0) throw new Error(`Tool "${tool.name}" has no matching discovered UI action, API, state, auth, or WebMCP signal.`);
  const text = `${tool.name} ${tool.description} ${tool.implementation.action} ${tool.implementation.handler}`.toLowerCase();
  if (/(auth|login|logout|session|account|sign.?in|sign.?out)/.test(text) && discovery.authentication.length === 0) throw new Error(`Tool "${tool.name}" requires authentication capability not found in discovery.`);
  if (/(api|fetch|request|graphql|server|endpoint)/.test(text) && discovery.apis.length === 0) throw new Error(`Tool "${tool.name}" requires API capability not found in discovery.`);
  if (tool.placement.strategy === "declarative" && discovery.forms.length === 0) throw new Error(`Tool "${tool.name}" uses declarative placement but discovery found no forms.`);
}

export function validateProposedTools(value: unknown, discovery: DiscoveryResult): ProposedTool[] {
  const rawTools = Array.isArray(value) ? value : typeof value === "object" && value !== null ? (value as Record<string, unknown>).tools : undefined;
  if (!Array.isArray(rawTools) || rawTools.length === 0) throw new Error("The provider output must contain a non-empty tools array.");
  const tools = rawTools.map(normalizeTool);
  const names = new Set<string>();
  for (const tool of tools) {
    const normalizedName = tool.name.toLowerCase();
    if (names.has(normalizedName)) throw new Error(`Duplicate tool name: ${tool.name}`);
    names.add(normalizedName);
    validateSupport(tool, discovery);
  }
  return tools;
}

export function extractAndValidateProposedTools(raw: string, discovery: DiscoveryResult): ProposedTool[] {
  const text = textFromOutput(raw);
  const candidates = [raw, text, ...jsonCandidates(text)];
  for (const candidate of [...new Set(candidates)]) {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      return validateProposedTools(proposalValue(parsed), discovery);
    } catch (error) {
      if (error instanceof SyntaxError) continue;
      throw error;
    }
  }
  throw new Error("Provider output did not contain a valid structured tool proposal.");
}

export async function writeProposedTools(sitePath: string, tools: ProposedTool[], discoveryPath: string, generationTrajectory: string): Promise<string> {
  const output = proposedToolsPath(sitePath);
  const document: ProposedToolsDocument = { version: 1, status: "valid", generatedAt: new Date().toISOString(), targetProject: sitePath, discoveryPath, tools };
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(document, null, 2)}\n`, "utf8");
  await createTrajectoryArtifact("proposed-tools", document, { sitePath, proposedToolsPath: output, discoveryPath, sourceTrajectory: generationTrajectory, toolCount: tools.length });
  return output;
}

export async function loadDiscovery(sitePath: string): Promise<DiscoveryResult> {
  return JSON.parse(await readFile(path.join(sitePath, ".webmcpify", "discovery.json"), "utf8")) as DiscoveryResult;
}
