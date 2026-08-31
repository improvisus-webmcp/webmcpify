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
| `review-decision-*.json` | Human approval or rejection, full selected/edited tool definitions, edited task definitions, verification findings, and paths to the draft and project approval files. | `draftPath`, `approvalPath`, `tasksPath`, `proposedToolsPath` |
| `patch-*.json` | Extracted unified source diff, changed files, source fingerprint, and patch status. | `sourceTrajectory`, `patchPath` |
| `apply-*.json` | Patch application, rollback, and build/typecheck result. | `runId`, `patchPath` |
| `baseline-*.json` | Source-editing, self-verifying baseline agent output. | `baseline-*.meta.json` |
| `baseline-eval-*.json` | Independent baseline score containing the exact task snapshot, task-set fingerprint, run/project identity, and task-level `scores`. | `sourceTrajectory`, `taskSetId`, `targetProject` |
| `test-*.json` | Source-blind, MCP-only test-agent output for all approved tasks. | `test-*.meta.json` |
| `test-eval-*.json` | Independent WebMCP score containing the exact task snapshot, task-set fingerprint, run/project identity, and one result per task. | `sourceTrajectory`, `approvalPath`, `taskSetId`, `targetProject` |
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

`baseline-eval` and `test-eval` store `version`, `mode`, `runId`,
`targetProject`, `taskSetId`, and the exact task snapshot. A later task-file
edit therefore does not change what a score meant. A verifier that throws is
recorded as a failed result with `detail` beginning `verify threw:`. Each task
is scored in a fresh page after cookies and web storage are cleared.

Review decisions contain `approved`, full structured `tools`, and `tasks`. On
approval, the same approved task definitions are written to the target
project's `tasks.json`; the complete tool definitions are written to
`<site>/.webmcpify/approved-tools.json`. Verification syntax/triviality errors
block approval, while statically detectable selector/state/tool mismatches are
recorded as review warnings for the human checkpoint. Rejection records an
explicit `approved: false` checkpoint and does not modify an existing approval
manifest.

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

