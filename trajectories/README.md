# WebMCPify trajectories

Trajectories are the append-only evidence trail for a WebMCPify run. Every
agent session and structured checkpoint gets a new timestamped JSON file; no
run replaces an earlier run. The JSON file is the raw output or artifact
payload. Its matching `.meta.json` sidecar describes how that payload was
produced and links it to the rest of the workflow.

The `README.md` table below is an index, not the source of truth for a score.
Use the raw payload for the recorded result and the sidecar for its provenance.

## Run lifecycle

The normal evidence flow is:

```text
generate
   │  structured discovery + proposed diff + task definitions
   ▼
   review-decision ──► approved-tools.json + tasks.json + approved patch
        │
        └──► apply ──► build/typecheck ──► apply artifact
   │
   ├──► baseline ──► baseline-eval
   │
   └──► test ──────► test-eval ──► repair ──► test-eval
                                      │
                                      └── durable mode:
                                          temporal-test → temporal-repair
```

The agent's report and the independent evaluator are deliberately separate:

- `baseline` is allowed to inspect and edit source, and may describe its own
  verification. `baseline-eval` is the independent score for comparison.
- `test` is source-blind and MCP-only. `test-eval` runs the approved task
  expressions in the live page after the agent session and does not trust the
  agent's claims.
- `repair` receives failed task IDs and verification details and records the
  repair agent's output. A later `test` is required to measure whether the
  repair worked.
- Temporal artifacts record per-attempt checkpoints and the final durable
  workflow result. Temporal does not automatically apply a generated source
  diff.

## Artifact types

| Role | Payload and purpose | Main links |
| --- | --- | --- |
| `generate-*.json` | Read-only provider output: discovery findings, structured tool proposal, proposed WebMCP diff, placement/wiring notes, and a 5–6 task proposal. | `generate-*.meta.json` |
| `discovery-*.json` | Structured static discovery snapshot for one target project. | `discoveryPath`, `sitePath` |
| `proposed-tools-*.json` | Validated structured WebMCP tool proposals derived from discovery. | `discoveryPath`, `sourceTrajectory`, `proposedToolsPath` |
| `review-decision-*.json` | Human approval or rejection, selected tools, edited task definitions, and paths to the draft and project approval files. | `draftPath`, `approvalPath`, `tasksPath` |
| `patch-*.json` | Extracted unified source diff, changed files, source fingerprint, and patch status. | `sourceTrajectory`, `patchPath` |
| `apply-*.json` | Patch application, rollback, and build/typecheck result. | `runId`, `patchPath` |
| `baseline-*.json` | Source-editing, self-verifying baseline agent output. | `baseline-*.meta.json` |
| `baseline-eval-*.json` | Independent baseline score containing `tasks` and `scores`. | `sourceTrajectory` |
| `test-*.json` | Source-blind, MCP-only test-agent output for all approved tasks. | `test-*.meta.json` |
| `test-eval-*.json` | Independent score containing the exact task definitions used and one result per task. | `sourceTrajectory`, `approvalPath` |
| `repair-*.json` | Plain repair-agent output, including the failed task context. | `sourceEvaluation` |
| `temporal-test-*.json` | One durable score checkpoint for one task and one attempt. | `attempt`, task ID in metadata |
| `temporal-repair-*.json` | Durable workflow result, or an error payload when the workflow fails. | `workflowId`, task ID, attempt budget |

Filenames have the form
`<role>-<ISO-timestamp>-<unique-suffix>[-<label>].json`. The timestamp and
suffix make each artifact safe to retain across repeated runs. Every generated
JSON payload has a sidecar with the same name plus `.meta.json`, for example:

```text
test-2026-08-31T12-30-00-000Z-a1b2c3d4-all-tasks.json
test-2026-08-31T12-30-00-000Z-a1b2c3d4-all-tasks.meta.json
```

## Metadata sidecar

The sidecar always includes `version: 1` and a repository-relative
`trajectory` path. Agent-session sidecars also include the following fields:

