import express from "express";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  createTrajectoryArtifact,
  latestTrajectoryPath,
} from "../lib/trajectories.js";
import {
  extractTasksFromText,
  loadTasksIfPresent,
  parseTasksJson,
  tasksPath,
  writeTasks,
  type Task,
} from "../lib/tasks.js";

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

function draftToolNames(draft: string): string[] {
  const names = new Set<string>();
  const patterns = [
    /(?:tool\s*name|toolname)\s*[:=]\s*[`"']?([a-z][a-z0-9_-]*)/gi,
    /(?:registerTool|register)\s*\(\s*[`"']([a-z][a-z0-9_-]*)[`"']/gi,
  ];

  for (const pattern of patterns) {
    for (const match of draft.matchAll(pattern)) {
      if (match[1]) names.add(match[1]);
    }
  }
  return [...names];
}

function parsePort(value: string | undefined): number {
  const port = Number(value ?? "4173");
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`Invalid review port "${value}". Use a number from 1 to 65535.`);
  }
  return port;
}

function approvedToolNames(requestBody: {
  tools?: unknown;
  additionalTools?: unknown;
}): string[] {
  const selected = Array.isArray(requestBody.tools)
    ? requestBody.tools
    : typeof requestBody.tools === "string"
      ? [requestBody.tools]
      : [];
  const additional =
    typeof requestBody.additionalTools === "string"
      ? requestBody.additionalTools.split(/\r?\n/)
      : [];

  return [
    ...new Set(
      [...selected, ...additional]
        .flatMap((value) => String(value).split(/[,\s]+/))
        .map((value) => value.trim())
        .filter((value) => /^[a-z][a-z0-9_-]*$/i.test(value))
    ),
  ];
}

function approvedTaskIds(requestBody: { taskIds?: unknown }): string[] {
  const selected = Array.isArray(requestBody.taskIds)
    ? requestBody.taskIds
    : typeof requestBody.taskIds === "string"
      ? [requestBody.taskIds]
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
  const draftPath = await latestTrajectoryPath("generate");
  if (!draftPath || !existsSync(draftPath)) {
    throw new Error(
      "No generated draft found in trajectories. Run \"webmcpify generate\" first."
    );
  }

  const draft = draftText(await readFile(draftPath, "utf8"));
  const toolNames = draftToolNames(draft);
  const proposedTasks =
    extractTasksFromText(draft) ?? (await loadTasksIfPresent(sitePath)) ?? [];
  const projectTasksPath = tasksPath(sitePath);
  const approvalPath = path.join(
    sitePath,
    ".webmcpify",
    "approved-tools.json"
  );
  const port = parsePort(requestedPort);
  const app = express();
  app.use(express.urlencoded({ extended: false, limit: "64kb" }));

  app.get("/", (_request, response) => {
    const checkboxes = toolNames.length
      ? toolNames
          .map(
            (name) =>
              `<label><input type="checkbox" name="tools" value="${htmlEscape(
                name
              )}" checked> ${htmlEscape(name)}</label>`
          )
          .join("\n")
      : `<p>No tool names could be extracted automatically. Enter approved names below.</p>`;

    const taskRows = proposedTasks.length
      ? proposedTasks
          .map(
            (task) =>
              `<label><input type="checkbox" name="taskIds" value="${htmlEscape(
                task.id
              )}" checked> <strong>${htmlEscape(task.id)}</strong>: ${htmlEscape(
                task.description
              )}<br><code>${htmlEscape(task.verify)}</code></label>`
          )
          .join("\n")
      : `<p>No valid 5-6 task proposal was found. Edit the JSON below before approving.</p>`;
    const taskJson = htmlEscape(JSON.stringify(proposedTasks, null, 2));

    response.type("html").send(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>WebMCPify review</title>
<style>body{font:16px system-ui,sans-serif;max-width:1100px;margin:2rem auto;padding:0 1rem;color:#202124}pre{white-space:pre-wrap;background:#f5f5f5;padding:1rem;border-radius:8px;max-height:45vh;overflow:auto}label{display:block;margin:.5rem 0}textarea{width:100%;min-height:8rem;font:13px ui-monospace,monospace}code{display:inline-block;margin:.25rem 0;background:#f5f5f5;padding:.2rem}.section{border-top:1px solid #ddd;margin-top:1.5rem;padding-top:1rem}button{margin-top:1rem;padding:.6rem 1rem}.reject{margin-left:.5rem}</style>
</head><body><h1>Review WebMCP draft</h1>
<p>Approve only tools and verification tasks you have inspected. Approval writes a local manifest and <code>tasks.json</code>; it does not deploy source changes.</p>
<h2>Draft</h2><pre>${htmlEscape(draft)}</pre>
<form method="post" action="/approve"><h2>Approved tools</h2>${checkboxes}
<p>Additional or corrected names, one per line:</p><textarea name="additionalTools" placeholder="search_items\nsubmit_form"></textarea>
<div class="section"><h2>Approved verification tasks</h2>${taskRows}
<p>Edit the task definitions below if needed. Every task must have an observable verify expression.</p>
<textarea name="tasksJson" aria-label="Tasks JSON">${taskJson}</textarea></div>
<br><button type="submit">Save approval</button><button class="reject" type="submit" formaction="/reject">Reject draft</button></form></body></html>`);
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

    app.post("/approve", async (request, response) => {
      try {
        const tools = approvedToolNames(request.body);
        const taskJson =
          typeof request.body.tasksJson === "string"
            ? request.body.tasksJson
            : JSON.stringify(proposedTasks);
        const editedTasks = parseTasksJson(taskJson);
        const selectedTaskIds = approvedTaskIds(request.body);
        const tasks = proposedTasks.length
          ? editedTasks.filter((task) => selectedTaskIds.includes(task.id))
          : editedTasks;
        if (tasks.length === 0) {
          throw new Error("Approve at least one verification task.");
        }
        await writeTasks(sitePath, tasks);
        await mkdir(path.dirname(approvalPath), { recursive: true });
        await writeFile(
          approvalPath,
          JSON.stringify(
            {
              version: 1,
              approvedAt: new Date().toISOString(),
              draftPath,
              tools,
              tasks,
              tasksPath: projectTasksPath,
            },
            null,
            2
          ) + "\n",
          "utf8"
        );

        const decisionPath = await createTrajectoryArtifact(
          "review-decision",
          {
            version: 1,
            approved: true,
            tools,
            tasks,
            approvalPath,
            tasksPath: projectTasksPath,
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
<h1>Approval saved</h1><p>${tools.length} tool(s) and ${tasks.length} task(s) approved for <code>${htmlEscape(
          sitePath
        )}</code>.</p><p>You can close this window.</p></body></html>`);
        finish({ approved: true, tools, tasks, approvalPath, decisionPath });
      } catch (error) {
        response
          .status(500)
          .type("text")
          .send(error instanceof Error ? error.message : String(error));
      }
    });

    app.post("/reject", async (_request, response) => {
      try {
        const decisionPath = await createTrajectoryArtifact(
          "review-decision",
          {
            version: 1,
            approved: false,
            tools: [],
            tasks: [],
            approvalPath,
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
<h1>Draft rejected</h1><p>No approval manifest was changed.</p></body></html>`);
        finish({ approved: false, tools: [], tasks: [], approvalPath, decisionPath });
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
