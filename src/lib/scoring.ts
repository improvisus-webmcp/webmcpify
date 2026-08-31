import { chromium, type Browser, type Page } from "playwright-core";
import type { Task } from "./tasks.js";

export interface TaskResult {
  task: string;
  passed: boolean;
  detail: string;
}

export interface TaskScoreSummary {
  passed: number;
  total: number;
  results: TaskResult[];
}

let browserCache: Browser | null = null;

async function getPage(url: string): Promise<Page> {
  if (!browserCache) {
    const cdpUrl = process.env.WEBMCPIFY_CDP_URL ?? "http://127.0.0.1:9222";
    try {
      browserCache = await chromium.connectOverCDP(cdpUrl);
    } catch (error) {
      throw new Error(
        `Could not connect to Chrome at ${cdpUrl}. Start Chrome with remote debugging enabled: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  const pages = browserCache.contexts().flatMap((context) => context.pages());
  if (pages.length === 0) {
    throw new Error("The connected Chrome instance has no open pages.");
  }

  const targetOrigin = new URL(url).origin;
  const page =
    pages.find((candidate) => {
      try {
        return new URL(candidate.url()).origin === targetOrigin;
      } catch {
        return false;
      }
    }) ?? pages[0];

  const pageOrigin = (() => {
    try {
      return new URL(page.url()).origin;
    } catch {
      return "";
    }
  })();
  if (pageOrigin !== targetOrigin) {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
  }
  await page.locator("body").waitFor({ timeout: 15_000 });
  return page;
}

export async function scoreTask(url: string, task: Task): Promise<TaskResult> {
  try {
    const page = await getPage(url);
    const passed = await page.evaluate(task.verify);
    return {
      task: task.id,
      passed: Boolean(passed),
      detail: `verify → ${String(passed)}`,
    };
  } catch (error) {
    return {
      task: task.id,
      passed: false,
      detail: `verify threw: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

export async function scoreTasks(
  url: string,
  tasks: Task[]
): Promise<TaskScoreSummary> {
  const results: TaskResult[] = [];
  for (const task of tasks) {
    results.push(await scoreTask(url, task));
  }

  return {
    passed: results.filter((result) => result.passed).length,
    total: tasks.length,
    results,
  };
}

/** Disconnect from CDP without closing the user's Chrome instance. */
export async function closeScoringBrowser(): Promise<void> {
  if (!browserCache) return;
  await browserCache.close();
  browserCache = null;
}