| Field | Meaning |
| --- | --- |
| `role` | Stage that produced the file, such as `generate`, `test`, or `repair`. |
| `status` | `running`, `completed`, or `failed`; completed CLI runs normally record `completed`. |
| `startedAt`, `finishedAt` | ISO timestamps for the provider session or checkpoint. |
| `durationMs` | Elapsed agent-session time, when available. |
| `provider` | `gemini`, `antigravity`, `claude`, or `codex`. |
| `cwd` / `sitePath` | Target project context. `cwd` is the provider working directory; stage metadata may also include `sitePath`. |
| `url` | Live site URL used by browser-facing stages. |
| `prompt` | Full instructions sent to the agent. |
| `allowedTools` | Provider permission hint or allowed tool set. |
| `mcpConfig` | MCP configuration passed to the agent, when one was used. |
| link fields | Stage-specific relationships such as `sourceTrajectory`, `sourceEvaluation`, `draftPath`, `approvalPath`, or `tasksPath`. |
| stage fields | Additional context such as `method`, `taskCount`, `failures`, `attempt`, `workflowId`, and `maxRepairs`. |

Fields whose values are `undefined` are omitted by JSON serialization. The
metadata is written after a normal agent session finishes. If the provider
fails, WebMCPify attempts to preserve stdout (or a small error JSON payload)
and records `status: "failed"`, `error`, and available `stderr` in the
sidecar. A metadata-write failure is reported to stderr but does not erase the
raw provider output.

## Structured payloads

Independent score artifacts use this shape:

```json
{
  "tasks": [
    { "id": "task-id", "description": "...", "verify": "..." }
  ],
  "scores": {
    "passed": 1,
    "total": 1,
    "results": [
      { "task": "task-id", "passed": true, "detail": "verify → true" }
    ]
  }
}
```

`test-eval` additionally stores `version`, `provider`, `url`, and
`recordedAt`. The `tasks` array is copied into the evaluation so a later task
file edit does not change what that score meant. A verifier that throws is
recorded as a failed result with `detail` beginning `verify threw:`.

Review decisions contain `approved`, `tools`, and `tasks`. On approval, the
same approved task definitions are written to the target project's
`tasks.json`; the tool manifest is written to
`<site>/.webmcpify/approved-tools.json`. Rejection records an explicit
`approved: false` checkpoint and does not modify an existing approval manifest.

## How to inspect a run

1. Find the relevant role in the index. If several projects share this
   checkout, confirm `sitePath`, `url`, and `workflowId` in the sidecar before
   treating it as the desired run.
2. Open the sidecar first. It gives the prompt, permissions, timestamps, task
   ID, and links to upstream or downstream artifacts.
3. Open the linked raw trajectory. Provider output may be a JSON object/string
   or, for Codex, a JSON-lines array of events; do not interpret progress
   events as a task score.
4. For pass/fail, open the linked `*-eval-*.json` artifact and inspect both
   `scores.results` and each task's `verify` expression.
5. For a repair, compare the failed `test-eval` with the subsequent `repair`
   output and then run a new `test`; the old score is never rewritten.

Useful relationships are encoded in metadata rather than inferred from file
timestamps:

```text
generate.meta.trajectory
        ▲
review-decision.meta.draftPath
        │
test-eval.meta.sourceTrajectory ──► test.json
        │
repair.meta.sourceEvaluation ────► test-eval.json
```

`eval` and plain `repair` currently select the latest `test-eval` artifact in
the package-level `trajectories/` directory. When multiple target projects are
being evaluated from the same checkout, verify the sidecar's `sitePath` and
`url` before using that result.

## Historical artifacts

- [`baseline.json`](./baseline.json) — the original reference baseline run,
  retained for comparison with the timestamped format. It predates the current
  sidecar/index contract and therefore has no matching metadata file.

## Index format

The table is appended automatically whenever an agent run or structured
checkpoint is recorded. It is intentionally lightweight; fields that do not
fit the columns belong in the sidecar. A row has this shape:

