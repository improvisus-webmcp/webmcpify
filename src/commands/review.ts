import express from "express";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  createTrajectoryArtifact,
  latestTrajectoryPath,
} from "../lib/trajectories.js";
import {
  extractTasksFromText,
  parseTasksJson,
  tasksPath,
  approvedManifestPath,
  loadApprovedTasks,
  taskFingerprint,
  writeApprovedTasksAtomically,
  type ApprovedTaskManifest,
  type Task,
} from "../lib/tasks.js";
import { patchExists, patchMetadataPath, readPatchMetadata, writePatchMetadata } from "../lib/patches.js";
import { proposedToolsPath, validateProposedTools, loadDiscovery, type ProposedTool } from "../lib/tool-proposals.js";
import { taskVerificationIssues } from "../lib/tasks.js";

export interface ReviewOptions {
  port?: string;
  path?: string;
}

export interface ReviewResult {
  approved: boolean;
  tools: string[];
  tasks: Task[];
  approvalPath: string;
  decisionPath?: string;
  sourceDiff: { status: "approved" | "rejected"; runId?: string; timestamp: string };
  approvedTools: ProposedTool[];
}

function htmlEscape(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function draftText(raw: string): string {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === "string") return parsed;
    if (typeof parsed === "object" && parsed !== null) {
      const record = parsed as Record<string, unknown>;
      for (const key of ["response", "result", "text"]) {
        if (typeof record[key] === "string") return record[key];
      }
    }
    return JSON.stringify(parsed, null, 2);
  } catch {
    return raw;
  }
}

function parsePort(value: string | undefined): number {
  const port = Number(value ?? "4173");
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`Invalid review port "${value}". Use a number from 1 to 65535.`);
  }
  return port;
}

function selectedIds(requestBody: { ids?: unknown }): string[] {
  const selected = Array.isArray(requestBody.ids)
    ? requestBody.ids
    : typeof requestBody.ids === "string"
      ? [requestBody.ids]
      : [];
  return [
    ...new Set(selected.map((value) => String(value).trim()).filter(Boolean)),
  ];
}

