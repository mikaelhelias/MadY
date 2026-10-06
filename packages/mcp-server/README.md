# @mady/mcp-server

A **headless MCP server** that lets a local coding agent — Claude Code, Codex, Kimi, or any
MCP client — drive MadY. It is **local, keyless, and makes no network calls**: the app's
whole point is offline reproducible science, and so is this.

It holds one in-memory `MadyDocument` per process and mutates it through the *same
validated, undoable agent-command path* the desktop app's in-app agent bridge uses
(`@mady/core` `executeAgentCommand`). There is deliberately **no second mutation path**,
so anything the server can do, the UI could do too — and it can't corrupt state the UI
couldn't.

## What it can do

- **Author**: `new_project`, `create_table`, `create_graph`, `set_graph_kind`,
  `set_graph_options`, `set_axis`, `set_series_style`.
- **Edit the data itself**: `get_table` (the only way to get **row ids**, which `set_cell` needs),
  `set_cell`, `add_row`, `add_column`, `rename_column`, `set_column_type`, `sort_rows`,
  `set_cells_excluded`, and `delete_row` / `delete_column` (confirm-gated — they destroy data).
  Rows and columns are addressed **by id, never by position**, so a sort between reading and
  deleting cannot make you hit the wrong one.
- **Put things on a graph**: `add_annotation` / `update_annotation` / `remove_annotation`
  (labels, reference lines, significance brackets, arrows, bands), `set_significance`,
  `set_fit` / `set_fits`.
- **Restyle**: `apply_style_preset` (by name — MadY default · Scientific Journal · Bold
  infographic · Editorial · Grayscale (print) · Universal design; one call instead of dozens of
  option patches), `set_font`, `set_legend`, `set_grid`, `set_frame`.
- **Assemble a figure**: `list_figures`, `create_figure`, `add_figure_panel`,
  `set_figure_options`.
- **Organise**: `add_folder`, `add_experiment`, `rename_folder`, `rename_experiment`.
  Note: the server cannot rename a datasheet, graph or analysis. (In the app, a graph can be
  renamed from the Navigator; datasheets and analyses cannot be renamed there either.)
- **Load a file**: `import_csv` reads a CSV/TSV/whitespace file from disk using the same parser
  the app uses, so delimiters, header rows, decimal commas, missing-value tokens and date
  columns are handled identically. Note: there is no export — the app's exporter runs through
  Electron's preload, which a headless server cannot reach.
- **Read**: `project_summary`, `list_tables` / `list_graphs` / `list_analyses`,
  `get_graph`, `get_analysis`.
- **Know what is settable**: **`describe_options`** answers *what can I change on this chart?*
  It lists the plot options that **demonstrably change the drawing** on a given kind — measured by
  rendering the figure with and without each one, not by whether a control exists — each with a
  value known to work there. Pass `kind` or `graph_id`; narrow with `group`, `search` or `limit`.
  Pass `option` instead to ask about one: which kinds it works on, or that it was **measured as
  having no effect anywhere** (a different answer from "unknown", which means a typo).
  - The data is `src/optionCatalog.json`, a generated file: the result of rendering every chart
    kind with and without each option. Do not hand-edit it.
  - Note: it knows whether an option reaches the drawing. It does **not** know whether a value is
    sensible, or how two options interact.
- **See what a graph actually draws**: **`describe_graph`** lays the graph out and reports the
  resolved axes (type, domain, ticks), the series and their mark counts, every populated
  drawable layer with a count, the legend rows and what each selects, annotations by kind, and
  **`warnings`** — the drawing code's own account of anything it could not place. `get_graph` returns
  the spec you *asked for*; `describe_graph` returns what the drawing *became*. Use it after a
  change to confirm the change landed. Read-only; the project is untouched.
  - Note: read `drawnTotal`, not `series.length`. Pie, treemap, radar, parallel coordinates,
    lollipop and paired dot plots draw outside the series layer, so a finished chart of those kinds has zero series;
    `drawsOutsideSeriesLayer` flags exactly that case.
  - Note: text widths are estimated headlessly (the app measures in the DOM), so text-dependent
    geometry is close, not exact. Domains, ticks, counts, colours and warnings are unaffected.
- **Analyze**: `run_analysis` configures an analysis; **`compute_analysis`** runs the local
  Python stats engine and returns real numbers (storing the result on the analysis when you
  pass an `analysis_id`). The data sent to the engine is prepared by the same code the app
  uses (`buildAnalysisData`), so the statistics are identical.
- **Natural language**: `run_nl` compiles a plain-language instruction (deterministic,
  offline) into agent commands and runs them — e.g. *"make a scatter of dose vs response,
  then log its x axis"*.
- **Persist**: `save_project` / `open_project` for `.mady` files.
- **Drive the running window** (opt-in): `live_status` and `live_execute` send a command to the
  MadY window the user is actually looking at, so the edit appears in front of them and is one
  undo away — instead of editing this session's headless copy. See below.

## Driving the live window

Off by default. To enable it, start the **Agent edition** with a port. From the checkout
(`apps/desktop`):

```
set MADY_EDITION=agent
set MADY_LIVE_AGENT_PORT=8787
npm run dev
```

An installed Agent edition (built with `npm run dist:agent`) needs only `MADY_LIVE_AGENT_PORT`
in its environment.