| Recorded | Role | Status | Provider | Task | Raw/artifact | Metadata |
| --- | --- | --- | --- | --- | --- | --- |
| — | discovery | completed | — | — | [discovery-2026-08-31T13-56-22-930Z-9f7ddf4f.json](./discovery-2026-08-31T13-56-22-930Z-9f7ddf4f.json) | [metadata](./discovery-2026-08-31T13-56-22-930Z-9f7ddf4f.meta.json) |
| — | discovery | completed | — | — | [discovery-2026-08-31T13-56-24-860Z-1b9ffa0a.json](./discovery-2026-08-31T13-56-24-860Z-1b9ffa0a.json) | [metadata](./discovery-2026-08-31T13-56-24-860Z-1b9ffa0a.meta.json) |
| — | discovery | completed | — | — | [discovery-2026-08-31T13-59-05-435Z-67f08465.json](./discovery-2026-08-31T13-59-05-435Z-67f08465.json) | [metadata](./discovery-2026-08-31T13-59-05-435Z-67f08465.meta.json) |
| — | discovery | completed | — | — | [discovery-2026-08-31T13-59-07-761Z-b985372f.json](./discovery-2026-08-31T13-59-07-761Z-b985372f.json) | [metadata](./discovery-2026-08-31T13-59-07-761Z-b985372f.meta.json) |
| — | discovery | completed | — | — | [discovery-2026-08-31T14-00-43-449Z-456979ec.json](./discovery-2026-08-31T14-00-43-449Z-456979ec.json) | [metadata](./discovery-2026-08-31T14-00-43-449Z-456979ec.meta.json) |
| — | discovery | completed | — | — | [discovery-2026-08-31T14-00-45-511Z-4ef63fc3.json](./discovery-2026-08-31T14-00-45-511Z-4ef63fc3.json) | [metadata](./discovery-2026-08-31T14-00-45-511Z-4ef63fc3.meta.json) |
| 2026-08-31T14:01:37.730Z | discovery | completed | — | — | [discovery-2026-08-31T14-01-37-730Z-b6f6e587.json](./discovery-2026-08-31T14-01-37-730Z-b6f6e587.json) | [metadata](./discovery-2026-08-31T14-01-37-730Z-b6f6e587.meta.json) |
| 2026-08-31T14:01:39.832Z | discovery | completed | — | — | [discovery-2026-08-31T14-01-39-832Z-b4925d17.json](./discovery-2026-08-31T14-01-39-832Z-b4925d17.json) | [metadata](./discovery-2026-08-31T14-01-39-832Z-b4925d17.meta.json) |
| 2026-08-31T14:12:53.902Z | discovery | completed | — | — | [discovery-2026-08-31T14-12-53-902Z-59b7aebe.json](./discovery-2026-08-31T14-12-53-902Z-59b7aebe.json) | [metadata](./discovery-2026-08-31T14-12-53-902Z-59b7aebe.meta.json) |
| 2026-08-31T14:19:25.312Z | discovery | completed | — | — | [discovery-2026-08-31T14-19-25-313Z-8c9223b7.json](./discovery-2026-08-31T14-19-25-313Z-8c9223b7.json) | [metadata](./discovery-2026-08-31T14-19-25-313Z-8c9223b7.meta.json) |
| — | generate | failed | codex | — | [generate-2026-08-31T14-21-44-489Z-0bd79908.json](./generate-2026-08-31T14-21-44-489Z-0bd79908.json) | [metadata](./generate-2026-08-31T14-21-44-489Z-0bd79908.meta.json) |
| — | generate | failed | codex | — | [generate-2026-08-31T14-21-44-513Z-fdfd5b06.json](./generate-2026-08-31T14-21-44-513Z-fdfd5b06.json) | [metadata](./generate-2026-08-31T14-21-44-513Z-fdfd5b06.meta.json) |
| — | proposed-tools | completed | — | — | [proposed-tools-2026-08-31T14-22-51-305Z-861912eb.json](./proposed-tools-2026-08-31T14-22-51-305Z-861912eb.json) | [metadata](./proposed-tools-2026-08-31T14-22-51-305Z-861912eb.meta.json) |
| — | proposed-tools | completed | — | — | [proposed-tools-2026-08-31T14-22-51-367Z-6ed024d5.json](./proposed-tools-2026-08-31T14-22-51-367Z-6ed024d5.json) | [metadata](./proposed-tools-2026-08-31T14-22-51-367Z-6ed024d5.meta.json) |
