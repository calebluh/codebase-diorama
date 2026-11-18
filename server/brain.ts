import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';

/**
 * Lets the robots answer through a coding agent's command line the user is
 * already signed in to, instead of a model API key. Development server only:
 * the Vercel functions never set ROBOT_BRAIN.
 *
 *   ROBOT_BRAIN=claude          # Claude Code (`claude`), on the user's Claude plan
 *   ROBOT_BRAIN_MODEL=haiku     # optional; any model name `claude --model` takes
 *
 * Starting `claude` takes 3 or more seconds, and answering in a fresh process
 * took 13-17 s here, too slow for a robot (the headset waits 15 s). So one
 * process is always started ahead of time and waits for its first message;
 * a request takes it (about 2 s to answer) and the next one starts behind
 * it. Each process answers exactly one request and exits, so nothing carries
 * over between rooms or visitors: the request brings the room's instructions
 * and the conversation, as it does for the model API.
 *
 * Visitor speech reaches this process and the dev server listens on the
 * local network, so the process gets no tools at all (`--tools ""`), no MCP
 * servers, none of the user's settings, hooks or plugins
 * (`--setting-sources project` in an empty folder), and keeps no session.
 */

export interface Brain {
  readonly name: string;
  /** One reply: `instructions` play the role of the system prompt. */
  reply(instructions: string, conversation: { role: string; content: string }[], timeoutMs: number): Promise<string>;
}

/** Said once to every process; the real instructions come with each request. */
const STANDING =
  'You speak for the worker robots in Walkthrough, a VR app that shows a codebase as a building of rooms. ' +
  'Each message is one self-contained request: the room instructions, then the conversation so far. ' +
  'Follow the room instructions exactly and write only the reply they ask for: no preamble, no markdown, no code blocks.';

/** The model API gets real tool calls; a command line writes each action as a line of its own instead. */
export const ACTION_LINES =
  'To act, write each action on a line of its own after your spoken words and before the FOLLOWUPS line, in exactly one of these forms, with no quotes or backticks: ' +
  'go_to_room: <room id> / play_flow: <flow id> / point_to_room: <room id> / show_file: <file path> / add_note: <the note> / back_to_city: . ' +
  'Those lines are carried out, never read aloud, so never mention them in your words.';

let cached: { key: string; brain: Brain | null } | null = null;

/** The brain set in the environment, or null to use the model API. */
export function activeBrain(): Brain | null {
  const name = (process.env.ROBOT_BRAIN ?? '').trim().toLowerCase();
  const model = (process.env.ROBOT_BRAIN_MODEL ?? '').trim();
  const key = `${name}|${model}`;
  if (cached?.key === key) return cached.brain;
  let brain: Brain | null = null;
  if (name === 'claude') brain = new ClaudeBrain(model || 'haiku');
  else if (name) console.warn(`[brain] ROBOT_BRAIN=${name} is not supported (only "claude"); using the model API`);
  cached = { key, brain };
  return brain;
}

interface Waiting {
  child: ChildProcess;
  /** Resolves with the reply text of the one request this process answers. */
  result: Promise<string>;
}

/** Processes kept started and waiting, so two questions close together both find one ready. */
const SPARES = 2;

class ClaudeBrain implements Brain {
  readonly name = 'claude';
  private readonly spares: Waiting[] = [];
  private readonly dir: string;
  private readonly systemFile: string;

  constructor(private readonly model: string) {
    // An empty folder of its own: no project CLAUDE.md or settings are found from here.
    this.dir = fs.mkdtempSync(path.join(os.tmpdir(), 'diorama-brain-'));
    this.systemFile = path.join(this.dir, 'standing.txt');
    fs.writeFileSync(this.systemFile, STANDING);
    for (let i = 0; i < SPARES; i++) this.spares.push(this.start());
    console.log(`[brain] robots answer through Claude Code (${model}); warming up`);
  }