/** Start the approval UI and resolve only after the owner approves or rejects. */
export async function runReviewPrompt(
  sitePath: string,
  requestedPort?: string,
  trajectoryMetadata: Record<string, unknown> = {}
): Promise<ReviewResult> {
  const discovery = await loadDiscovery(sitePath);
  const proposalFile = proposedToolsPath(sitePath);
  if (!existsSync(proposalFile)) throw new Error(`No structured tool proposal found at ${proposalFile}. Run "webmcpify generate" first.`);
  const hasPatch = patchExists(sitePath);
  const patchMetadata = hasPatch ? await readPatchMetadata(sitePath) : undefined;
  if (!patchMetadata) throw new Error(`No valid pending source patch found at ${patchMetadataPath(sitePath)}. Run "webmcpify generate" first.`);
  const draftPath = patchMetadata.generationTrajectory;
  if (!existsSync(draftPath)) throw new Error(`The pending patch references missing generation trajectory ${draftPath}.`);
  const draft = draftText(await readFile(draftPath, "utf8"));
  let proposedTools: ProposedTool[];
  try { proposedTools = validateProposedTools(JSON.parse(await readFile(proposalFile, "utf8")), discovery); }
  catch (error) { throw new Error(`Could not load structured tool proposals: ${error instanceof Error ? error.message : String(error)}`); }
  const proposedTasks = extractTasksFromText(draft) ?? [];
  if (proposedTasks.length < 5 || proposedTasks.length > 6) throw new Error(`Generated draft must contain 5-6 valid tasks; received ${proposedTasks.length}. Fix the generation output before review.`);
  const projectTasksPath = tasksPath(sitePath);
  const approvalPath = path.join(
    sitePath,
    ".webmcpify",
    "approved-tools.json"
  );
  const patch = await readFile(patchMetadata.patchPath, "utf8");
  const approvalId = patchMetadata.runId;
  if (existsSync(approvalPath)) {
    try {
      const existing = JSON.parse(await readFile(approvalPath, "utf8")) as Partial<ApprovedTaskManifest> & { approvedAt?: string; sourceDiff?: { runId?: string } };
      if (existing.approved === true && existing.approvalId === approvalId && existing.taskSetId && existing.tasks) {
        const tasks = await loadApprovedTasks(sitePath);
        const tools = validateProposedTools(existing.tools, discovery);
        const sourceDiff = { status: "approved" as const, runId: approvalId, timestamp: String(existing.approvedAt ?? new Date().toISOString()) };
        return { approved: true, tools: tools.map((tool) => tool.name), approvedTools: tools, tasks, approvalPath, sourceDiff };
      }
    } catch { /* stale or incomplete approval is never reused */ }
  }
  const port = parsePort(requestedPort);
  const app = express();
  app.use(express.urlencoded({ extended: false, limit: "64kb" }));

  const renderLocked = (response: express.Response, message = "Approved ✓") => {
    response.type("html").send(`<!doctype html><html lang="en"><body><h1>${message}</h1><p>The approval for this draft is persisted and locked. You can close this window.</p><button disabled>Approved — locked</button></body></html>`);
  };

  const approvalIsPersisted = async (): Promise<boolean> => {
    if (!existsSync(approvalPath)) return false;
    try {
      const existing = JSON.parse(await readFile(approvalPath, "utf8")) as Partial<ApprovedTaskManifest> & { tools?: unknown[] };
      if (existing.approved !== true || existing.approvalId !== approvalId || !existing.tasks || !existing.tools) return false;
      await loadApprovedTasks(sitePath);
      validateProposedTools(existing.tools, discovery);
      return true;
    } catch {
      return false;
    }
  };

  app.get(["/", "/approve"], async (_request, response) => {
    if (await approvalIsPersisted()) {
      renderLocked(response);
      return;
    }
    const checkboxes = proposedTools.length
      ? proposedTools
          .map(
            (tool) =>
              `<label><input type="checkbox" name="toolIds" value="${htmlEscape(
                tool.id
              )}" checked> <strong>${htmlEscape(tool.name)}</strong> — ${htmlEscape(tool.description)}</label>`
          )
          .join("\n")
      : `<p>No structured tool proposals were found.</p>`;
    const toolJson = htmlEscape(JSON.stringify(proposedTools, null, 2));
    const toolDetails = proposedTools.map((tool) => `<details><summary>${htmlEscape(tool.name)}</summary><pre>${htmlEscape(JSON.stringify(tool, null, 2))}</pre></details>`).join("\n");

    const taskRows = proposedTasks.length
      ? proposedTasks
          .map(
            (task) =>
              `<label><input type="checkbox" name="taskIds" value="${htmlEscape(
                task.id
              )}" checked> <strong>${htmlEscape(task.id)}</strong>: ${htmlEscape(
                task.description
              )}<br><code>${htmlEscape(task.verify)}</code>${taskVerificationIssues(task, { discovery, toolNames: proposedTools.map((tool) => tool.name) }).map((issue) => `<br><em>${htmlEscape(issue.severity.toUpperCase())}: ${htmlEscape(issue.message)}</em>`).join("")}</label>`
          )
          .join("\n")
      : `<p>No valid 5-6 task proposal was found. Edit the JSON below before approving.</p>`;
    const taskJson = htmlEscape(JSON.stringify(proposedTasks, null, 2));

    const sourceSection = hasPatch
      ? `<div class="section"><h2>Source changes</h2><p><strong>${htmlEscape(
          patchMetadata.patchStatus
        )}</strong> — ${htmlEscape(patchMetadata.changedFiles.join(", "))}</p><pre>${htmlEscape(
          patch
        )}</pre><label><input type="checkbox" name="approveSourceDiff" value="yes"> I approve this exact source patch</label></div>`
      : `<div class="section"><h2>Source changes</h2><p>No valid pending source patch exists. Generation must produce one before approval.</p></div>`;

    response.type("html").send(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>WebMCPify review</title>
<style>body{font:16px system-ui,sans-serif;max-width:1100px;margin:2rem auto;padding:0 1rem;color:#202124}pre{white-space:pre-wrap;background:#f5f5f5;padding:1rem;border-radius:8px;max-height:45vh;overflow:auto}label{display:block;margin:.5rem 0}textarea{width:100%;min-height:8rem;font:13px ui-monospace,monospace}code{display:inline-block;margin:.25rem 0;background:#f5f5f5;padding:.2rem}.section{border-top:1px solid #ddd;margin-top:1.5rem;padding-top:1rem}button{margin-top:1rem;padding:.6rem 1rem}.reject{margin-left:.5rem}.summary{background:#fff8d8;padding:1rem;border:1px solid #e7cf62}</style>
</head><body><h1>Review WebMCP draft</h1>
<p>Approve only tools and verification tasks you have inspected. Approval writes a local manifest and <code>tasks.json</code>; it does not deploy source changes.</p>
<h2>Draft</h2><pre>${htmlEscape(draft)}</pre>
<form method="post" action="/approve"><h2>Approved tools</h2>${checkboxes}
<details><summary>Inspect structured tool definitions</summary>${toolDetails}<p>Edit the definitions below where needed. Keep each approved tool's <code>id</code> to match its checkbox.</p><textarea name="toolsJson" aria-label="Tools JSON">${toolJson}</textarea></details>
<div class="section"><h2>Approved verification tasks</h2>${taskRows}
<p>Edit the task definitions below if needed. Every task must have an observable verify expression.</p>
<textarea name="tasksJson" aria-label="Tasks JSON">${taskJson}</textarea></div>${sourceSection}
<br><button type="submit" name="stage" value="prepare">Approve Draft</button><button class="reject" type="submit" formaction="/reject">Reject draft</button></form></body></html>`);
  });

  let server: ReturnType<typeof app.listen> | undefined;
  const decision = new Promise<ReviewResult>((resolve, reject) => {
    const finish = (result: ReviewResult) => {
      if (server) {
        server.close(() => resolve(result));
      } else {
        resolve(result);
      }
    };

    const approvalInput = (request: express.Request) => {
      const selectedToolIds = selectedIds({ ids: request.body.toolIds });
      const editedTools = validateProposedTools(JSON.parse(typeof request.body.toolsJson === "string" ? request.body.toolsJson : "{}"), discovery);
      if (editedTools.length === 0 || selectedToolIds.length !== editedTools.length || editedTools.some((tool) => !selectedToolIds.includes(tool.id))) throw new Error("Every approved tool must have a matching selected checkbox; approve at least one tool.");
      const editedTasks = parseTasksJson(typeof request.body.tasksJson === "string" ? request.body.tasksJson : "[]");
      const selectedTaskIds = selectedIds({ ids: request.body.taskIds });
      const proposedTaskIds = new Set(proposedTasks.map((task) => task.id));
      if (editedTasks.length < 5 || editedTasks.length > 6 || selectedTaskIds.length !== editedTasks.length || editedTasks.some((task) => !selectedTaskIds.includes(task.id) || !proposedTaskIds.has(task.id))) throw new Error("Approved tasks must be 5-6 valid tasks selected from this generated draft; keep task IDs unchanged.");
      if (!hasPatch || request.body.approveSourceDiff !== "yes") throw new Error("Explicit approval of the pending source diff is required.");
      return { tools: editedTools, tasks: editedTasks };
    };

    const confirmationPage = (response: express.Response, input: { tools: ProposedTool[]; tasks: Task[] }) => {
      const hidden = (name: string, value: string) => `<input type="hidden" name="${name}" value="${htmlEscape(value)}">`;
      response.type("html").send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Confirm WebMCP approval</title><style>body{font:16px system-ui,sans-serif;max-width:800px;margin:3rem auto;padding:0 1rem}.summary{background:#fff8d8;border:1px solid #e7cf62;padding:1rem}button{padding:.7rem 1rem;margin-right:.5rem}</style></head><body><h1>Review approval</h1><div class="summary"><p>You are about to approve:</p><ul><li>${input.tools.length} tools</li><li>${input.tasks.length} verification tasks</li><li>${patchMetadata.changedFiles.length} source files: ${htmlEscape(patchMetadata.changedFiles.join(", "))}</li><li>Source changes: awaiting application after approval</li></ul></div><form method="post" action="/approve">${hidden("stage", "confirm")}${hidden("toolsJson", JSON.stringify({ tools: input.tools }))}${hidden("tasksJson", JSON.stringify(input.tasks))}${input.tools.map((tool) => hidden("toolIds", tool.id)).join("")}${input.tasks.map((task) => hidden("taskIds", task.id)).join("")}${hidden("approveSourceDiff", "yes")}<button type="submit">Confirm Approval</button><a href="/approve"><button type="button">Cancel</button></a></form></body></html>`);
    };

    app.post("/approve", async (request, response) => {
      try {
        const existing = existsSync(approvalPath) ? JSON.parse(await readFile(approvalPath, "utf8")) as Partial<ApprovedTaskManifest> & { sourceDiff?: { runId?: string } } : undefined;
        if (existing?.approved === true && existing.approvalId === approvalId) { renderLocked(response); return; }
        const input = approvalInput(request);
        if (request.body.stage !== "confirm") { confirmationPage(response, input); return; }
        const approvalManifest = { version: 1 as const, approved: true as const, approvalId, draftPath, taskSetId: taskFingerprint(input.tasks), tasks: input.tasks, tools: input.tools, toolNames: input.tools.map((tool) => tool.name), tasksPath: projectTasksPath, proposedToolsPath: proposalFile, sourceDiff: { status: "approved" as const, runId: approvalId, timestamp: new Date().toISOString() } };
        await writeApprovedTasksAtomically(sitePath, approvalManifest);
        const sourceDiff = {
          status: "approved" as const,
          runId: patchMetadata.runId,
          timestamp: new Date().toISOString(),
        };
        await writePatchMetadata(sitePath, {
          ...patchMetadata,
          patchStatus: "approved",
        });
        const decisionPath = await createTrajectoryArtifact(
          "review-decision",
          {
            version: 1,
            approved: true,
            tools: input.tools,
            toolNames: input.tools.map((tool) => tool.name),
            tasks: input.tasks,
            approvalPath,
            tasksPath: projectTasksPath,
            proposedToolsPath: proposalFile,
            sourceDiff,
            draftPath,
            reviewedAt: new Date().toISOString(),
          },
          {
            sitePath,
            draftPath,
            approvalPath,
            port,
            ...trajectoryMetadata,
          }
        );

        response.type("html").send(`<!doctype html><html lang="en"><body>
<h1>Approved ✓</h1><p>${input.tools.length} tool(s) and ${input.tasks.length} verification task(s) have been persisted for <code>${htmlEscape(
          sitePath
        )}</code>.</p><p>You can close this window.</p></body></html>`);
        finish({ approved: true, tools: input.tools.map((tool) => tool.name), approvedTools: input.tools, tasks: input.tasks, approvalPath, decisionPath, sourceDiff });
      } catch (error) {
        response
          .status(500)
          .type("text")
          .send(error instanceof Error ? error.message : String(error));
      }
    });

    app.post("/reject", async (_request, response) => {
      try {
        if (patchMetadata) {
          await writePatchMetadata(sitePath, {
            ...patchMetadata,
            patchStatus: "rejected",
            error: "Rejected during human review.",
          });
        }
        const decisionPath = await createTrajectoryArtifact(
          "review-decision",
          {
            version: 1,
            approved: false,
            tools: [],
            tasks: [],
            approvalPath,
            draftPath,
            proposedToolsPath: proposalFile,
            sourceDiff: { status: "rejected", timestamp: new Date().toISOString() },
            reviewedAt: new Date().toISOString(),
          },
          {
            sitePath,
            draftPath,
            approvalPath,
            port,
            ...trajectoryMetadata,
          }
        );
        response.type("html").send(`<!doctype html><html lang="en"><body>
<h1>Draft rejected</h1><p>No approval manifest was changed.</p></body></html>`);
        finish({ approved: false, tools: [], approvedTools: [], tasks: [], approvalPath, decisionPath, sourceDiff: { status: "rejected", timestamp: new Date().toISOString() } });
      } catch (error) {
        response
          .status(500)
          .type("text")
          .send(error instanceof Error ? error.message : String(error));
      }
    });

    const listener = app.listen(port, "127.0.0.1", () => {
      server = listener;
      console.log(`[review] approval UI: http://127.0.0.1:${port}`);
      console.log(`[review] approved manifest will be saved to ${approvalPath}`);
      console.log("[review] approve or reject the draft in the browser");
    });
    listener.once("error", reject);
  });

  return decision;
}

export async function runReview(opts: ReviewOptions): Promise<void> {
  const sitePath = path.resolve(opts.path ?? process.cwd());
  const result = await runReviewPrompt(sitePath, opts.port);
  console.log(
    `[review] ${result.approved ? "approved" : "rejected"} ${
      result.tools.length
    } tool(s), ${result.tasks.length} task(s)`
  );
  if (result.decisionPath) {
    console.log(`[review] decision saved to ${result.decisionPath}`);
  }
}
