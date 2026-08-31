# WebMCPify

WebMCPify audits and drafts [WebMCP](https://webmachinelearning.github.io/webmcp/) tool registrations for a website. It discovers the target site's actual stack, routes, interactive surface, handlers, and state before proposing tools. Generation stays separate from human approval, testing uses an isolated browser agent, raw trajectories are recorded, and behavior is scored independently from the agent's self-report.

The reference experiment used the real, unmodified [`jillesme/webmcp-coffee-store`](https://github.com/jillesme/webmcp-coffee-store) application. The product itself is domain-agnostic: baseline, generation, testing, review, and repair inspect the target site's actions rather than assuming a particular kind of application.

## Dependencies

Required:

- Node.js 18 or newer for the normal pipeline; Node.js 20.3 or newer for the Temporal durable path
- pnpm
- A supported coding-agent CLI: Gemini, Claude Code, Codex, or Antigravity (`agy`)
- Chrome or Chromium for the independent evaluator

Optional, only for durable repair runs:

- Temporal CLI 1.8.1, used to run the local Temporal development server
- Temporal TypeScript SDK 1.21.1: `@temporalio/client`, `@temporalio/worker`, and `@temporalio/workflow`

Temporal is used specifically to make the repair loop durable. It does not orchestrate the normal generation, review, testing, or evaluation pipeline.

## Setup

```bash
pnpm install
pnpm build
```

Provider and executable overrides can be placed in `.env`; use [`.env.example`](.env.example) as the template. The CLI also accepts `--provider gemini|claude|codex|antigravity`.

Core results (`baseline`, `test`, `eval`, and plain `repair`) require no
Temporal setup. Temporal is optional and can be enabled per project with
`init --with-temporal`; the setting is stored in the target site's
`.webmcpify/config.json`.

## Reproduction guide

Start the target site separately and note its URL. For WebMCP discovery, Chrome must be started with WebMCP enabled and remote debugging available. For example:

```bash
google-chrome \
  --remote-debugging-port=9222 \
  --enable-features=WebMCP \
  --user-data-dir=/tmp/webmcpify-chrome \
  http://localhost:5173
```

The DevTools MCP configuration uses `--category-experimental-webmcp` and `--autoConnect`. If the target does not have `.mcp.json`, `test` and `repair` create `.webmcpify/chrome-devtools-mcp.json` without replacing an existing configuration.

### Baseline

Run the one-shot self-verifying baseline. It performs focused discovery, adds or checks WebMCP registrations, and reports its own browser verification. WebMCPify then runs its independent evaluator. The baseline intentionally has source-editing access and is the comparison point for the isolated workflow.

```bash
node dist/cli.js baseline \
  --path ./target-site \
  --url http://localhost:5173 \
  --provider antigravity
```

The raw session is saved to a timestamped `trajectories/baseline-*.json` file,
with a matching `.meta.json` sidecar and a structured
`baseline-eval-*.json` artifact. The original `baseline.json` remains as the
historical reference run.

### Generate, review, test, repair, and evaluate

Generation is a draft-only, read-only step. Choose `auto`, `declarative`, or
`imperative`:

```bash
node dist/cli.js generate \
  --path ./target-site \
  --method auto \
  --provider antigravity
```

Before drafting, the agent performs focused discovery rather than reading the
whole repository file by file. It identifies:

- the language, framework, versions, and stated purpose from project metadata
  and the README;
- sitemap/robots information and the real route or page structure;
- interactive elements, event handlers, API/server handlers, and the state
  sources those actions actually use; and
- preconditions such as authentication, feature flags, or a non-empty cart.

It reports these findings before the proposed diff. The placement guidance
keeps imperative registrations in the existing integration structure and
requires them to be imported and wired into an app-load or route-load path.
Declarative registrations are placed directly in the existing component that
renders the relevant form or input. Each tool must identify its edited or
created file, why that location fits, and where it is wired at runtime.

Generation does not edit the target site or verify the result. The raw draft
trajectory is saved to a timestamped `trajectories/generate-*.json` file with a
metadata sidecar; review selects the latest generation trajectory. Review
currently displays that draft and records the approval decision rather than
applying source changes automatically.

Review the draft in the local approval page:

```bash
node dist/cli.js review --path ./target-site
```

Open the printed localhost URL and approve only the tools you inspected. The
approval is saved to `./target-site/.webmcpify/approved-tools.json`. The
current review step records the approved tool names and does not automatically
apply the generated source diff.

Then run the isolated audit and independent score:

```bash
node dist/cli.js test \
  --path ./target-site \
  --url http://localhost:5173 \
  --provider antigravity

node dist/cli.js eval
```

The isolated agent has MCP browser access only; it cannot read or edit the
site's source files. Its trajectory is saved to a timestamped
`trajectories/test-*.json` file; the independent result is saved to a linked
`trajectories/test-eval-*.json` artifact. The evaluator
currently runs seven generic structural checks covering rendering, action
discoverability, controls, forms, links, reload behavior, and WebMCP runtime
visibility. These checks are intentionally domain-agnostic and do not yet
replace site-specific end-state assertions for every tool.

For a plain repair, use the latest independent failures:

```bash
node dist/cli.js repair \
  --path ./target-site \
  --provider antigravity
```

The plain repair path gives the agent source-editing and browser access for a
focused repair pass. Its raw output and failure context are saved to a
timestamped `trajectories/repair-*.json` file. Run `test` again for an
independent score.

## Optional durable repair with Temporal

Choose the repair mode for the project. The first command is the safe default;
the second opts this project into durable repair:

```bash
node dist/cli.js init --path ./target-site
node dist/cli.js init --path ./target-site --with-temporal
```

Install the Temporal CLI and start its local development server:

```bash
temporal --version   # expected: 1.8.1
temporal server start-dev
```

In a second terminal, run the compiled worker:

```bash
node dist/temporal/worker.js
```

In a third terminal, start a durable repair workflow. With the project setting
enabled, `repair` uses Temporal without needing the flag every time. The task
must match one of the evaluator's task names, such as `page survives a reload`:

```bash
node dist/cli.js repair \
  --path ./target-site \
  --url http://localhost:5173 \
  --task "page survives a reload" \
  --provider antigravity
```

The workflow runs the existing independent scorer, drafts a focused repair,
pauses at the existing review page, and persists its retry state. Per-run
overrides always win over project configuration:

```bash
node dist/cli.js repair ... --durable
node dist/cli.js repair ... --no-durable
```

The precedence is explicit CLI flag, `WEBMCPIFY_DURABLE`, project config, then
plain repair by default. The plain repair path remains available and does not
require Temporal.

The current durable path reuses the draft generator and approval manifest; it
does not yet automatically apply an approved source diff. That application
step remains a separate implementation boundary, so inspect and apply the
approved change before expecting the next test to observe a code repair.

To demonstrate durability, stop the worker while the workflow is waiting on an activity, restart it with `node dist/temporal/worker.js`, and inspect the resumed workflow in the Temporal UI at `http://localhost:8233`. A real resume claim should be recorded in the changelog only after observing the event history.

## Architecture

```text
discover (stack, routes, actions, handlers, state)
        ↓
generate (read-only agent draft)
        ↓
review (human approval manifest)
        ↓
test (isolated agent + independent browser score)
        ↓
repair (plain by default, Temporal by config or --durable)
        ↺
```

The Temporal files are intentionally thin wrappers around existing commands and scoring logic:

- `src/temporal/activities.ts` delegates to generation, review, and `scoreTasks`.
- `src/temporal/workflows.ts` owns the retry/repair loop and human gate.
- `src/temporal/worker.ts` registers the activities and workflow on task queue `webmcpify`.

## Trajectories and evidence

Every agent run preserves the provider's raw JSON output instead of replacing
the previous run. The matching metadata sidecar records the exact prompt,
provider, target path or URL, allowed tools, MCP configuration, timing, status,
and relevant feedback. Structured artifacts record independent scores, human
review decisions, and Temporal attempt/workflow checkpoints.

See [`trajectories/README.md`](trajectories/README.md) for the artifact types
and the automatically maintained run index. This makes it possible to follow
the evidence from discovery and agent actions through review, scoring,
feedback, retries, and repair without relying only on a final summary.

## Current feature boundaries

The core pipeline is implemented, but these boundaries are important when
interpreting the results:

- `generate` is read-only and saves the agent's draft trajectory; it does not
  write a pending patch or modify the target site.
- `review` records approved tool names for the isolated test and does not yet
  apply approved source changes.
- `test` is source-blind and MCP-only, but the independent scorer currently
  checks generic page structure rather than every domain-specific tool outcome.
- `eval` reports the saved independent score; it does not yet check rejected
  tool reachability or compare a full task catalog.
- Temporal is durable only for the repair orchestration. It retries activities
  and preserves workflow state, but the source-diff application boundary still
  needs to be completed for fully automatic durable repair.

## Evidence and attribution

`trajectories/baseline.json` preserves the first self-verifying agent run, and
new runs use the timestamped format described above. Independent scores are
stored separately so an agent cannot make its own claims the evaluation.
Cross-provider pass-rate comparisons and the Temporal worker-kill demonstration
should be added to [`CHANGELOG.md`](CHANGELOG.md) only after those runs are
actually performed.

WebMCPify is an integration project; WebMCP, Chrome DevTools MCP, Temporal, the provider CLIs, and the coffee-store application are existing tools or source projects.
