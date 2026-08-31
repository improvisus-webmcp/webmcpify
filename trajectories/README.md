# WebMCPify trajectories

WebMCPify preserves evidence for each stage of a run instead of overwriting a
single file. Agent output is kept in the raw JSON trajectory; the matching
`.meta.json` file records the prompt, provider, target, permissions, timing,
status, and links to related artifacts.

## Artifact types

| Role | Contents |
| --- | --- |
| `baseline-*.json` | Self-verifying baseline agent output. |
| `baseline-eval-*.json` | Independent score produced after a baseline run. |
| `generate-*.json` | Read-only generation output, including discovery and draft. |
| `review-decision-*.json` | Human approval or rejection checkpoint. |
| `test-*.json` | Source-blind, MCP-only test-agent output. |
| `test-eval-*.json` | Independent score linked to the test trajectory. |
| `repair-*.json` | Plain repair-agent output and failure context. |
| `temporal-test-*.json` | Per-attempt score checkpoint from a durable workflow. |
| `temporal-repair-*.json` | Durable workflow result or failure artifact. |

The filenames contain a timestamp and unique suffix so later runs do not
overwrite earlier evidence. The index below is appended automatically whenever
an agent run or structured checkpoint is recorded.

## Historical artifacts

- [`baseline.json`](./baseline.json) — the original reference baseline run,
  retained for comparison with the timestamped format.

## Reading a run

Start with the role row in the index, open its metadata sidecar to see the
instructions and environment, then follow `sourceTrajectory` or related paths
to connect discovery, agent actions, feedback, human decisions, scoring, and
repair attempts.

| Recorded | Role | Status | Provider | Task | Raw/artifact | Metadata |
| --- | --- | --- | --- | --- | --- | --- |
