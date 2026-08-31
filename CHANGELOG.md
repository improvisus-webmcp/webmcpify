# Changelog

All notable changes to WebMCPify are documented here.

## [Unreleased]

### Added

- Provider-agnostic baseline execution for Gemini, Claude Code, Codex, and Antigravity CLI (`agy`).
- Raw agent trajectory capture in `trajectories/baseline.json`.
- Independent Playwright/Chrome checks for catalog rendering, roast filtering, cart updates, localStorage persistence, reload persistence, and login state.
- Executable discovery through `PATH`, Codex VS Code extension installs, and optional `.env` overrides.
- `.env.example` for local provider and Chrome path configuration without committing machine-specific settings.
- Optional MCP configuration bridging for providers that support it.
- Generation strategy selection (`declarative`, `imperative`, or `auto`) with
  drafts captured in `trajectories/generate.json`.
- A local review UI that records the human-approved tool manifest before an
  isolated test run.
- Isolated test, repair, and evaluation commands with separate raw agent and
  independently scored evaluation artifacts.
- Baseline and generation prompts now infer the site's actions from its
  codebase instead of assuming a coffee-store domain.
- The independent evaluator now discovers generic page actions and structural
  WebMCP surface checks instead of using coffee-store selectors or state keys.

### Changed

- Baseline no longer requires a pre-existing `.mcp.json`, native WebMCP registration, or WebMCP-enabled source code. A plain site is a valid baseline starting point.
- Missing optional MCP configuration is skipped instead of failing the baseline.
- Baseline trajectories are saved in WebMCPify's tracked `trajectories/` directory regardless of the directory from which the command is launched.
- CLI failures now print a concise error instead of an uncaught stack trace.
- Test runs create a project-local Chrome DevTools MCP configuration only when
  the site does not already provide one; existing `.mcp.json` files are left
  untouched.

### Architectural note

The agent runner is intentionally provider-agnostic so baseline results are reproducible across supported coding agents rather than being tied to Claude Code. The independent evaluator remains separate from the agent session so pass/fail results are based on live site behavior, not the agent's self-report.

Cross-provider pass-rate comparisons are pending additional runs using the same site and task list.

### Iteration: durable repair loop via Temporal

**What I tried and why:** The plain-code repair loop had no resilience: a crash
mid-loop (for example, an agent timeout or browser disconnect) could lose the
workflow's progress and retry count. Temporal now provides an opt-in durable
workflow around the existing scoring, generation, and review activities.

**Evidence:** Pending a live worker-kill test. After that test, record the task,
worker interruption, resumed attempt number, and the Temporal UI event history
here; no resume claim is made until it has been observed.

**Decision at that iteration:** Kept as an opt-in `--durable` path rather than
replacing plain repair. The plain version remained the simpler default for
reproductions that did not run Temporal. This per-run opt-in was later refined
into the project-level setting described below.

### Iteration: made Temporal opt-in via `init --with-temporal`

**What I tried and why:** Initially, durable execution was exposed only as a
per-run `--durable` flag on `repair`. That made the normal reproduction flow
remember a Temporal-specific option and could make someone stand up a Temporal
server even when they only wanted the core baseline/test/eval result.

**Decision:** Added a project-level `.webmcpify/config.json` toggle created by
`init --with-temporal`. It defaults to the plain repair loop, while explicit
`--durable` and `--no-durable` flags remain available for per-run overrides.
`WEBMCPIFY_DURABLE` sits between the CLI flags and project config for scripted
environments.
