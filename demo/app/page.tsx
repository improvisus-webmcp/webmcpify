"use client";

import { useEffect, useState } from "react";

type Tool = { name: string; description: string; inputSchema: Record<string, unknown>; execute: (input: Record<string, unknown>) => unknown };
type ModelContext = { registerTool: (tool: Tool, options?: { signal?: AbortSignal }) => Promise<void> };

declare global { interface Document { modelContext?: ModelContext } }

const steps = [
  ["01", "Discover", "Map what is already there", "Routes, forms, APIs, state, auth, and existing WebMCP signals."],
  ["02", "Baseline", "Measure before the change", "A read-only browser baseline records what the app can do today."],
  ["03", "Generate", "Draft grounded tools", "Declarative or imperative registrations in a disposable workspace."],
  ["04", "Review", "Keep the human in control", "Inspect the tools, tasks, and exact diff before approving anything."],
  ["05", "Apply", "Patch with guardrails", "Only the approved patch is applied; Git fingerprints and builds are checked."],
  ["06", "WebMCP test", "Use the live tools", "A source-blind browser agent runs the approved tools against the app."],
  ["07", "Repair", "Improve with permission", "Failed tasks create a new patch that needs a second human approval."],
  ["08", "Evaluate", "Prove the final state", "Independent scoring verifies live state; Temporal can make the final run durable."],
] as const;

