# Codebase Diorama

Step inside your codebase. Your project becomes a little city on your desk in
VR: every part of the code is a building, and you can walk into any of them.
Inside, robot workers run that part of the code. Packets of data travel from
room to room along the code's real flows. You can point at any robot and ask
it a question, out loud or with a pinch, and it answers about your actual
code.

Built with [Meta IWSDK](https://iwsdk.dev) (WebXR). Everything works with bare
hands on a Meta Quest: point and pinch, or poke the panels with a fingertip.

## Map your codebase with your coding agent

The mapping is done by an Agent Skill: a folder of instructions that coding
agents load when asked. It reads the repo without running it and names its
parts in plain English. It describes every file, traces the main flows and
notes real issues. Then it clones this viewer to `~/codebase-diorama`, builds
the map and starts the viewer. One skill, packaged for each agent:

| Agent | Install | Then ask |
| --- | --- | --- |
| Claude Code | `claude plugin marketplace add calebluh/codebase-diorama` then `claude plugin install codebase-diorama@codebase-diorama` | `/codebase-diorama:map` |
| Codex and the ChatGPT desktop app | `codex plugin marketplace add calebluh/codebase-diorama`, then install **codebase-diorama** from the plugins list | "Map this repo into a Codebase Diorama" |
| Cursor | `npx skills add calebluh/codebase-diorama --skill codebase-diorama -a cursor` | "Map this repo into a Codebase Diorama" |
| Gemini CLI | `gemini extensions install https://github.com/calebluh/codebase-diorama` | "Map this repo into a Codebase Diorama" |
| Antigravity | `npx skills add calebluh/codebase-diorama --skill codebase-diorama -a antigravity` | "Map this repo into a Codebase Diorama" |
| GitHub Copilot, OpenCode, Windsurf and others | `npx skills add calebluh/codebase-diorama --skill codebase-diorama` (it finds the agents you have) | "Map this repo into a Codebase Diorama" |
| Anything else that can run a shell | nothing | "Read https://raw.githubusercontent.com/calebluh/codebase-diorama/main/skills/codebase-diorama/SKILL.md and follow it for this repository." |

Add `-g` to an `npx skills add` line to install for every project instead of
the current one. The agent has to run on your own computer: it uses git and
Node there, and the headset reaches the viewer over your Wi-Fi.

The skill is written once, in
[`plugins/codebase-diorama/skills/map`](plugins/codebase-diorama/skills/map),
and copied to [`skills/codebase-diorama`](skills/codebase-diorama) for agents
that install bare skills (`node scripts/sync-skills.mjs`).

## MCP server: the same tools in any agent

The plugin also ships an MCP (Model Context Protocol) server,
[`plugins/codebase-diorama/mcp/server.mjs`](plugins/codebase-diorama/mcp/server.mjs).
It is one file with no dependencies, needing only Node 20+. It gives any
agent that speaks MCP these tools:

| Tool | What it does |
| --- | --- |
| `diorama_instructions` | The mapping skill and map format, for agents that do not load skills |
| `diorama_setup` | Clones this viewer to `~/codebase-diorama` and installs it |
| `diorama_build_map` | Builds and checks a map once the agent has written it |
| `diorama_use_brain` | Robots answer through your Claude plan, or Meta's Model API |
| `diorama_start` / `diorama_stop` | Runs the viewer and returns the link for your Quest |
| `diorama_status` | Maps, open notes, who answers, and whether the viewer is running |
| `diorama_notes` / `diorama_tick_note` | The notes you made in VR, and ticking them off as they are done |

It also has two prompts, `map_repo` and `work_through_notes`.

The Claude Code plugin and the Gemini CLI extension start it for you.
Elsewhere, clone this repo (or let the skill do it), then register the
server. Use the full path to the folder in place of `~` if your agent does
not expand it.

| Agent | Register |
| --- | --- |
| Claude Code (without the plugin) | `claude mcp add codebase-diorama -- node ~/codebase-diorama/plugins/codebase-diorama/mcp/server.mjs` |
| Codex | `codex mcp add codebase-diorama -- node ~/codebase-diorama/plugins/codebase-diorama/mcp/server.mjs` |
| Cursor, Windsurf, Claude Desktop and most others | add `"codebase-diorama": { "command": "node", "args": ["<home>/codebase-diorama/plugins/codebase-diorama/mcp/server.mjs"] }` under `mcpServers` in the app's MCP settings |
| VS Code (Copilot) | the same entry under `servers` in `.vscode/mcp.json` |

Mapping a repo needs an agent that can read files and run a shell on your
computer. A chat app without those, such as Claude Desktop, can still start
the viewer and read and tick your notes.

## Who answers for the robots

Pick one. Settings go in `.env` in the viewer folder; keys go in
`.env.local`. Add keys yourself: the file stays on your machine and the
browser never sees them.

```sh
# .env: your Claude plan, no key. Needs Claude Code installed and signed in on this computer.
ROBOT_BRAIN=claude
ROBOT_BRAIN_MODEL=haiku    # optional

# .env.local: Meta Model API (dev.meta.ai), which also does speech recognition in the headset
MODEL_API_KEY=LLM_...
OPENAI_API_KEY=sk-...      # optional: natural robot voices; without it the browser's voice is used

# .env: any OpenAI-compatible chat endpoint instead, e.g. a local Ollama (not yet tested with one)
CHAT_API_BASE=http://localhost:11434/v1
CHAT_MODEL=llama3.2
# (CHAT_API_KEY=... in .env.local if the endpoint needs one)
```

With `ROBOT_BRAIN=claude`, the viewer keeps a Claude Code process started in
the background and hands each question to it. Each process answers one
question and then exits. Over 18 test questions the median answer took 2.0
seconds. Claude runs with no tools, no MCP servers and none of your settings,
because visitor speech reaches it.

Speech recognition still needs the Meta key. Without it, you pinch the
suggested questions instead of speaking. With no model at all, the robots
still talk, using canned answers built from the map. All of this is for the
viewer on your own computer. The hosted demo uses Meta's Model API only.

## Running it

```sh
npm install
npm run dev
```

The dev server prints a network URL. Open it in the Quest browser on the same
Wi-Fi, accept the local certificate warning, and press Enter VR. On a desktop,
the managed browser runs a headset emulator.

Your maps are written to `src/maps/custom/<id>.json`, which git ignores. Open
one at `/?map=<id>`, or use Next map on the desk to switch between them. Until
you make one, a small sample shop called Larder is shown.

## How it is built

- `src/diorama.ts`: the tabletop city, its connections, flows and panels.
  `src/city-style.ts` gives it its look and `src/peek.ts` lifts a building's
  roof to show the robots inside.
- `src/workspace.ts`: where the desk goes. In mixed reality it finds a real
  table in the room (WebXR plane detection) and stands the city on it.
- `src/rooms/`: the walk-in rooms, their themes, props and robot workers.
- `src/agent/` and `server/`: the robots' conversations. Prompts are built on
  the server from the map, so the page never sees an API key.
- `src/guide-system.ts`, `src/atmosphere.ts`, `src/transition.ts`: the guided
  first visit, the surroundings and the dive into a building.
- `scripts/build-map.mjs`: turns a repo plus a hand-written map into a map
  file (Floorplan's `floorplan/graph@1` format).

## Credits

- Map format: [Floorplan](https://github.com/haydenschmitty/floorplan) (MIT).
- Robot: "RobotExpressive" by Tomás Laulhé (Quaternius), CC0, via the
  three.js examples.
- Props: [Poly Haven](https://polyhaven.com), CC0. See
  `public/models/props/CREDITS.md`.

## License

Copyright (C) 2026 Caleb Luh.

Codebase Diorama is free software under the
[GNU Affero General Public License v3.0](LICENSE) or any later version. You
can use, change and share it. If you share a changed version, or run one as a
service other people use over a network, you must make your changed source
available under the same license.

The license covers this viewer and plugin, not the code you map with them.
The plugin only reads your repository, and the maps it writes are kept in the
viewer folder.

Contributions are welcome: open an issue or a pull request.
