# WebMCPify

WebMCPify audits and drafts [WebMCP](https://webmachinelearning.github.io/webmcp/) tool registrations for a website. It keeps generation separate from human approval, runs an isolated browser audit, records raw agent trajectories, and scores behavior independently from the agent's self-report.

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

Run the one-shot self-verifying baseline. It discovers the site's actions, adds or checks WebMCP registrations, and reports its own browser verification. WebMCPify then runs its independent evaluator.

```bash
node dist/cli.js baseline \
  --path ./target-site \
  --url http://localhost:5173 \
  --provider antigravity
```

The raw session is saved to `trajectories/baseline.json`.

### Generate, review, test, repair, and evaluate

Generation is a draft-only step. Choose `auto`, `declarative`, or `imperative`:

```bash
node dist/cli.js generate \
  --path ./target-site \
  --method auto \
  --provider antigravity
```

Review the draft in the local approval page:

```bash
node dist/cli.js review --path ./target-site
```

Open the printed localhost URL and approve only the tools you inspected. The approval is saved to `./target-site/.webmcpify/approved-tools.json`.

Then run the isolated audit and independent score:

```bash
node dist/cli.js test \
  --path ./target-site \
  --url http://localhost:5173 \
  --provider antigravity

node dist/cli.js eval
```

The agent trajectory is saved to `trajectories/test.json`; the independent result is saved to `trajectories/test-eval.json`. The evaluator discovers the live page's generic action surface and checks rendering, controls, forms, links, reload behavior, and WebMCP runtime visibility.

For a plain repair, use the latest independent failures:

```bash
node dist/cli.js repair \
  --path ./target-site \
  --provider antigravity
```

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
pauses at the existing review page, and resumes after approval. Per-run
overrides always win over project configuration:

```bash
node dist/cli.js repair ... --durable
node dist/cli.js repair ... --no-durable
```

The precedence is explicit CLI flag, `WEBMCPIFY_DURABLE`, project config, then
plain repair by default. The plain repair path remains available and does not
require Temporal.

To demonstrate durability, stop the worker while the workflow is waiting on an activity, restart it with `node dist/temporal/worker.js`, and inspect the resumed workflow in the Temporal UI at `http://localhost:8233`. A real resume claim should be recorded in the changelog only after observing the event history.

## Architecture

```text
generate (agent draft)
        ↓
review (human approval)
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

## Evidence and attribution

`trajectories/baseline.json` preserves the first self-verifying agent run. Independent scores are stored separately so an agent cannot make its own claims the evaluation. Cross-provider pass-rate comparisons and the Temporal worker-kill demonstration should be added to [`CHANGELOG.md`](CHANGELOG.md) only after those runs are actually performed.

WebMCPify is an integration project; WebMCP, Chrome DevTools MCP, Temporal, the provider CLIs, and the coffee-store application are existing tools or source projects.
