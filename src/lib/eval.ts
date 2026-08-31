// Backwards-compatible import path. Task scoring lives in scoring.ts so the
// CLI command named `eval` does not share implementation with the scorer.
export {
  closeScoringBrowser,
  scoreTask,
  scoreTasks,
} from "./scoring.js";
export type {
  TaskResult,
  TaskScoreSummary as ScoreSummary,
} from "./scoring.js";
