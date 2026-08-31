import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { validateVerifyExpression, verificationErrors, type VerificationContext, type VerificationIssue } from "./task-verification.js";

export interface Task {
  id: string;
  description: string;
  verify: string;
}

export function taskVerificationIssues(task: Task, context: VerificationContext = {}): VerificationIssue[] {
  return validateVerifyExpression(task.verify, task.description, context);
}

const MIN_TASKS = 5;
const MAX_TASKS = 6;

export function tasksPath(sitePath: string): string {
  return path.join(sitePath, "tasks.json");
}

export function validateTasks(value: unknown): Task[] {
  if (!Array.isArray(value)) {
    throw new Error("tasks.json must contain an array of tasks.");
  }
  if (value.length < MIN_TASKS || value.length > MAX_TASKS) {
    throw new Error(
      `tasks.json must contain ${MIN_TASKS}-${MAX_TASKS} tasks; received ${value.length}.`
    );
  }

  const ids = new Set<string>();
  return value.map((candidate, index) => {
    if (typeof candidate !== "object" || candidate === null) {
      throw new Error(`Task ${index + 1} must be an object.`);
    }

    const task = candidate as Partial<Task>;
    if (
      typeof task.id !== "string" ||
      !/^[a-z][a-z0-9_-]*$/i.test(task.id.trim())
    ) {
      throw new Error(
        `Task ${index + 1} has an invalid id; use letters, numbers, underscores, or hyphens.`
      );
    }
    const id = task.id.trim();
    if (ids.has(id)) {
      throw new Error(`Task id "${id}" is duplicated.`);
    }
    ids.add(id);

    if (typeof task.description !== "string" || !task.description.trim()) {
      throw new Error(`Task "${id}" must have a description.`);
    }
    if (typeof task.verify !== "string" || !task.verify.trim()) {
      throw new Error(`Task "${id}" must have a verify expression.`);
    }

    const issues = verificationErrors(taskVerificationIssues({ id, description: task.description.trim(), verify: task.verify.trim() }));
    if (issues.length) throw new Error(`Task "${id}" has invalid verification: ${issues.map((issue) => issue.message).join(" ")}`);

    return {
      id,
      description: task.description.trim(),
      verify: task.verify.trim(),
    };
  });
}

export async function loadTasks(sitePath: string): Promise<Task[]> {
  const filePath = tasksPath(sitePath);
  if (!existsSync(filePath)) {
    throw new Error(
      `No tasks.json found at ${filePath}. Run "webmcpify generate" and approve the task list with "webmcpify review" first.`
    );
  }

  try {
    return validateTasks(JSON.parse(await readFile(filePath, "utf8")));
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`Could not parse ${filePath}: ${error.message}`);
    }
    throw error;
  }
}

export async function loadTasksIfPresent(
  sitePath: string
): Promise<Task[] | undefined> {
  const filePath = tasksPath(sitePath);
  if (!existsSync(filePath)) return undefined;
  return loadTasks(sitePath);
}

export async function writeTasks(
  sitePath: string,
  tasks: Task[]
): Promise<string> {
  const validated = validateTasks(tasks);
  const filePath = tasksPath(sitePath);
  await writeFile(filePath, JSON.stringify(validated, null, 2) + "\n", "utf8");
  return filePath;
}

export function parseTasksJson(raw: string): Task[] {
  try {
    return validateTasks(JSON.parse(raw));
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`The approved task list is not valid JSON: ${error.message}`);
    }
    throw error;
  }
}

function taskArray(value: unknown): Task[] | undefined {
  try {
    return validateTasks(value);
  } catch {
    return undefined;
  }
}

/** Extract a 5-6 task proposal from an agent's draft without executing it. */
export function extractTasksFromText(text: string): Task[] | undefined {
  const candidates: string[] = [text.trim()];
  for (const match of text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)) {
    if (match[1]) candidates.push(match[1].trim());
  }

  const firstArray = text.indexOf("[");
  const lastArray = text.lastIndexOf("]");
  if (firstArray >= 0 && lastArray > firstArray) {
    candidates.push(text.slice(firstArray, lastArray + 1));
  }

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      const tasks = taskArray(parsed);
      if (tasks) return tasks;
    } catch {
      // Continue through the possible fenced or embedded JSON candidates.
    }
  }
  return undefined;
}