`eval -p <target-project>` and plain `repair -p <target-project>` select the
latest matching `test-eval` artifact by sidecar project identity. Without a
path, `eval` retains the legacy latest-artifact behavior for convenience.

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
| — | proposed-tools | completed | — | — | [proposed-tools-2026-08-31T14-30-10-516Z-1326bce3.json](./proposed-tools-2026-08-31T14-30-10-516Z-1326bce3.json) | [metadata](./proposed-tools-2026-08-31T14-30-10-516Z-1326bce3.meta.json) |
| — | generate | completed | fixture | — | [generate-2026-08-31T14-30-10-526Z-7931119b.json](./generate-2026-08-31T14-30-10-526Z-7931119b.json) | [metadata](./generate-2026-08-31T14-30-10-526Z-7931119b.meta.json) |
| — | proposed-tools | completed | — | — | [proposed-tools-2026-08-31T14-30-21-262Z-f7435dcb.json](./proposed-tools-2026-08-31T14-30-21-262Z-f7435dcb.json) | [metadata](./proposed-tools-2026-08-31T14-30-21-262Z-f7435dcb.meta.json) |
| — | generate | completed | fixture | — | [generate-2026-08-31T14-30-21-271Z-faba4cc0.json](./generate-2026-08-31T14-30-21-271Z-faba4cc0.json) | [metadata](./generate-2026-08-31T14-30-21-271Z-faba4cc0.meta.json) |
| — | review-decision | completed | — | — | [review-decision-2026-08-31T14-30-21-498Z-9ebdc472.json](./review-decision-2026-08-31T14-30-21-498Z-9ebdc472.json) | [metadata](./review-decision-2026-08-31T14-30-21-498Z-9ebdc472.meta.json) |
| — | review-decision | completed | — | — | [review-decision-2026-08-31T14-30-21-656Z-340b39ac.json](./review-decision-2026-08-31T14-30-21-656Z-340b39ac.json) | [metadata](./review-decision-2026-08-31T14-30-21-656Z-340b39ac.meta.json) |
| — | proposed-tools | completed | — | — | [proposed-tools-2026-08-31T14-32-56-584Z-4cfe1b2d.json](./proposed-tools-2026-08-31T14-32-56-584Z-4cfe1b2d.json) | [metadata](./proposed-tools-2026-08-31T14-32-56-584Z-4cfe1b2d.meta.json) |
| — | proposed-tools | completed | — | — | [proposed-tools-2026-08-31T14-32-56-673Z-45f397e6.json](./proposed-tools-2026-08-31T14-32-56-673Z-45f397e6.json) | [metadata](./proposed-tools-2026-08-31T14-32-56-673Z-45f397e6.meta.json) |
| — | proposed-tools | completed | — | — | [proposed-tools-2026-08-31T14-33-00-735Z-cb56ea9f.json](./proposed-tools-2026-08-31T14-33-00-735Z-cb56ea9f.json) | [metadata](./proposed-tools-2026-08-31T14-33-00-735Z-cb56ea9f.meta.json) |
| — | generate | completed | fixture | — | [generate-2026-08-31T14-33-00-744Z-62b0111a.json](./generate-2026-08-31T14-33-00-744Z-62b0111a.json) | [metadata](./generate-2026-08-31T14-33-00-744Z-62b0111a.meta.json) |
| — | proposed-tools | completed | — | — | [proposed-tools-2026-08-31T14-33-16-450Z-11fe4efa.json](./proposed-tools-2026-08-31T14-33-16-450Z-11fe4efa.json) | [metadata](./proposed-tools-2026-08-31T14-33-16-450Z-11fe4efa.meta.json) |
| — | generate | completed | fixture | — | [generate-2026-08-31T14-33-16-455Z-7bc3e020.json](./generate-2026-08-31T14-33-16-455Z-7bc3e020.json) | [metadata](./generate-2026-08-31T14-33-16-455Z-7bc3e020.meta.json) |
| — | review-decision | completed | — | — | [review-decision-2026-08-31T14-33-16-676Z-dc88b8d8.json](./review-decision-2026-08-31T14-33-16-676Z-dc88b8d8.json) | [metadata](./review-decision-2026-08-31T14-33-16-676Z-dc88b8d8.meta.json) |
| — | review-decision | completed | — | — | [review-decision-2026-08-31T14-33-16-834Z-3e2c358c.json](./review-decision-2026-08-31T14-33-16-834Z-3e2c358c.json) | [metadata](./review-decision-2026-08-31T14-33-16-834Z-3e2c358c.meta.json) |
| — | baseline-eval | completed | — | — | [baseline-eval-2026-08-31T14-37-55-431Z-e8759741-phase5-fixture.json](./baseline-eval-2026-08-31T14-37-55-431Z-e8759741-phase5-fixture.json) | [metadata](./baseline-eval-2026-08-31T14-37-55-431Z-e8759741-phase5-fixture.meta.json) |
| — | test-eval | completed | — | — | [test-eval-2026-08-31T14-37-55-451Z-92d561dd-phase5-fixture.json](./test-eval-2026-08-31T14-37-55-451Z-92d561dd-phase5-fixture.json) | [metadata](./test-eval-2026-08-31T14-37-55-451Z-92d561dd-phase5-fixture.meta.json) |
| — | test-eval | completed | — | — | [test-eval-2026-08-31T14-37-55-454Z-c6d104a5-phase5-fixture.json](./test-eval-2026-08-31T14-37-55-454Z-c6d104a5-phase5-fixture.json) | [metadata](./test-eval-2026-08-31T14-37-55-454Z-c6d104a5-phase5-fixture.meta.json) |
| — | proposed-tools | completed | — | — | [proposed-tools-2026-08-31T14-37-57-181Z-67917178.json](./proposed-tools-2026-08-31T14-37-57-181Z-67917178.json) | [metadata](./proposed-tools-2026-08-31T14-37-57-181Z-67917178.meta.json) |
| — | proposed-tools | completed | — | — | [proposed-tools-2026-08-31T14-37-57-260Z-425adc00.json](./proposed-tools-2026-08-31T14-37-57-260Z-425adc00.json) | [metadata](./proposed-tools-2026-08-31T14-37-57-260Z-425adc00.meta.json) |
| — | baseline-eval | completed | — | — | [baseline-eval-2026-08-31T14-38-52-331Z-5c108a63-phase5-fixture.json](./baseline-eval-2026-08-31T14-38-52-331Z-5c108a63-phase5-fixture.json) | [metadata](./baseline-eval-2026-08-31T14-38-52-331Z-5c108a63-phase5-fixture.meta.json) |
| — | test-eval | completed | — | — | [test-eval-2026-08-31T14-38-52-368Z-5e134e70-phase5-fixture.json](./test-eval-2026-08-31T14-38-52-368Z-5e134e70-phase5-fixture.json) | [metadata](./test-eval-2026-08-31T14-38-52-368Z-5e134e70-phase5-fixture.meta.json) |
| — | test-eval | completed | — | — | [test-eval-2026-08-31T14-38-52-376Z-59db92d4-phase5-fixture.json](./test-eval-2026-08-31T14-38-52-376Z-59db92d4-phase5-fixture.json) | [metadata](./test-eval-2026-08-31T14-38-52-376Z-59db92d4-phase5-fixture.meta.json) |
