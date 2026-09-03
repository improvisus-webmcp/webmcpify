import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core";
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

async function getBrowser(): Promise<Browser> {
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
  return browserCache;
}

async function getIsolatedPage(url: string, resetStorage = true): Promise<{ context: BrowserContext; page: Page }> {
  const browser = await getBrowser();
  const context = browser.contexts()[0];
  if (!context) throw new Error("The connected Chrome instance has no browser context.");

  await context.clearCookies();
  const page = await context.newPage();
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    if (resetStorage) {
      await page.evaluate(() => {
        window.localStorage.clear();
        window.sessionStorage.clear();
      });
      await page.reload({ waitUntil: "domcontentloaded", timeout: 30_000 });
    }
    await page.locator("body").waitFor({ timeout: 15_000 });
    return { context, page };
  } catch (error) {
    await page.close().catch(() => undefined);
    throw error;
  }
}

export async function scoreTask(url: string, task: Task, options: { resetStorage?: boolean } = {}): Promise<TaskResult> {
  let page: Page | undefined;
  try {
    ({ page } = await getIsolatedPage(url, options.resetStorage ?? true));
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
  } finally {
    await page?.close().catch(() => undefined);
  }
}

/** Reset the isolated browser state before a task agent runs. */
export async function resetScoringState(url: string): Promise<void> {
  const { page } = await getIsolatedPage(url, true);
  await page.close();
}

/** Ensure the connected browser exposes the runtime required by WebMCP. */
export async function assertWebMcpRuntime(url: string): Promise<void> {
  let page: Page | undefined;
  try {
    ({ page } = await getIsolatedPage(url, false));
    try {
      await page.waitForFunction(
        () => Boolean((navigator as Navigator & { modelContext?: unknown }).modelContext),
        undefined,
        { timeout: 3_000 },
      );
    } catch {
      throw new Error(
        "Chrome does not expose navigator.modelContext. Restart the dedicated test browser with " +
        "--enable-features=DevToolsWebMCPSupport,WebMCP and retry."
      );
    }
  } finally {
    await page?.close().catch(() => undefined);
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
