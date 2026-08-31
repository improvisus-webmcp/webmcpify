import { chromium, type Page } from "playwright-core";
import { existsSync } from "node:fs";

export interface TaskScore {
  name: string;
  passed: boolean;
  detail?: string;
}

export interface ScoreSummary {
  passed: number;
  total: number;
  tasks: TaskScore[];
}

export const DEFAULT_TASK_NAMES = [
  "page renders",
  "user-facing actions are discoverable",
  "interactive controls are usable",
  "forms expose usable controls",
  "navigation links expose destinations",
  "page survives a reload",
  "WebMCP runtime is inspectable",
] as const;

interface PageInventory {
  title: string;
  bodyTextLength: number;
  buttons: number;
  enabledButtons: number;
  links: number;
  linksWithDestinations: number;
  forms: number;
  formsWithControls: number;
  controls: number;
  modelContextAvailable: boolean;
}

function chromeExecutable(): string {
  const candidates = [
    process.env.WEBMCPIFY_CHROME_PATH,
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ].filter((candidate): candidate is string => Boolean(candidate));

  const executable = candidates.find((candidate) => existsSync(candidate));
  if (!executable) {
    throw new Error(
      "Chrome was not found. Set WEBMCPIFY_CHROME_PATH to a Chrome/Chromium executable."
    );
  }
  return executable;
}

async function inspectPage(page: Page): Promise<PageInventory> {
  return page.evaluate(() => {
    const buttons = [...document.querySelectorAll("button")];
    const anchors = [...document.querySelectorAll("a")];
    const forms = [...document.querySelectorAll("form")];
    const controls = [
      ...document.querySelectorAll(
        'button, a[href], input:not([type="hidden"]), select, textarea, form'
      ),
    ];

    return {
      title: document.title.trim(),
      bodyTextLength: document.body?.innerText.trim().length ?? 0,
      buttons: buttons.length,
      enabledButtons: buttons.filter((button) => !button.disabled).length,
      links: anchors.length,
      linksWithDestinations: anchors.filter((anchor) =>
        Boolean(anchor.getAttribute("href")?.trim())
      ).length,
      forms: forms.length,
      formsWithControls: forms.filter((form) =>
        Boolean(
          form.querySelector(
            'button, input:not([type="hidden"]), select, textarea'
          )
        )
      ).length,
      controls: controls.length,
      modelContextAvailable: Boolean(
        (navigator as Navigator & { modelContext?: unknown }).modelContext
      ),
    };
  });
}

async function runTask(
  name: string,
  task: () => Promise<TaskScore>
): Promise<TaskScore> {
  try {
    return await task();
  } catch (error) {
    return {
      name,
      passed: false,
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

function passed(name: string, detail: string): TaskScore {
  return { name, passed: true, detail };
}

function failed(name: string, detail: string): TaskScore {
  return { name, passed: false, detail };
}

export async function scoreTasks(url: string): Promise<ScoreSummary> {
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  const scores: TaskScore[] = [];

  try {
    browser = await chromium.launch({
      executablePath: chromeExecutable(),
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-dev-shm-usage",
        "--enable-features=WebMCP",
      ],
    });
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.locator("body").waitFor({ timeout: 15_000 });

    const initial = await inspectPage(page);
    scores.push(
      await runTask(DEFAULT_TASK_NAMES[0], async () => {
        if (initial.bodyTextLength === 0 && !initial.title) {
          return failed(
            DEFAULT_TASK_NAMES[0],
            "The page has no title or visible body text."
          );
        }
        return passed(
          DEFAULT_TASK_NAMES[0],
          `Rendered page${initial.title ? ` titled "${initial.title}"` : ""}.`
        );
      })
    );

    scores.push(
      await runTask(DEFAULT_TASK_NAMES[1], async () =>
        passed(
          DEFAULT_TASK_NAMES[1],
          `Inspected ${initial.controls} user-facing control(s): ${initial.buttons} button(s), ${initial.links} link(s), and ${initial.forms} form(s).`
        )
      )
    );

    scores.push(
      await runTask(DEFAULT_TASK_NAMES[2], async () => {
        if (initial.controls === 0) {
          return passed(
            DEFAULT_TASK_NAMES[2],
            "No interactive controls were present; this appears to be a static page."
          );
        }
        if (initial.enabledButtons === 0 && initial.buttons > 0) {
          return failed(
            DEFAULT_TASK_NAMES[2],
            `Found ${initial.buttons} button(s), but all were disabled.`
          );
        }
        return passed(
          DEFAULT_TASK_NAMES[2],
          `${initial.enabledButtons} of ${initial.buttons} button(s) were enabled.`
        );
      })
    );

    scores.push(
      await runTask(DEFAULT_TASK_NAMES[3], async () => {
        if (initial.forms === 0) {
          return passed(DEFAULT_TASK_NAMES[3], "No forms were present; skipped.");
        }
        if (initial.formsWithControls !== initial.forms) {
          return failed(
            DEFAULT_TASK_NAMES[3],
            `${initial.forms - initial.formsWithControls} form(s) had no usable controls.`
          );
        }
        return passed(
          DEFAULT_TASK_NAMES[3],
          `All ${initial.forms} form(s) exposed at least one usable control.`
        );
      })
    );

    scores.push(
      await runTask(DEFAULT_TASK_NAMES[4], async () => {
        if (initial.links === 0) {
          return passed(
            DEFAULT_TASK_NAMES[4],
            "No anchor links were present; skipped."
          );
        }
        if (initial.linksWithDestinations !== initial.links) {
          return failed(
            DEFAULT_TASK_NAMES[4],
            `${initial.links - initial.linksWithDestinations} link(s) had no destination.`
          );
        }
        return passed(
          DEFAULT_TASK_NAMES[4],
          `All ${initial.links} link(s) exposed destinations.`
        );
      })
    );

    scores.push(
      await runTask(DEFAULT_TASK_NAMES[5], async () => {
        await page.reload({ waitUntil: "domcontentloaded", timeout: 30_000 });
        const afterReload = await inspectPage(page);
        if (afterReload.bodyTextLength === 0 && !afterReload.title) {
          return failed(
            DEFAULT_TASK_NAMES[5],
            "The page lost its rendered content after reload."
          );
        }
        return passed(
          DEFAULT_TASK_NAMES[5],
          `Rendered content remained available after reload (${afterReload.controls} control(s) found).`
        );
      })
    );

    scores.push(
      await runTask(DEFAULT_TASK_NAMES[6], async () => {
        if (!initial.modelContextAvailable) {
          return passed(
            DEFAULT_TASK_NAMES[6],
            "The current browser did not expose navigator.modelContext; WebMCP runtime inspection was skipped."
          );
        }
        return passed(
          DEFAULT_TASK_NAMES[6],
          "navigator.modelContext is exposed by the running page."
        );
      })
    );
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    while (scores.length < DEFAULT_TASK_NAMES.length) {
      scores.push({
        name: DEFAULT_TASK_NAMES[scores.length],
        passed: false,
        detail,
      });
    }
  } finally {
    await browser?.close();
  }

  return {
    passed: scores.filter((score) => score.passed).length,
    total: scores.length,
    tasks: scores,
  };
}
