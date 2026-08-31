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

type PersistedShopState = {
  cart?: Record<string, number>;
  isLoggedIn?: boolean;
};

const TASK_COUNT = 6;

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

async function persistedState(page: Page): Promise<PersistedShopState> {
  return page.evaluate(() => {
    const raw = window.localStorage.getItem("webmcp-coffee-store");
    if (!raw) return {};

    try {
      const parsed = JSON.parse(raw) as {
        state?: PersistedShopState;
      };
      return parsed.state ?? {};
    } catch {
      return {};
    }
  });
}

async function cartCount(page: Page): Promise<number> {
  return Number(await page.locator(".cart-count").textContent());
}

async function runTask(
  name: string,
  task: () => Promise<void>
): Promise<TaskScore> {
  try {
    await task();
    return { name, passed: true };
  } catch (error) {
    return {
      name,
      passed: false,
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function scoreTasks(url: string): Promise<ScoreSummary> {
  const taskNames = [
    "catalog renders",
    "roast filter updates visible coffees",
    "add to cart updates cart and localStorage",
    "quantity update updates cart and localStorage",
    "cart survives a reload",
    "login state persists",
  ];

  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  const scores: TaskScore[] = [];

  try {
    browser = await chromium.launch({
      executablePath: chromeExecutable(),
      headless: true,
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    });
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.locator(".product-card").first().waitFor({ timeout: 15_000 });

    scores.push(
      await runTask(taskNames[0], async () => {
        const productCount = await page.locator(".product-card").count();
        if (productCount !== 6) {
          throw new Error(`expected 6 products, found ${productCount}`);
        }
        await page.locator("#cart-title").waitFor();
      })
    );

    scores.push(
      await runTask(taskNames[1], async () => {
        await page.locator("#roast-filter").selectOption("medium");
        const mediumCount = await page.locator(".product-card").count();
        if (mediumCount !== 2) {
          throw new Error(`expected 2 medium roasts, found ${mediumCount}`);
        }
        await page.locator("#roast-filter").selectOption("all");
      })
    );

    scores.push(
      await runTask(taskNames[2], async () => {
        const brazilCard = page.locator(".product-card").filter({
          hasText: "Fazenda Mio",
        });
        await brazilCard.getByRole("button", { name: "Add" }).click();
        if ((await cartCount(page)) !== 1) {
          throw new Error("cart count did not become 1");
        }
        const state = await persistedState(page);
        if (state.cart?.["brazil-cerrado"] !== 1) {
          throw new Error("Brazil cart line was not persisted");
        }
      })
    );

    scores.push(
      await runTask(taskNames[3], async () => {
        await page
          .getByRole("button", { name: "Increase Fazenda Mio quantity" })
          .click();
        if ((await cartCount(page)) !== 2) {
          throw new Error("cart count did not become 2");
        }
        const state = await persistedState(page);
        if (state.cart?.["brazil-cerrado"] !== 2) {
          throw new Error("updated Brazil quantity was not persisted");
        }
      })
    );

    scores.push(
      await runTask(taskNames[4], async () => {
        await page.reload({ waitUntil: "domcontentloaded" });
        await page.locator(".cart-count").waitFor();
        if ((await cartCount(page)) !== 2) {
          throw new Error("cart count was not restored after reload");
        }
        const state = await persistedState(page);
        if (state.cart?.["brazil-cerrado"] !== 2) {
          throw new Error("cart state was not restored from localStorage");
        }
      })
    );

    scores.push(
      await runTask(taskNames[5], async () => {
        await page.getByRole("button", { name: "Log in" }).click();
        const state = await persistedState(page);
        if (state.isLoggedIn !== true) {
          throw new Error("login state was not persisted");
        }
      })
    );
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    while (scores.length < TASK_COUNT) {
      scores.push({
        name: taskNames[scores.length],
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
