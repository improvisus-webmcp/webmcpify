import express from "express";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { trajectoryPath } from "../lib/paths.js";

interface ReviewOptions {
  port?: string;
  path?: string;
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

export async function runReview(opts: ReviewOptions): Promise<void> {
  const sitePath = path.resolve(opts.path ?? process.cwd());
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
  const port = parsePort(opts.port);
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
<style>body{font:16px system-ui,sans-serif;max-width:1100px;margin:2rem auto;padding:0 1rem;color:#202124}pre{white-space:pre-wrap;background:#f5f5f5;padding:1rem;border-radius:8px;max-height:55vh;overflow:auto}label{display:block;margin:.5rem 0}textarea{width:100%;min-height:6rem}button{margin-top:1rem;padding:.6rem 1rem}</style>
</head><body><h1>Review WebMCP draft</h1>
<p>Approve only tools you have inspected. Approval writes a local manifest; it does not deploy source changes.</p>
<h2>Draft</h2><pre>${htmlEscape(draft)}</pre>
<form method="post" action="/approve"><h2>Approved tools</h2>${checkboxes}
<p>Additional or corrected names, one per line:</p><textarea name="additionalTools" placeholder="add_to_cart\ncheckout"></textarea>
<br><button type="submit">Save approval</button></form></body></html>`);
  });

  app.post("/approve", async (request, response) => {
    const selected = Array.isArray(request.body.tools)
      ? request.body.tools
      : typeof request.body.tools === "string"
        ? [request.body.tools]
        : [];
    const additional =
      typeof request.body.additionalTools === "string"
        ? request.body.additionalTools.split(/\r?\n/)
        : [];
    const tools = [...selected, ...additional]
      .flatMap((value) => String(value).split(/[,\s]+/))
      .map((value) => value.trim())
      .filter((value) => /^[a-z][a-z0-9_-]*$/i.test(value));
    const uniqueTools = [...new Set(tools)];

    await mkdir(path.dirname(approvalPath), { recursive: true });
    await writeFile(
      approvalPath,
      JSON.stringify(
        {
          version: 1,
          approvedAt: new Date().toISOString(),
          draftPath,
          tools: uniqueTools,
        },
        null,
        2
      ) + "\n",
      "utf8"
    );

    response.type("html").send(`<!doctype html><html lang="en"><body>
<h1>Approval saved</h1><p>${uniqueTools.length} tool(s) approved for <code>${htmlEscape(
      sitePath
    )}</code>.</p><p>You can close this window.</p></body></html>`);
  });

  const server = await new Promise<ReturnType<typeof app.listen>>(
    (resolve, reject) => {
      const listener = app.listen(port, "127.0.0.1", () => resolve(listener));
      listener.once("error", reject);
    }
  );

  console.log(`[review] approval UI: http://127.0.0.1:${port}`);
  console.log(`[review] approved manifest will be saved to ${approvalPath}`);
  console.log("[review] stop the server with Ctrl-C after saving approval");

  // Keep the command alive while the local UI is being used. Commander exits
  // naturally once this server is closed by a signal or the embedding caller.
  await new Promise<void>((resolve) => {
    server.once("close", resolve);
  });
}
