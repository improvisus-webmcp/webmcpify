import { Worker } from "@temporalio/worker";
import { fileURLToPath } from "node:url";
import * as activities from "./activities.js";

async function main(): Promise<void> {
  const worker = await Worker.create({
    workflowsPath: fileURLToPath(new URL("./workflows.js", import.meta.url)),
    activities,
    taskQueue: process.env.WEBMCPIFY_TEMPORAL_TASK_QUEUE ?? "webmcpify",
  });

  console.log(
    `[temporal] worker listening on task queue ${
      process.env.WEBMCPIFY_TEMPORAL_TASK_QUEUE ?? "webmcpify"
    }`
  );
  await worker.run();
}

main().catch((error: unknown) => {
  console.error(
    `[temporal] worker failed: ${error instanceof Error ? error.message : String(error)}`
  );
  process.exitCode = 1;
});