export default function Home() {
  const [active, setActive] = useState(0);
  const [native, setNative] = useState(false);
  const [startMode, setStartMode] = useState<"human" | "agent">("human");

  useEffect(() => {
    const context = document.modelContext;
    if (!context) return;
    const controller = new AbortController();
    const register = async () => {
      await context.registerTool({
        name: "explain_webmcpify",
        description: "Explain WebMCPify and its human plus coding-agent workflow.",
        inputSchema: { type: "object", properties: {} },
        execute: () => ({ product: "WebMCPify", purpose: "Make new and existing web apps agent-ready", humanControl: "A human approves the exact source patch before apply." }),
      }, { signal: controller.signal });
      await context.registerTool({
        name: "show_workflow_step",
        description: "Highlight a WebMCPify workflow step on this page: Discover, Baseline, Generate, Review, Apply, WebMCP test, Repair, or Evaluate.",
        inputSchema: { type: "object", properties: { step: { type: "string" } }, required: ["step"] },
        execute: (input) => {
          const index = steps.findIndex((step) => step[1].toLowerCase() === String(input.step).toLowerCase());
          if (index < 0) return { ok: false, available: steps.map((step) => step[1]) };
          setActive(index);
          document.getElementById("workflow")?.scrollIntoView({ behavior: "smooth" });
          return { ok: true, selected: steps[index][1] };
        },
      }, { signal: controller.signal });
      await context.registerTool({
        name: "get_webmcpify_setup",
        description: "Return the commands needed to run WebMCPify.",
        inputSchema: { type: "object", properties: {} },
        execute: () => ({ repository: "git clone <WEBMCPIFY_REPOSITORY> && cd WebMCPify", requirements: ["Node.js 18+", "pnpm", "Git with an initial commit in the target project", "Chrome/Chromium with the WebMCP experimental feature enabled", "Chrome DevTools MCP", "a configured coding-agent provider such as Codex", "Temporal server and worker for final-eval and durable repair"], install: "pnpm install && pnpm build", chromeDevtoolsMcp: "npx -y chrome-devtools-mcp@latest", chrome: "google-chrome --remote-debugging-port=9222 --enable-features=WebMCP --user-data-dir=/tmp/webmcpify-chrome http://localhost:5173", temporal: "terminal 1: temporal server start-dev; terminal 2: pnpm temporal:worker", finalEval: "pnpm webmcpify final-eval --path /path/to/app --url http://localhost:5173 --provider codex", mcp: "npx webmcpify-mcp (run from the target project)"}),
      }, { signal: controller.signal });
      await context.registerTool({
        name: "get_webmcpify_safety_model",
        description: "Explain WebMCPify's human approval, patch, rollback, source isolation, and independent evaluation safeguards.",
        inputSchema: { type: "object", properties: {} },
        execute: () => ({ humanApproval: "Required before initial and repair patches are applied.", sourceIsolation: "Generation and browser agents use disposable or source-blind workspaces.", patchSafety: "Git source fingerprints, patch paths, approval identifiers, and builds are checked.", rollback: "Failed patch application or builds restore affected files.", evaluation: "Task verification is checked independently against live application state.", temporal: "Durable repair and final evaluation use the Temporal workflow when enabled." }),
      }, { signal: controller.signal });
      setNative(true);
    };
    void register().catch(() => undefined);
    return () => controller.abort();
  }, []);

  return (
    <main>
      <nav className="nav wrap"><a className="logo" href="#top"><b>W</b> WebMCPify</a><div className="navlinks"><a href="#workflow">How it works</a><a href="#tools">Tools</a><a href="#start">Start</a></div><a className="source" href="https://github.com/abeebridwan/webmcpify" target="_blank" rel="noreferrer">View source ↗</a></nav>
      <section className="hero wrap" id="top"><div><p className="eyebrow"><i /> WEBMCP-NATIVE · HUMAN-APPROVED</p><h1>Make every app <em>agent-ready.</em></h1><p className="lede">WebMCPify helps people and coding agents turn real application capabilities into reliable tools — without giving up control of the code.</p><div className="actions"><a className="button" href="#workflow">See how it works ↓</a><a href="#tools" className="underlink">Try the tools ↗</a></div><p className="note">⌁ A WebMCP-enabled browser agent can use this page’s tools.</p><div className="built-stamp"><span>✓</span><div><strong>This homepage was made agent-ready with WebMCPify</strong><small>Discover → generate → review → verify</small></div></div></div><div className="preview"><div className="code"><header><span>● ● ●</span><small>discovery.json</small><strong>● LIVE</strong></header><pre>{'{\n  "project": "your-app",\n  "capabilities": ["forms", "state-management", "existing-webmcp"],\n  "next": "human review"\n}'}</pre><footer>✓ 24 capabilities mapped <span>→</span></footer></div><div className="badge">✦ <span><b>WebMCP tools found</b><small>4 ready for an agent</small></span></div></div></section>
      <div className="proof"><div className="wrap"><b>Built for the agent-native web</b><span>DISCOVER REAL CAPABILITIES</span><span>HUMAN APPROVAL REQUIRED</span><span>VERIFY WITH EVIDENCE</span></div></div>
      <section className="section wrap intro"><p className="eyebrow">01 / THE IDEA</p><div className="two-col"><h2>Agents should understand your app <em>before</em> they touch it.</h2><div><p>Most agents see a screen and guess. WebMCPify gives them a grounded path: inspect the app, draft tools from what is really there, and let a person decide what gets applied.</p><p>This homepage is the proof: it was built as a normal Next.js project, then made WebMCP-ready with WebMCPify’s human-approved workflow.</p><p>It works with a brand-new project, an existing site, or a site that already has WebMCP integrations.</p></div></div></section>
      <section className="workflow"><div className="wrap" id="workflow"><p className="eyebrow">02 / THE WORKFLOW</p><div className="workflow-head"><h2>From codebase to <em>capability.</em></h2><span className={native ? "status on" : "status"}>● {native ? "WEBMCP NATIVE · 4 TOOLS REGISTERED" : "WEBMCP TOOLS LOADING"}</span></div><div className="steps">{steps.map((step, index) => <button className={active === index ? "step active" : "step"} key={step[1]} onClick={() => setActive(index)}><b>{step[0]}</b><strong>{step[1]}</strong><span><em>{step[2]}</em><small>{step[3]}</small></span><i>{active === index ? "↗" : "→"}</i></button>)}</div></div></section>
      <section className="safety"><div className="wrap"><p className="eyebrow">03 / SAFETY + EVIDENCE</p><div className="two-col"><h2>Useful for agents.<br /><em>Safe for people.</em></h2><p>WebMCPify treats every source change as a permission boundary. Patches are inspectable, repair needs approval again, and the final result is independently checked.</p></div><div className="safety-grid"><article><b>01</b><h3>Disposable workspaces</h3><p>Generation agents never edit the target checkout directly.</p></article><article><b>02</b><h3>Approved patches</h3><p>Git fingerprints, paths, approval IDs, builds, and rollback protect apply.</p></article><article><b>03</b><h3>Human repair loop</h3><p>A failed task creates a proposed repair; a person must approve it.</p></article><article><b>04</b><h3>Independent proof</h3><p>Browser state and verification expressions—not agent claims—decide success.</p></article></div></div></section>
      <section className="section wrap tools" id="tools"><p className="eyebrow">04 / WEBMCP-NATIVE PAGE</p><div className="two-col"><h2>This page is <em>agent-readable.</em></h2><p>In a WebMCP-enabled browser, an agent can discover and invoke these tools directly from the page. They are registered with the native document.modelContext API, not simulated buttons or a separate backend MCP server.</p></div><div className="agent-callout"><span className={native ? "status on" : "status"}>● {native ? "WEBMCP API DETECTED — AGENTS CAN USE THESE TOOLS" : "ENABLE WEBMCP IN YOUR BROWSER TO EXPOSE THESE TOOLS"}</span><p>Open this deployed page in ChatGPT’s in-app browser or Chrome with WebMCP enabled, then ask the agent to explain WebMCPify or show the Review step.</p></div><div className="tool-grid">{["explain_webmcpify", "show_workflow_step", "get_webmcpify_setup", "get_webmcpify_safety_model"].map((tool, index) => <article key={tool}><span className="tool-icon">{["✦", "⌁", "↗", "✓"][index]}</span><label>WEBMCP TOOL</label><h3>{tool}</h3><p>{["Explain the product and human + agent workflow.", "Highlight any step in the full workflow.", "Return CLI, MCP, browser, and Temporal commands.", "Explain approvals, patches, isolation, rollback, and evidence."][index]}</p><code>document.modelContext.registerTool()</code></article>)}</div></section>
      <section className="cta" id="start"><div className="wrap"><p className="eyebrow">04 / START BUILDING</p><div className="start-heading"><div><h2>Your app has capabilities. <em>Make them available.</em></h2><p>Use the CLI yourself, or let a coding agent work through WebMCPify with your approval.</p></div><div className="start-tabs" role="tablist" aria-label="Ways to start"><button className={startMode === "human" ? "selected" : ""} role="tab" aria-selected={startMode === "human"} onClick={() => setStartMode("human")}>For humans</button><button className={startMode === "agent" ? "selected" : ""} role="tab" aria-selected={startMode === "agent"} onClick={() => setStartMode("agent")}>For agents</button></div></div>{startMode === "human" ? <div className="start-panel"><div className="terminal"><small>$ git clone &lt;WEBMCPIFY_REPOSITORY&gt;</small><small>$ cd WebMCPify &amp;&amp; pnpm install &amp;&amp; pnpm build</small><small>$ git -C /path/to/your-project add -A &amp;&amp; git -C /path/to/your-project commit -m &quot;Initial target snapshot&quot;</small><small>$ pnpm webmcpify final-eval --path /path/to/your-project --url http://localhost:5173 --provider codex</small><footer>✓ final-eval includes discovery · approval · baseline · apply · test · repair · Temporal</footer></div><div className="start-details"><h3>Human-led setup</h3><p>Run WebMCPify from its own checkout and point <b>--path</b> at the target project. The target must be a Git repository with an initial commit. Start the target app before running <b>final-eval</b>; it performs the complete workflow and pauses for human approval.</p><p>Requirements: Node 18+, pnpm, Git, Chrome/Chromium with the WebMCP experimental feature enabled, Chrome DevTools MCP, a configured coding-agent provider such as Codex, and Temporal for final-eval.</p><p>Start the local Temporal service and worker in separate terminals:</p><code>temporal server start-dev · pnpm temporal:worker</code><p>After publishing, the package can also be installed with <b>npm i -g webmcpify</b>; then use <b>webmcpify final-eval ...</b> and <b>npx webmcpify-mcp</b>.</p><p className="fine-print">Human approval is required before the initial patch and any repair patch. The MCP server only accepts repositories inside its starting workspace.</p></div></div> : <div className="start-panel agent-panel"><div className="agent-script"><span>AGENT BRIEF</span><p>“Crawl this page with the available WebMCP tools. Use <b>explain_webmcpify</b> to understand the workflow, <b>show_workflow_step</b> to inspect any stage, and <b>get_webmcpify_setup</b> for every required command.”</p><small>Also call <b>get_webmcpify_safety_model</b> before proposing changes.</small></div><div className="start-details"><h3>Agent-ready workflow</h3><p>In a WebMCP-enabled browser, discover and invoke this page’s native tools directly. They explain WebMCPify, show its workflow, and return the CLI, MCP, browser, provider, and Temporal setup.</p><p>For a user project, connect to the WebMCPify MCP server, inspect the repository, generate grounded WebMCP tools, return the patch identifier, pause for human approval, apply the approved patch, run browser tests, and propose permissioned repairs.</p><div className="agent-flow"><span>analyze</span><i>→</i><span>baseline</span><i>→</i><span>generate</span><i>→</i><span>review</span><i>→</i><span>apply</span><i>→</i><span>test</span><i>→</i><span>repair</span><i>→</i><span>validate</span></div><p className="fine-print">The agent can use the published package with <b>npm i -g webmcpify</b> or the repository MCP server. Temporal is required for durable repair and final evaluation; the human controls source changes.</p></div></div>}</div></section>
      <footer className="footer wrap"><a className="logo" href="#top"><b>W</b> WebMCPify</a><span>Human control for the agent-native web.</span><span>Built for WebMCP.</span></footer>
    </main>
  );
}
