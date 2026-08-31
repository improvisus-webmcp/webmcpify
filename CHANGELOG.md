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

### Iteration: added Temporal for durable execution — motivated by large-codebase failures

**What I tried and why:** The initial repair loop was plain async code with a
manual retry counter. Testing against a small site (`webmcp-coffee-store`)
worked fine, but running the same pipeline against a larger, real-world
codebase (`vercel/commerce`) exposed the actual problem: the underlying agent
session timed out or errored partway through exploring a much bigger codebase.
A plain retry restarted the entire attempt from scratch, losing the progress it
had made and re-burning tokens re-reading files it had already seen.

**Evidence:** On `vercel/commerce`, the plain (`--no-durable`) `generate` call
failed after approximately 300 seconds with `Command timed out after 300000ms`,
having already consumed over 800K input tokens re-scanning the codebase. The
retry started over from zero rather than resuming. Under `--durable`, the same
failure was caught as a Temporal `ActivityTaskFailed` event, automatically
retried according to `maximumAttempts: 3`, and the workflow state (which task
and which attempt) persisted across the failure. This was confirmed through the
Temporal Web UI event history.

**Decision:** Kept Temporal opt-in through `init --with-temporal`. The gain is
not in the model's reasoning; it is reliability. Durable execution matters
specifically once codebase size pushes a single agent session close to its
time/context limits, which is a realistic failure mode for any site larger than
a small demo app. The plain version remains available for simpler runs and
reproductions without Temporal.

### Iteration: added placement and wiring guidance for generated tools

**What I tried and why:** Generated WebMCP code can look correct while still
being ineffective when an imperative registration is left in an unimported
file or a declarative registration is separated from the markup it annotates.
The generation, baseline, and repair prompts now require imperative tools to
follow the site's existing organization and run on an app-load or route-load
path, while declarative tools must be edited into the existing form or input
component.

**Evidence:** Each tool is now required to report its edited or created file,
the reason for that location, and where its registration is wired at runtime.
The generated diff also uses explicit file paths so the human review step can
inspect the placement before approval.

**Decision:** Kept the guidance as a shared prompt block used by every
code-writing path, avoiding separate placement rules that could drift between
generation, baseline, and repair.

### Iteration: added focused discovery before tool drafting

**What I tried and why:** Choosing tools by scanning arbitrary components can
miss the site's real handlers and state while wasting tokens reading an entire
repository file by file. On larger codebases, that unnecessary exploration
also consumes the context window, increases runtime and repeated prompting,
and leaves less context available for understanding the actual interactive
surface. The prompts now require a focused discovery pass over the stack,
README, sitemap/robots, routes, interactive elements, server handlers, and
state sources before any tool is drafted.

**Evidence:** The agent must report the detected stack, routes/pages, candidate
actions, each action's real handler and state location, preconditions, and any
actions deliberately skipped before presenting the diff. This keeps schemas
and registrations grounded in the site's actual implementation.

**Decision:** Kept discovery as a shared prompt block for generation, baseline,
and repair. It narrows exploration while preserving domain-agnostic behavior.

### Iteration: preserved complete trajectories and run checkpoints

**What I tried and why:** The repository previously kept one static baseline
trajectory, while later generation, test, repair, review, and Temporal runs
could overwrite or leave no judge-friendly record of the instructions,
permissions, feedback, retries, or human decisions that shaped the result.

**Evidence:** Every agent run now writes a timestamped raw JSON trajectory and
a matching metadata sidecar containing its prompt, provider, target, allowed
tools, timing, status, and related context. Structured artifacts record
independent evaluations, review decisions, and Temporal checkpoints, while
`trajectories/README.md` maintains an index. The trajectory capture layer
compiled successfully with `pnpm build`; no new provider run was needed for
this storage change.

**Decision:** Kept the original `baseline.json` as historical evidence and
moved all future runs to non-overwriting, timestamped artifacts so the full
workflow can be followed from discovery through final result.

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
