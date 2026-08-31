export const DISCOVERY_GUIDANCE = `
DISCOVERY PHASE — complete this before drafting or changing any WebMCP tools.
Do not read the entire codebase file by file. Use these signals to narrow down
where the real interactive surface is.

1. Identify the stack cheaply. Read package.json, requirements.txt, go.mod,
Cargo.toml, or pom.xml to determine the language, framework, and versions.
Read the README for the stated purpose, feature list, and getting-started
sections. Use this to choose the idiomatic registration pattern and likely
source directories.

2. Map the site structure. If present, read sitemap.xml for the real page list
and robots.txt for paths explicitly disallowed to automated agents. If there
is no sitemap, locate the framework's routing definition (such as React
Router, Next.js app or pages, Vue Router, or its equivalent).
Never propose a tool for a path that robots.txt explicitly disallows.

3. Find where actions actually happen. Search for interactive elements such as
forms, buttons, inputs, selects, textareas, and framework event handlers. Find
API or server-route directories, REST endpoints, tRPC routers, GraphQL
resolvers, or equivalent handlers. Identify the state source used by each
candidate action, including hooks, context, Redux, Zustand, Pinia, Vue refs,
or other stores. A tool must touch the same state as the UI, not a copy.

4. Cross-reference before drafting. For each candidate action, connect it to
a real route and a real handler/state source. Treat actions that cannot be
traced to both as lower priority or skip them rather than guessing. Record
preconditions such as authentication, a non-empty cart, or feature flags;
these should drive conditional or dynamic registration rather than a static
tool.

5. Only after this discovery, choose declarative versus imperative per action
and start drafting.

Report the discovery findings before the diff: the detected stack, routes or
pages, candidate actions, the real handler and state location for each, and
which actions are proposed or deliberately skipped with the reason.
`.trim();

export const TOOL_PLACEMENT_GUIDANCE = `
When placing or drafting generated WebMCP code, follow the site's existing
file organization and runtime conventions.

- For imperative tools, use the codebase's existing WebMCP or integration
  directory when one exists or is implied by the project structure. If you
  create a new file, import it and invoke or register it from a location that
  actually runs on app load (or on the relevant route's load). A standalone
  file containing unregistered tools is a failure.
- For declarative tools, edit the existing component that renders the
  relevant form or input in place. Do not create a separate file for a
  declarative tool; its value is being co-located with the markup it annotates.
- For every tool, state explicitly which existing file was edited or which
  new file was created, why that location fits, and where the tool is wired in
  or registered at runtime.
`.trim();

export const TASK_AUTHORING_PROMPT = `
Based on the actions and tools you identified during discovery, propose 5-6
realistic tasks a user might ask an AI agent to complete on this site using
the available tools.

For each task, write a "verify" expression: a single JavaScript snippet that,
when evaluated in the live page after the task is attempted, returns true only
if the task's real-world effect actually happened. Base this on real,
observable state — persisted storage, DOM content, or the site's own state
management — not on trusting the agent's own claim of success.

Include at least one task that checks tool availability itself, such as
confirming a conditionally registered tool is or is not present through
navigator.modelContext.tools. Do not include tasks whose effect cannot be
verified this way.

Output the task proposal as JSON:
[{ "id": "...", "description": "...", "verify": "..." }]
`.trim();
