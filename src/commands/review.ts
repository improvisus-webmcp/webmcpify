import express from "express";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { trajectoryPath } from "../lib/paths.js";

export interface ReviewOptions {
  port?: string;
  path?: string;
}

export interface ReviewResult {
  approved: boolean;
  tools: string[];
  approvalPath: string;
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

/** Start the approval UI and resolve only after the owner approves or rejects. */
export async function runReviewPrompt(
  sitePath: string,
  requestedPort?: string
): Promise<ReviewResult> {
  const draftPath = trajectoryPath("generate.json");
  if (!existsSync(draftPath)) {
    throw new Error(
      `No generated draft found at ${draftPath}. Run "webmcpify generate" first.`
    );
  }

  const draft = draftText(await readFile(draftPath, "utf8"));
  const toolNames = draftToolNames(draft);
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

    response.type("html").send(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>WebMCPify review</title>
<style>body{font:16px system-ui,sans-serif;max-width:1100px;margin:2rem auto;padding:0 1rem;color:#202124}pre{white-space:pre-wrap;background:#f5f5f5;padding:1rem;border-radius:8px;max-height:55vh;overflow:auto}label{display:block;margin:.5rem 0}textarea{width:100%;min-height:6rem}button{margin-top:1rem;padding:.6rem 1rem}.reject{margin-left:.5rem}</style>
</head><body><h1>Review WebMCP draft</h1>
<p>Approve only tools you have inspected. Approval writes a local manifest; it does not deploy source changes.</p>
<h2>Draft</h2><pre>${htmlEscape(draft)}</pre>
<form method="post" action="/approve"><h2>Approved tools</h2>${checkboxes}
<p>Additional or corrected names, one per line:</p><textarea name="additionalTools" placeholder="search_items\nsubmit_form"></textarea>
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
        await mkdir(path.dirname(approvalPath), { recursive: true });
        await writeFile(
          approvalPath,
          JSON.stringify(
            {
              version: 1,
              approvedAt: new Date().toISOString(),
              draftPath,
              tools,
            },
            null,
            2
          ) + "\n",
          "utf8"
        );

        response.type("html").send(`<!doctype html><html lang="en"><body>
<h1>Approval saved</h1><p>${tools.length} tool(s) approved for <code>${htmlEscape(
          sitePath
        )}</code>.</p><p>You can close this window.</p></body></html>`);
        finish({ approved: true, tools, approvalPath });
      } catch (error) {
        response
          .status(500)
          .type("text")
          .send(error instanceof Error ? error.message : String(error));
      }
    });

    app.post("/reject", (_request, response) => {
      response.type("html").send(`<!doctype html><html lang="en"><body>
<h1>Draft rejected</h1><p>No approval manifest was changed.</p></body></html>`);
      finish({ approved: false, tools: [], approvalPath });
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
    } tool(s)`
  );
}