  async reply(instructions: string, conversation: { role: string; content: string }[], timeoutMs: number): Promise<string> {
    // Oldest first: it has had the longest to start. One that died waiting is skipped.
    let proc = this.spares.shift();
    while (proc && proc.child.exitCode !== null) proc = this.spares.shift();
    proc ??= this.start();
    while (this.spares.length < SPARES) this.spares.push(this.start());
    const started = Date.now();
    const lines = conversation.map((t) => `${t.role === 'assistant' ? 'You' : 'Visitor'}: ${t.content}`);
    const message = ['ROOM INSTRUCTIONS:', instructions, '', 'CONVERSATION:', ...lines, '', 'Write your reply now.'].join('\n');
    proc.child.stdin?.write(`${JSON.stringify({ type: 'user', message: { role: 'user', content: message } })}\n`);
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        stop(proc.child);
        const error = new Error('Claude took too long to answer');
        error.name = 'TimeoutError';
        reject(error);
      }, timeoutMs);
    });
    try {
      const said = await Promise.race([proc.result, timeout]);
      console.log(`[brain] answered in ${Date.now() - started} ms (${message.length} characters in)`);
      return said;
    } finally {
      clearTimeout(timer);
    }
  }

  private start(): Waiting {
    const args = [
      '-p',
      '--model', this.model,
      '--tools', '',
      '--strict-mcp-config',
      '--setting-sources', 'project',
      '--no-session-persistence',
      '--disable-slash-commands',
      // A robot's reply is a few spoken sentences; thinking first made replies 3-12 s instead of about 2.
      '--effort', 'low',
      '--system-prompt-file', this.systemFile,
      '--input-format', 'stream-json',
      '--output-format', 'stream-json',
      '--verbose',
    ];
    // On Windows `claude` is an npm shim (claude.cmd), which only cmd.exe can
    // start. Every argument here is quoted and none contains a quote.
    const env = { ...process.env, MAX_THINKING_TOKENS: '0' };
    const child =
      process.platform === 'win32'
        ? spawn('cmd.exe', ['/d', '/s', '/c', ['claude', ...args.map((a) => `"${a}"`)].join(' ')], {
            cwd: this.dir,
            env,
            windowsVerbatimArguments: true,
            windowsHide: true,
          })
        : spawn('claude', args, { cwd: this.dir, env });
    // A waiting process must not keep the dev server alive after it is told
    // to stop. When the server exits, the pipe closes and the process ends.
    child.unref();
    for (const pipe of [child.stdin, child.stdout, child.stderr]) (pipe as unknown as { unref?: () => void } | null)?.unref?.();
    let stderr = '';
    child.stderr?.on('data', (d: Buffer) => (stderr = (stderr + d.toString()).slice(-600)));
    const result = new Promise<string>((resolve, reject) => {
      child.on('error', (e) => reject(new Error(`could not start claude: ${e.message}`)));
      const out = readline.createInterface({ input: child.stdout! });
      out.on('line', (line) => {
        let m: { type?: string; result?: unknown; is_error?: boolean };
        try {
          m = JSON.parse(line);
        } catch {
          return;
        }
        if (m.type !== 'result') return;
        if (m.is_error || typeof m.result !== 'string') reject(new Error(`claude: ${String(m.result ?? 'no answer').slice(0, 200)}`));
        else resolve(m.result);
        child.stdin?.end(); // one request per process: closing its input lets it exit
      });
      child.on('close', (code) => reject(new Error(`claude exited (${code}) before answering${stderr ? `: ${stderr.trim()}` : ''}`)));
    });
    result.catch(() => {}); // a spare that dies unused must not crash the server
    return { child, result };
  }
}

function stop(child: ChildProcess): void {
  child.stdin?.end();
  if (process.platform === 'win32' && child.pid) {
    // Killing cmd.exe would leave claude itself running.
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true }).on('error', () => {});
  } else child.kill();
}
