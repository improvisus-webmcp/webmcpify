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
   └──► test ──────► test-eval ──► repair ──► patch ──► review ──► apply ──► repair-eval
                                                                          │
                                                                          └──► final-eval (Level 1 → Level 2 → Level 3)
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
| `repair-*.json` | Isolated repair-agent output, including exact failed-task verification evidence and project/run context. | `sourceEvaluation`, `taskSetId` |
| `repair-result-*.json` | Repair patch handoff status, failed tasks, real patch metadata, or an explicit no-change/failure result. | `repairTrajectory`, `patchPath`, `sourceEvaluation` |
| `repair-eval-*.json` | Post-apply evaluation of affected tasks with before/after results and improved, unchanged, or regressed status. | `sourceEvaluation`, `patchPath`, `taskSetId` |
| `final-eval-*.json` | End-to-end Level 1 baseline, Level 2 WebMCP, and Level 3 Temporal comparison using one approved task snapshot. | `targetProject`, `runId`, `taskSetId`, level evaluation paths |
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
| — | test-eval | completed | — | — | [test-eval-2026-08-31T14-55-57-104Z-bb7d8f93-repair-fixture.json](./test-eval-2026-08-31T14-55-57-104Z-bb7d8f93-repair-fixture.json) | [metadata](./test-eval-2026-08-31T14-55-57-104Z-bb7d8f93-repair-fixture.meta.json) |
| — | test-eval | completed | — | — | [test-eval-2026-08-31T14-56-16-367Z-9781ea7f-repair-fixture.json](./test-eval-2026-08-31T14-56-16-367Z-9781ea7f-repair-fixture.json) | [metadata](./test-eval-2026-08-31T14-56-16-367Z-9781ea7f-repair-fixture.meta.json) |
| — | repair | completed | — | — | [repair-2026-08-31T14-56-16-382Z-1a30ad8d-repair-fixture.json](./repair-2026-08-31T14-56-16-382Z-1a30ad8d-repair-fixture.json) | [metadata](./repair-2026-08-31T14-56-16-382Z-1a30ad8d-repair-fixture.meta.json) |
| — | patch | completed | — | — | [patch-2026-08-31T14-56-16-472Z-e28a0d82.json](./patch-2026-08-31T14-56-16-472Z-e28a0d82.json) | [metadata](./patch-2026-08-31T14-56-16-472Z-e28a0d82.meta.json) |
| — | test-eval | completed | — | — | [test-eval-2026-08-31T14-56-59-087Z-4a166e78-repair-fixture.json](./test-eval-2026-08-31T14-56-59-087Z-4a166e78-repair-fixture.json) | [metadata](./test-eval-2026-08-31T14-56-59-087Z-4a166e78-repair-fixture.meta.json) |
| — | repair | completed | — | — | [repair-2026-08-31T14-56-59-101Z-73f89775-repair-fixture.json](./repair-2026-08-31T14-56-59-101Z-73f89775-repair-fixture.json) | [metadata](./repair-2026-08-31T14-56-59-101Z-73f89775-repair-fixture.meta.json) |
| — | patch | completed | — | — | [patch-2026-08-31T14-56-59-202Z-da7ee693.json](./patch-2026-08-31T14-56-59-202Z-da7ee693.json) | [metadata](./patch-2026-08-31T14-56-59-202Z-da7ee693.meta.json) |
| — | test-eval | completed | — | — | [test-eval-2026-08-31T14-57-16-712Z-8335b6f3-repair-fixture.json](./test-eval-2026-08-31T14-57-16-712Z-8335b6f3-repair-fixture.json) | [metadata](./test-eval-2026-08-31T14-57-16-712Z-8335b6f3-repair-fixture.meta.json) |
| — | repair | completed | — | — | [repair-2026-08-31T14-57-16-730Z-25c7d6bb-repair-fixture.json](./repair-2026-08-31T14-57-16-730Z-25c7d6bb-repair-fixture.json) | [metadata](./repair-2026-08-31T14-57-16-730Z-25c7d6bb-repair-fixture.meta.json) |
| — | patch | completed | — | — | [patch-2026-08-31T14-57-16-835Z-9a88e0b2.json](./patch-2026-08-31T14-57-16-835Z-9a88e0b2.json) | [metadata](./patch-2026-08-31T14-57-16-835Z-9a88e0b2.meta.json) |
| — | repair-eval | completed | — | — | [repair-eval-2026-08-31T14-57-34-424Z-99921f79.json](./repair-eval-2026-08-31T14-57-34-424Z-99921f79.json) | [metadata](./repair-eval-2026-08-31T14-57-34-424Z-99921f79.meta.json) |
| — | apply | completed | — | — | [apply-2026-08-31T14-57-34-432Z-1dd9c8e8.json](./apply-2026-08-31T14-57-34-432Z-1dd9c8e8.json) | [metadata](./apply-2026-08-31T14-57-34-432Z-1dd9c8e8.meta.json) |
| — | test-eval | completed | — | — | [test-eval-2026-08-31T14-58-13-360Z-46a225db-repair-fixture.json](./test-eval-2026-08-31T14-58-13-360Z-46a225db-repair-fixture.json) | [metadata](./test-eval-2026-08-31T14-58-13-360Z-46a225db-repair-fixture.meta.json) |
| — | repair | completed | — | — | [repair-2026-08-31T14-58-13-373Z-119bede8-repair-fixture.json](./repair-2026-08-31T14-58-13-373Z-119bede8-repair-fixture.json) | [metadata](./repair-2026-08-31T14-58-13-373Z-119bede8-repair-fixture.meta.json) |
| — | patch | completed | — | — | [patch-2026-08-31T14-58-13-461Z-b17fd037.json](./patch-2026-08-31T14-58-13-461Z-b17fd037.json) | [metadata](./patch-2026-08-31T14-58-13-461Z-b17fd037.meta.json) |
| — | repair-eval | completed | — | — | [repair-eval-2026-08-31T14-58-31-153Z-b2209160.json](./repair-eval-2026-08-31T14-58-31-153Z-b2209160.json) | [metadata](./repair-eval-2026-08-31T14-58-31-153Z-b2209160.meta.json) |
| — | apply | completed | — | — | [apply-2026-08-31T14-58-31-159Z-8dc16748.json](./apply-2026-08-31T14-58-31-159Z-8dc16748.json) | [metadata](./apply-2026-08-31T14-58-31-159Z-8dc16748.meta.json) |
| — | test-eval | completed | — | — | [test-eval-2026-08-31T14-58-44-424Z-356e0768-repair-fixture.json](./test-eval-2026-08-31T14-58-44-424Z-356e0768-repair-fixture.json) | [metadata](./test-eval-2026-08-31T14-58-44-424Z-356e0768-repair-fixture.meta.json) |
| — | repair | completed | — | — | [repair-2026-08-31T14-58-44-438Z-713aecc6-repair-fixture.json](./repair-2026-08-31T14-58-44-438Z-713aecc6-repair-fixture.json) | [metadata](./repair-2026-08-31T14-58-44-438Z-713aecc6-repair-fixture.meta.json) |
| — | patch | completed | — | — | [patch-2026-08-31T14-58-44-538Z-1c9c82ad.json](./patch-2026-08-31T14-58-44-538Z-1c9c82ad.json) | [metadata](./patch-2026-08-31T14-58-44-538Z-1c9c82ad.meta.json) |
| — | repair-eval | completed | — | — | [repair-eval-2026-08-31T14-59-02-102Z-ccbecd08.json](./repair-eval-2026-08-31T14-59-02-102Z-ccbecd08.json) | [metadata](./repair-eval-2026-08-31T14-59-02-102Z-ccbecd08.meta.json) |
| — | apply | completed | — | — | [apply-2026-08-31T14-59-02-126Z-deabf2e1.json](./apply-2026-08-31T14-59-02-126Z-deabf2e1.json) | [metadata](./apply-2026-08-31T14-59-02-126Z-deabf2e1.meta.json) |
| — | test-eval | completed | — | — | [test-eval-2026-08-31T14-59-17-680Z-87535150-repair-fixture.json](./test-eval-2026-08-31T14-59-17-680Z-87535150-repair-fixture.json) | [metadata](./test-eval-2026-08-31T14-59-17-680Z-87535150-repair-fixture.meta.json) |
| — | repair | completed | — | — | [repair-2026-08-31T14-59-17-694Z-a37e5e59-repair-fixture.json](./repair-2026-08-31T14-59-17-694Z-a37e5e59-repair-fixture.json) | [metadata](./repair-2026-08-31T14-59-17-694Z-a37e5e59-repair-fixture.meta.json) |
| — | patch | completed | — | — | [patch-2026-08-31T14-59-17-786Z-312786bd.json](./patch-2026-08-31T14-59-17-786Z-312786bd.json) | [metadata](./patch-2026-08-31T14-59-17-786Z-312786bd.meta.json) |
| — | repair-eval | completed | — | — | [repair-eval-2026-08-31T14-59-21-141Z-f01c6862.json](./repair-eval-2026-08-31T14-59-21-141Z-f01c6862.json) | [metadata](./repair-eval-2026-08-31T14-59-21-141Z-f01c6862.meta.json) |
| — | apply | completed | — | — | [apply-2026-08-31T14-59-21-163Z-2472bf16.json](./apply-2026-08-31T14-59-21-163Z-2472bf16.json) | [metadata](./apply-2026-08-31T14-59-21-163Z-2472bf16.meta.json) |
| — | repair-eval | completed | — | — | [repair-eval-2026-08-31T14-59-21-303Z-bbd63d10-repair-regression-fixture.json](./repair-eval-2026-08-31T14-59-21-303Z-bbd63d10-repair-regression-fixture.json) | [metadata](./repair-eval-2026-08-31T14-59-21-303Z-bbd63d10-repair-regression-fixture.meta.json) |
| — | baseline-eval | completed | — | — | [baseline-eval-2026-08-31T14-59-46-459Z-77d039de-phase5-fixture.json](./baseline-eval-2026-08-31T14-59-46-459Z-77d039de-phase5-fixture.json) | [metadata](./baseline-eval-2026-08-31T14-59-46-459Z-77d039de-phase5-fixture.meta.json) |
| — | test-eval | completed | — | — | [test-eval-2026-08-31T14-59-46-473Z-6e1a21af-phase5-fixture.json](./test-eval-2026-08-31T14-59-46-473Z-6e1a21af-phase5-fixture.json) | [metadata](./test-eval-2026-08-31T14-59-46-473Z-6e1a21af-phase5-fixture.meta.json) |
| — | test-eval | completed | — | — | [test-eval-2026-08-31T14-59-46-475Z-ba8e3aab-phase5-fixture.json](./test-eval-2026-08-31T14-59-46-475Z-ba8e3aab-phase5-fixture.json) | [metadata](./test-eval-2026-08-31T14-59-46-475Z-ba8e3aab-phase5-fixture.meta.json) |
| — | proposed-tools | completed | — | — | [proposed-tools-2026-08-31T14-59-48-057Z-a15fac0c.json](./proposed-tools-2026-08-31T14-59-48-057Z-a15fac0c.json) | [metadata](./proposed-tools-2026-08-31T14-59-48-057Z-a15fac0c.meta.json) |
| — | proposed-tools | completed | — | — | [proposed-tools-2026-08-31T14-59-48-143Z-dac34cf1.json](./proposed-tools-2026-08-31T14-59-48-143Z-dac34cf1.json) | [metadata](./proposed-tools-2026-08-31T14-59-48-143Z-dac34cf1.meta.json) |
| — | proposed-tools | completed | — | — | [proposed-tools-2026-08-31T15-00-02-476Z-410578d3.json](./proposed-tools-2026-08-31T15-00-02-476Z-410578d3.json) | [metadata](./proposed-tools-2026-08-31T15-00-02-476Z-410578d3.meta.json) |
| — | generate | completed | fixture | — | [generate-2026-08-31T15-00-02-480Z-b8a6321a.json](./generate-2026-08-31T15-00-02-480Z-b8a6321a.json) | [metadata](./generate-2026-08-31T15-00-02-480Z-b8a6321a.meta.json) |
| — | review-decision | completed | — | — | [review-decision-2026-08-31T15-00-02-759Z-ecf811c5.json](./review-decision-2026-08-31T15-00-02-759Z-ecf811c5.json) | [metadata](./review-decision-2026-08-31T15-00-02-759Z-ecf811c5.meta.json) |
| — | review-decision | completed | — | — | [review-decision-2026-08-31T15-00-02-960Z-606d3edd.json](./review-decision-2026-08-31T15-00-02-960Z-606d3edd.json) | [metadata](./review-decision-2026-08-31T15-00-02-960Z-606d3edd.meta.json) |
| — | test-eval | completed | — | — | [test-eval-2026-08-31T15-01-03-595Z-bcb5bfa9-repair-fixture.json](./test-eval-2026-08-31T15-01-03-595Z-bcb5bfa9-repair-fixture.json) | [metadata](./test-eval-2026-08-31T15-01-03-595Z-bcb5bfa9-repair-fixture.meta.json) |
| — | repair | completed | — | — | [repair-2026-08-31T15-01-03-611Z-929081b4-repair-fixture.json](./repair-2026-08-31T15-01-03-611Z-929081b4-repair-fixture.json) | [metadata](./repair-2026-08-31T15-01-03-611Z-929081b4-repair-fixture.meta.json) |
| — | patch | completed | — | — | [patch-2026-08-31T15-01-03-733Z-d7635d7e.json](./patch-2026-08-31T15-01-03-733Z-d7635d7e.json) | [metadata](./patch-2026-08-31T15-01-03-733Z-d7635d7e.meta.json) |
| — | repair-eval | completed | — | — | [repair-eval-2026-08-31T15-01-09-386Z-cb73d721.json](./repair-eval-2026-08-31T15-01-09-386Z-cb73d721.json) | [metadata](./repair-eval-2026-08-31T15-01-09-386Z-cb73d721.meta.json) |
| — | apply | completed | — | — | [apply-2026-08-31T15-01-09-409Z-3182bb74.json](./apply-2026-08-31T15-01-09-409Z-3182bb74.json) | [metadata](./apply-2026-08-31T15-01-09-409Z-3182bb74.meta.json) |
| — | repair-eval | completed | — | — | [repair-eval-2026-08-31T15-01-09-459Z-ff520e3c-repair-regression-fixture.json](./repair-eval-2026-08-31T15-01-09-459Z-ff520e3c-repair-regression-fixture.json) | [metadata](./repair-eval-2026-08-31T15-01-09-459Z-ff520e3c-repair-regression-fixture.meta.json) |
| — | patch | completed | — | — | [patch-2026-08-31T15-01-38-275Z-ae6e561d.json](./patch-2026-08-31T15-01-38-275Z-ae6e561d.json) | [metadata](./patch-2026-08-31T15-01-38-275Z-ae6e561d.meta.json) |
| — | apply | completed | — | — | [apply-2026-08-31T15-01-38-450Z-cc016be8.json](./apply-2026-08-31T15-01-38-450Z-cc016be8.json) | [metadata](./apply-2026-08-31T15-01-38-450Z-cc016be8.meta.json) |
| — | patch | completed | — | — | [patch-2026-08-31T15-01-38-848Z-735e6404.json](./patch-2026-08-31T15-01-38-848Z-735e6404.json) | [metadata](./patch-2026-08-31T15-01-38-848Z-735e6404.meta.json) |
| — | patch | completed | — | — | [patch-2026-08-31T15-01-39-655Z-bca8de1c.json](./patch-2026-08-31T15-01-39-655Z-bca8de1c.json) | [metadata](./patch-2026-08-31T15-01-39-655Z-bca8de1c.meta.json) |
| — | apply | completed | — | — | [apply-2026-08-31T15-01-40-395Z-d13abdd9.json](./apply-2026-08-31T15-01-40-395Z-d13abdd9.json) | [metadata](./apply-2026-08-31T15-01-40-395Z-d13abdd9.meta.json) |
| 2026-08-31T15:57:38.588Z | discovery | completed | — | — | [discovery-2026-08-31T15-57-38-589Z-87d3a6ec.json](./discovery-2026-08-31T15-57-38-589Z-87d3a6ec.json) | [metadata](./discovery-2026-08-31T15-57-38-589Z-87d3a6ec.meta.json) |
| 2026-08-31T15:59:29.370Z | generate | completed | antigravity | — | [generate-2026-08-31T15-57-38-596Z-d7265fde.json](./generate-2026-08-31T15-57-38-596Z-d7265fde.json) | [metadata](./generate-2026-08-31T15-57-38-596Z-d7265fde.meta.json) |
| — | proposed-tools | completed | — | — | [proposed-tools-2026-08-31T16-06-37-765Z-65afcebc.json](./proposed-tools-2026-08-31T16-06-37-765Z-65afcebc.json) | [metadata](./proposed-tools-2026-08-31T16-06-37-765Z-65afcebc.meta.json) |
| — | proposed-tools | completed | — | — | [proposed-tools-2026-08-31T16-06-37-880Z-bdc89302.json](./proposed-tools-2026-08-31T16-06-37-880Z-bdc89302.json) | [metadata](./proposed-tools-2026-08-31T16-06-37-880Z-bdc89302.meta.json) |
| — | patch | completed | — | — | [patch-2026-08-31T16-06-40-557Z-ef7abab6.json](./patch-2026-08-31T16-06-40-557Z-ef7abab6.json) | [metadata](./patch-2026-08-31T16-06-40-557Z-ef7abab6.meta.json) |
| — | apply | completed | — | — | [apply-2026-08-31T16-06-40-685Z-5015e5aa.json](./apply-2026-08-31T16-06-40-685Z-5015e5aa.json) | [metadata](./apply-2026-08-31T16-06-40-685Z-5015e5aa.meta.json) |
| — | patch | completed | — | — | [patch-2026-08-31T16-06-41-147Z-a9b753a0.json](./patch-2026-08-31T16-06-41-147Z-a9b753a0.json) | [metadata](./patch-2026-08-31T16-06-41-147Z-a9b753a0.meta.json) |
| — | patch | completed | — | — | [patch-2026-08-31T16-06-41-894Z-117e382b.json](./patch-2026-08-31T16-06-41-894Z-117e382b.json) | [metadata](./patch-2026-08-31T16-06-41-894Z-117e382b.meta.json) |
| — | apply | completed | — | — | [apply-2026-08-31T16-06-42-935Z-55469ade.json](./apply-2026-08-31T16-06-42-935Z-55469ade.json) | [metadata](./apply-2026-08-31T16-06-42-935Z-55469ade.meta.json) |
| — | proposed-tools | completed | — | — | [proposed-tools-2026-08-31T16-06-44-239Z-119e4ca1.json](./proposed-tools-2026-08-31T16-06-44-239Z-119e4ca1.json) | [metadata](./proposed-tools-2026-08-31T16-06-44-239Z-119e4ca1.meta.json) |
| — | generate | completed | fixture | — | [generate-2026-08-31T16-06-44-253Z-a4412d4c.json](./generate-2026-08-31T16-06-44-253Z-a4412d4c.json) | [metadata](./generate-2026-08-31T16-06-44-253Z-a4412d4c.meta.json) |
| — | review-decision | completed | — | — | [review-decision-2026-08-31T16-06-44-668Z-cfebd481.json](./review-decision-2026-08-31T16-06-44-668Z-cfebd481.json) | [metadata](./review-decision-2026-08-31T16-06-44-668Z-cfebd481.meta.json) |
| — | review-decision | completed | — | — | [review-decision-2026-08-31T16-06-44-919Z-60568ec9.json](./review-decision-2026-08-31T16-06-44-919Z-60568ec9.json) | [metadata](./review-decision-2026-08-31T16-06-44-919Z-60568ec9.meta.json) |
| 2026-08-31T16:10:15.800Z | discovery | completed | — | — | [discovery-2026-08-31T16-10-15-800Z-e6efaf47.json](./discovery-2026-08-31T16-10-15-800Z-e6efaf47.json) | [metadata](./discovery-2026-08-31T16-10-15-800Z-e6efaf47.meta.json) |
| 2026-08-31T16:12:02.147Z | generate | completed | antigravity | — | [generate-2026-08-31T16-10-15-807Z-1a40d43b.json](./generate-2026-08-31T16-10-15-807Z-1a40d43b.json) | [metadata](./generate-2026-08-31T16-10-15-807Z-1a40d43b.meta.json) |
| — | proposed-tools | completed | — | — | [proposed-tools-2026-08-31T16-12-02-168Z-86c18ee0.json](./proposed-tools-2026-08-31T16-12-02-168Z-86c18ee0.json) | [metadata](./proposed-tools-2026-08-31T16-12-02-168Z-86c18ee0.meta.json) |
| — | proposed-tools | completed | — | — | [proposed-tools-2026-08-31T16-14-14-407Z-ec911f7d.json](./proposed-tools-2026-08-31T16-14-14-407Z-ec911f7d.json) | [metadata](./proposed-tools-2026-08-31T16-14-14-407Z-ec911f7d.meta.json) |
| — | proposed-tools | completed | — | — | [proposed-tools-2026-08-31T16-14-14-531Z-35b5a774.json](./proposed-tools-2026-08-31T16-14-14-531Z-35b5a774.json) | [metadata](./proposed-tools-2026-08-31T16-14-14-531Z-35b5a774.meta.json) |
| — | patch | completed | — | — | [patch-2026-08-31T16-14-16-289Z-3f0955c3.json](./patch-2026-08-31T16-14-16-289Z-3f0955c3.json) | [metadata](./patch-2026-08-31T16-14-16-289Z-3f0955c3.meta.json) |
| — | apply | completed | — | — | [apply-2026-08-31T16-14-16-412Z-7e27cbd3.json](./apply-2026-08-31T16-14-16-412Z-7e27cbd3.json) | [metadata](./apply-2026-08-31T16-14-16-412Z-7e27cbd3.meta.json) |
| — | patch | completed | — | — | [patch-2026-08-31T16-14-16-595Z-5900a741.json](./patch-2026-08-31T16-14-16-595Z-5900a741.json) | [metadata](./patch-2026-08-31T16-14-16-595Z-5900a741.meta.json) |
| — | patch | completed | — | — | [patch-2026-08-31T16-14-16-828Z-f4bc0491.json](./patch-2026-08-31T16-14-16-828Z-f4bc0491.json) | [metadata](./patch-2026-08-31T16-14-16-828Z-f4bc0491.meta.json) |
| — | apply | completed | — | — | [apply-2026-08-31T16-14-17-313Z-27127350.json](./apply-2026-08-31T16-14-17-313Z-27127350.json) | [metadata](./apply-2026-08-31T16-14-17-313Z-27127350.meta.json) |
| — | proposed-tools | completed | — | — | [proposed-tools-2026-08-31T16-14-17-748Z-a02f8d26.json](./proposed-tools-2026-08-31T16-14-17-748Z-a02f8d26.json) | [metadata](./proposed-tools-2026-08-31T16-14-17-748Z-a02f8d26.meta.json) |
| — | generate | completed | fixture | — | [generate-2026-08-31T16-14-17-752Z-fdedf9a9.json](./generate-2026-08-31T16-14-17-752Z-fdedf9a9.json) | [metadata](./generate-2026-08-31T16-14-17-752Z-fdedf9a9.meta.json) |
| — | review-decision | completed | — | — | [review-decision-2026-08-31T16-14-17-991Z-0a3bc8aa.json](./review-decision-2026-08-31T16-14-17-991Z-0a3bc8aa.json) | [metadata](./review-decision-2026-08-31T16-14-17-991Z-0a3bc8aa.meta.json) |
| — | review-decision | completed | — | — | [review-decision-2026-08-31T16-14-18-137Z-6f05af36.json](./review-decision-2026-08-31T16-14-18-137Z-6f05af36.json) | [metadata](./review-decision-2026-08-31T16-14-18-137Z-6f05af36.meta.json) |
| 2026-08-31T16:16:35.565Z | discovery | completed | — | — | [discovery-2026-08-31T16-16-35-565Z-b355b135.json](./discovery-2026-08-31T16-16-35-565Z-b355b135.json) | [metadata](./discovery-2026-08-31T16-16-35-565Z-b355b135.meta.json) |
| 2026-08-31T16:18:09.213Z | generate | completed | antigravity | — | [generate-2026-08-31T16-16-35-573Z-9b3d6aa5.json](./generate-2026-08-31T16-16-35-573Z-9b3d6aa5.json) | [metadata](./generate-2026-08-31T16-16-35-573Z-9b3d6aa5.meta.json) |
| — | proposed-tools | completed | — | — | [proposed-tools-2026-08-31T16-18-09-243Z-1d5b88f6.json](./proposed-tools-2026-08-31T16-18-09-243Z-1d5b88f6.json) | [metadata](./proposed-tools-2026-08-31T16-18-09-243Z-1d5b88f6.meta.json) |
| — | patch | completed | — | — | [patch-2026-08-31T16-18-09-388Z-91998ffd.json](./patch-2026-08-31T16-18-09-388Z-91998ffd.json) | [metadata](./patch-2026-08-31T16-18-09-388Z-91998ffd.meta.json) |
| — | review-decision | completed | — | — | [review-decision-2026-08-31T16-30-53-616Z-765f71cf.json](./review-decision-2026-08-31T16-30-53-616Z-765f71cf.json) | [metadata](./review-decision-2026-08-31T16-30-53-616Z-765f71cf.meta.json) |
| 2026-08-31T16:34:00.840Z | discovery | completed | — | — | [discovery-2026-08-31T16-34-00-840Z-cff284bb.json](./discovery-2026-08-31T16-34-00-840Z-cff284bb.json) | [metadata](./discovery-2026-08-31T16-34-00-840Z-cff284bb.meta.json) |
| 2026-08-31T16:35:34.217Z | generate | completed | antigravity | — | [generate-2026-08-31T16-34-00-847Z-d99785e3.json](./generate-2026-08-31T16-34-00-847Z-d99785e3.json) | [metadata](./generate-2026-08-31T16-34-00-847Z-d99785e3.meta.json) |
| — | proposed-tools | completed | — | — | [proposed-tools-2026-08-31T16-35-34-248Z-87d5fcc2.json](./proposed-tools-2026-08-31T16-35-34-248Z-87d5fcc2.json) | [metadata](./proposed-tools-2026-08-31T16-35-34-248Z-87d5fcc2.meta.json) |
| — | patch | completed | — | — | [patch-2026-08-31T16-35-34-420Z-62e47433.json](./patch-2026-08-31T16-35-34-420Z-62e47433.json) | [metadata](./patch-2026-08-31T16-35-34-420Z-62e47433.meta.json) |
| — | review-decision | completed | — | — | [review-decision-2026-08-31T16-35-46-323Z-f8cd0205.json](./review-decision-2026-08-31T16-35-46-323Z-f8cd0205.json) | [metadata](./review-decision-2026-08-31T16-35-46-323Z-f8cd0205.meta.json) |
| — | review-decision | completed | — | — | [review-decision-2026-08-31T16-36-13-808Z-2b55ec9e.json](./review-decision-2026-08-31T16-36-13-808Z-2b55ec9e.json) | [metadata](./review-decision-2026-08-31T16-36-13-808Z-2b55ec9e.meta.json) |
| 2026-08-31T16:46:15.777Z | discovery | completed | — | — | [discovery-2026-08-31T16-46-15-777Z-9bf98431.json](./discovery-2026-08-31T16-46-15-777Z-9bf98431.json) | [metadata](./discovery-2026-08-31T16-46-15-777Z-9bf98431.meta.json) |
| 2026-08-31T16:48:21.897Z | generate | completed | antigravity | — | [generate-2026-08-31T16-46-15-783Z-bfd61bc1.json](./generate-2026-08-31T16-46-15-783Z-bfd61bc1.json) | [metadata](./generate-2026-08-31T16-46-15-783Z-bfd61bc1.meta.json) |
| — | proposed-tools | completed | — | — | [proposed-tools-2026-08-31T16-48-21-913Z-b9146ff5.json](./proposed-tools-2026-08-31T16-48-21-913Z-b9146ff5.json) | [metadata](./proposed-tools-2026-08-31T16-48-21-913Z-b9146ff5.meta.json) |
| — | patch | completed | — | — | [patch-2026-08-31T16-48-22-033Z-42a8bc8c.json](./patch-2026-08-31T16-48-22-033Z-42a8bc8c.json) | [metadata](./patch-2026-08-31T16-48-22-033Z-42a8bc8c.meta.json) |
| 2026-08-31T16:50:48.437Z | discovery | completed | — | — | [discovery-2026-08-31T16-50-48-437Z-8deb6feb.json](./discovery-2026-08-31T16-50-48-437Z-8deb6feb.json) | [metadata](./discovery-2026-08-31T16-50-48-437Z-8deb6feb.meta.json) |
| 2026-08-31T16:52:03.838Z | generate | completed | antigravity | — | [generate-2026-08-31T16-50-48-443Z-24f79075.json](./generate-2026-08-31T16-50-48-443Z-24f79075.json) | [metadata](./generate-2026-08-31T16-50-48-443Z-24f79075.meta.json) |
| — | proposed-tools | completed | — | — | [proposed-tools-2026-08-31T16-52-03-849Z-35b1ee91.json](./proposed-tools-2026-08-31T16-52-03-849Z-35b1ee91.json) | [metadata](./proposed-tools-2026-08-31T16-52-03-849Z-35b1ee91.meta.json) |
| 2026-08-31T16:54:04.539Z | discovery | completed | — | — | [discovery-2026-08-31T16-54-04-541Z-1d676f1b.json](./discovery-2026-08-31T16-54-04-541Z-1d676f1b.json) | [metadata](./discovery-2026-08-31T16-54-04-541Z-1d676f1b.meta.json) |
| 2026-08-31T16:55:33.328Z | generate | completed | antigravity | — | [generate-2026-08-31T16-54-04-545Z-ac7633da.json](./generate-2026-08-31T16-54-04-545Z-ac7633da.json) | [metadata](./generate-2026-08-31T16-54-04-545Z-ac7633da.meta.json) |
| — | proposed-tools | completed | — | — | [proposed-tools-2026-08-31T16-55-33-340Z-8b4d8f3c.json](./proposed-tools-2026-08-31T16-55-33-340Z-8b4d8f3c.json) | [metadata](./proposed-tools-2026-08-31T16-55-33-340Z-8b4d8f3c.meta.json) |
| — | patch | completed | — | — | [patch-2026-08-31T16-55-33-451Z-085c1082.json](./patch-2026-08-31T16-55-33-451Z-085c1082.json) | [metadata](./patch-2026-08-31T16-55-33-451Z-085c1082.meta.json) |
| — | review-decision | completed | — | — | [review-decision-2026-08-31T16-56-28-613Z-1b1c26d9.json](./review-decision-2026-08-31T16-56-28-613Z-1b1c26d9.json) | [metadata](./review-decision-2026-08-31T16-56-28-613Z-1b1c26d9.meta.json) |
| 2026-08-31T17:01:44.236Z | baseline | failed | antigravity | — | [baseline-2026-08-31T16-59-48-912Z-c91a627e.json](./baseline-2026-08-31T16-59-48-912Z-c91a627e.json) | [metadata](./baseline-2026-08-31T16-59-48-912Z-c91a627e.meta.json) |
| 2026-08-31T17:20:14.385Z | discovery | completed | — | — | [discovery-2026-08-31T17-20-14-386Z-1fe868e2.json](./discovery-2026-08-31T17-20-14-386Z-1fe868e2.json) | [metadata](./discovery-2026-08-31T17-20-14-386Z-1fe868e2.meta.json) |
| 2026-08-31T17:21:36.402Z | generate | completed | antigravity | — | [generate-2026-08-31T17-20-14-395Z-b969eb38.json](./generate-2026-08-31T17-20-14-395Z-b969eb38.json) | [metadata](./generate-2026-08-31T17-20-14-395Z-b969eb38.meta.json) |
| — | proposed-tools | completed | — | — | [proposed-tools-2026-08-31T17-21-36-412Z-98d622b3.json](./proposed-tools-2026-08-31T17-21-36-412Z-98d622b3.json) | [metadata](./proposed-tools-2026-08-31T17-21-36-412Z-98d622b3.meta.json) |
| — | patch | completed | — | — | [patch-2026-08-31T17-21-36-543Z-a2c2093d.json](./patch-2026-08-31T17-21-36-543Z-a2c2093d.json) | [metadata](./patch-2026-08-31T17-21-36-543Z-a2c2093d.meta.json) |
| — | review-decision | completed | — | — | [review-decision-2026-08-31T17-22-24-134Z-37228a83.json](./review-decision-2026-08-31T17-22-24-134Z-37228a83.json) | [metadata](./review-decision-2026-08-31T17-22-24-134Z-37228a83.meta.json) |
| 2026-08-31T17:33:16.170Z | baseline | completed | antigravity | — | [baseline-2026-08-31T17-23-10-656Z-2ffb30ca.json](./baseline-2026-08-31T17-23-10-656Z-2ffb30ca.json) | [metadata](./baseline-2026-08-31T17-23-10-656Z-2ffb30ca.meta.json) |
| — | baseline-eval | completed | antigravity | — | [baseline-eval-2026-08-31T17-33-16-237Z-ce321393.json](./baseline-eval-2026-08-31T17-33-16-237Z-ce321393.json) | [metadata](./baseline-eval-2026-08-31T17-33-16-237Z-ce321393.meta.json) |