The app then listens on `127.0.0.1:8787` and `live_execute` can send it any agent command. The
window runs each one through `window.madyAgent` — the same validated, undoable executor
everything else here uses — so destructive ops still need `confirm=true` and every edit is one
undo away. **No new powers, only a different document.**

### What keeps it shut

1. **Off unless asked for.** No `MADY_LIVE_AGENT_PORT`, no server. A malformed value means off —
   there is deliberately no fallback port.
2. **Loopback only** (`127.0.0.1`), so it is not reachable from the network.
3. **Not drivable by a web page.** Loopback alone is not enough — any site the user visits can
   POST to `127.0.0.1` from their browser. Requests must carry `X-MadY-Agent: 1` (a header a
   cross-origin page cannot set without a preflight, which the server never answers), and any
   request carrying an `Origin` header is refused outright.

**Why not Chromium's `--remote-debugging-port`?** It is less code, but it
grants far too much: a debug port lets any local process
evaluate arbitrary JavaScript in the app — read the whole project, reach the file-writing preload
bridge, disable anything. This endpoint accepts one shape of message and hands it to the same
validated executor.

Note: **the standard edition has no bridge.** `window.madyAgent` exists only in the Agent build, so a
command sent to a standard window is refused with a message saying so.

Destructive tools (`delete_*`) require `confirm: true`, checked before any lookup, so
an unconfirmed delete touches nothing.

The mutation/query tools are **generated one-per-command** from the closed `AgentCommand`
union, so the tool surface can never drift from the typed API (enforced by a test).

## Build

```
npm run typecheck   # builds every package's dist, including this one
```

The binary is the bundle `packages/mcp-server/dist/mady-mcp.mjs` (the `mady-mcp` bin) — `npm run bundle` in this package (or `npm run build`) writes it; `dist/bin.js` is the bare tsc output and needs core's dist beside it, which the repo does not keep.

## Connect from any MCP client

The server speaks MCP over **stdio** — the transport every client supports — so the connection
is always the same one line, whatever the client:

```
node <MadY folder>/packages/mcp-server/dist/mady-mcp.mjs
```

with, optionally, `MADY_ENGINE_EXE=<MadY folder>/engines/py/dist/mady-engine/mady-engine.exe`
in its environment so the statistics run. Nothing here is specific to one vendor: no key, no
network, no account. Where each client keeps that line:

| Client | Where | Shape |
|---|---|---|
| Claude Code | `.mcp.json` at the repo root (ships with the repo) or `claude mcp add mady -- node …` | `{ "mcpServers": { "mady": { "command", "args", "env" } } }` |
| Claude Desktop | `%APPDATA%\Claude\claude_desktop_config.json` | same `mcpServers` shape, absolute paths |
| Cursor | `.cursor/mcp.json` at the repo root (ships with the repo) or `~/.cursor/mcp.json` | same `mcpServers` shape; `${workspaceFolder}` allowed |
| VS Code (Copilot agent mode) | `.vscode/mcp.json` at the repo root (ships with the repo) | `{ "servers": { "mady": { "type": "stdio", "command", "args", "env" } } }` |
| Codex CLI | `~/.codex/config.toml` | `[mcp_servers.mady]` `command = "node"` `args = ["…/mady-mcp.mjs"]` and `[mcp_servers.mady.env]` |
| Windsurf | `~/.codeium/windsurf/mcp_config.json` | same `mcpServers` shape |
| Continue | `config.yaml` → `mcpServers:` list entry `name: mady`, `command: node`, `args: [...]` | YAML |
| Anything else | its MCP settings, "stdio" transport | the command line above |

Three of these registrations ship in the repo (`.mcp.json`, `.cursor/mcp.json`,
`.vscode/mcp.json`), so opening the checkout in Claude Code, Cursor or VS Code offers the
`mady` server without any setup. The user-level ones are a copy of the same block.

Note: the bundle is a build artefact: after a change to `@mady/core` run `npm run bundle` here
(or `npm run build`), or every client talks to stale tools.

## Use from Claude Code

The repo carries this registration at its root (`.mcp.json`), so a Claude Code session opened in the checkout is offered the `mady` server on start. Elsewhere, add to your MCP config (`.mcp.json`, or `claude mcp add`):

```json
{
  "mcpServers": {
    "mady": {
      "command": "node",
      "args": ["<MadY folder>/packages/mcp-server/dist/mady-mcp.mjs"],
      "env": { "MADY_ENGINE_EXE": "<MadY folder>/engines/py/dist/mady-engine/mady-engine.exe" }
    }
  }
}
```

## The stats engine

`compute_analysis` spawns the local engine, resolved (in order):

- `MADY_ENGINE_EXE` — a PyInstaller-frozen engine binary (run with no script arg), or
- `MADY_ENGINE_CMD` (default `py` on Windows, else `python3`) + `MADY_ENGINE_SCRIPT`
  (default: `engines/py/engine.py` found by walking up to the repo).

The dev engine needs a Python with numpy/scipy, exactly like the desktop app in development.

## Scope

By default this is the **file/headless mode** — it authors and analyzes projects and
reads/writes `.mady` files in its own session. Driving an already-open desktop window is the
opt-in live mode described above (`live_status` / `live_execute`), which runs every command
through the same validated executor. It does **not** export PNG or SVG images (that needs the
desktop app's window).
