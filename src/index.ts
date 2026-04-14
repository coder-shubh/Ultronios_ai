import dotenv from "dotenv";
import * as readline from "readline";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { spawn, execSync } from "child_process";
import { query, type Options } from "@anthropic-ai/claude-agent-sdk";

dotenv.config();
dotenv.config({ path: ".env.example" });

// ─── CLI History ──────────────────────────────────────────────────────────────

const HISTORY_DIR  = path.join(os.homedir(), ".ai-agent");
const HISTORY_FILE = path.join(HISTORY_DIR, "history.json");

type HistoryEntry = {
  id: string;
  prompt: string;
  intent: string;
  model: string;
  cwd: string;
  timestamp: string;
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
};

function loadHistory(): HistoryEntry[] {
  try {
    if (!fs.existsSync(HISTORY_FILE)) return [];
    return JSON.parse(fs.readFileSync(HISTORY_FILE, "utf-8")) as HistoryEntry[];
  } catch { return []; }
}

function saveHistory(entry: HistoryEntry): void {
  try {
    if (!fs.existsSync(HISTORY_DIR)) fs.mkdirSync(HISTORY_DIR, { recursive: true });
    const all = [entry, ...loadHistory()].slice(0, 500);
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(all, null, 2));
  } catch { /* silently ignore */ }
}

function printHistory(limit = 20): void {
  const all = loadHistory().slice(0, limit);
  if (all.length === 0) { console.log("\x1b[2mNo history yet.\x1b[0m\n"); return; }
  console.log(`\n\x1b[2mLast ${all.length} tasks:\x1b[0m\n`);
  all.forEach((e, i) => {
    const ts   = new Date(e.timestamp).toLocaleString();
    const cost = e.costUsd ? ` · $${e.costUsd.toFixed(5)}` : "";
    const tok  = e.inputTokens ? ` · ${(e.inputTokens + (e.outputTokens ?? 0)).toLocaleString()} tok` : "";
    console.log(
      `\x1b[2m${String(i + 1).padStart(2)}.\x1b[0m ` +
      `\x1b[33m[${e.intent}·${e.model.replace("claude-","").replace("-4-6","").replace("-4-5","")}]\x1b[0m ` +
      `${e.prompt.slice(0, 60)}${e.prompt.length > 60 ? "…" : ""}` +
      `\x1b[2m${tok}${cost} — ${ts}\x1b[0m`,
    );
  });
  console.log();
}

// ─── Dynamic system prompt — reads project context from cwd ──────────────────

function safe(fn: () => string, fallback = ""): string {
  try { return fn(); } catch { return fallback; }
}

function buildSystemPrompt(cwd: string): string {
  // ── package.json ──────────────────────────────────────────────────────────
  let pkg: Record<string, unknown> = {};
  try { pkg = JSON.parse(fs.readFileSync(path.join(cwd, "package.json"), "utf-8")); } catch { /* not a node project */ }

  const deps    = (pkg.dependencies    as Record<string, string> | undefined) ?? {};
  const devDeps = (pkg.devDependencies as Record<string, string> | undefined) ?? {};
  const scripts = (pkg.scripts         as Record<string, string> | undefined) ?? {};
  const rnVersion = deps["react-native"] ?? devDeps["react-native"] ?? "";

  const NOISE = new Set(["react", "react-native", "typescript", "metro-config"]);
  const depStr = Object.entries(deps).filter(([k]) => !NOISE.has(k)).slice(0, 10).map(([k, v]) => `${k}@${v}`).join(", ");
  const scriptStr = Object.entries(scripts).slice(0, 8).map(([k, v]) => `  ${k}: ${v}`).join("\n");

  // ── File tree (2 levels) ──────────────────────────────────────────────────
  const SKIP = new Set(["node_modules", ".git", ".next", "dist", "build", "android", "ios", "__pycache__"]);
  function tree(dir: string, depth = 0): string {
    if (depth > 1) return "";
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return ""; }
    return entries
      .filter((e) => !SKIP.has(e.name) && !e.name.startsWith("."))
      .slice(0, 20)
      .map((e) => {
        const indent = "  ".repeat(depth);
        if (e.isDirectory()) return `${indent}${e.name}/\n${tree(path.join(dir, e.name), depth + 1)}`;
        return `${indent}${e.name}`;
      })
      .join("\n");
  }

  // ── Git ───────────────────────────────────────────────────────────────────
  const gitBranch = safe(() => execSync("git rev-parse --abbrev-ref HEAD", { cwd, timeout: 2000 }).toString().trim());
  const gitLog    = safe(() => execSync("git log --oneline -5 --no-color",  { cwd, timeout: 3000 }).toString().trim());

  const projectName = String(pkg.name ?? path.basename(cwd));
  const fileTree    = safe(() => tree(cwd));

  return `You are Ultronios — an expert AI agent and senior React Native / TypeScript engineer.
You work autonomously: read files, run the project, debug, write/refactor code, manage deps.

## Stack
React Native${rnVersion ? ` ${rnVersion}` : ""}, React 19, TypeScript, Redux Toolkit, React Navigation
iOS (Xcode, CocoaPods) · Android (Gradle) · Metro · Jest / Detox · Fastlane

## Rules
- Minimal output · diffs not full files
- Use Glob/Grep to navigate — don't guess file paths
- Warn before breaking changes · confirm ambiguous tasks

## Active project: ${projectName}${gitBranch ? ` (branch: ${gitBranch})` : ""}
Working directory: ${cwd}
${scriptStr ? `\n### Scripts\n${scriptStr}` : ""}
${depStr ? `\n### Key dependencies\n${depStr}` : ""}
${fileTree ? `\n### File structure\n\`\`\`\n${fileTree}\n\`\`\`` : ""}
${gitLog ? `\n### Recent commits\n${gitLog}` : ""}`;
}

// ─── Zero-token direct execution ─────────────────────────────────────────────
// If the input is a known shell command or natural-language alias, run it
// directly via child_process — zero LLM tokens consumed.

/** Raw shell prefixes that need no LLM interpretation */
const SHELL_RE = /^(npm|yarn|npx|node|pod|adb|git|ls|mkdir|rm|cp|mv|cat|which|brew|fastlane|xcodebuild|\.\/gradlew|gradlew|python3?|pip3?|ts-node|tsc|expo)\b/i;

/** Natural-language aliases → shell command */
const NL_CMDS: [RegExp, string][] = [
  [/^run\s+ios$/i,                               "npx react-native run-ios"],
  [/^run\s+android$/i,                           "npx react-native run-android"],
  [/^(start|launch)\s+(metro|server|bundler)$/i, "npx react-native start"],
  [/^(install|update)\s+pods?$/i,                "cd ios && pod install"],
  [/^reset\s+(cache|metro)$/i,                   "npx react-native start --reset-cache"],
  [/^clean\s+android$/i,                         "cd android && ./gradlew clean"],
  [/^(build|compile)\s+android$/i,               "cd android && ./gradlew assembleDebug"],
  [/^install\s+dep(s|endencies)?$/i,             "npm install"],
  [/^(lint|eslint)$/i,                           "npx eslint . --ext .ts,.tsx"],
  [/^(typecheck|tsc)$/i,                         "npx tsc --noEmit"],
];

function resolveDirectCmd(input: string): string | null {
  if (SHELL_RE.test(input)) return input;
  for (const [re, cmd] of NL_CMDS) {
    if (re.test(input)) return cmd;
  }
  return null;
}

function execDirect(cmd: string, cwd?: string): Promise<void> {
  const dir = cwd ?? process.cwd();
  // Escape double-quotes inside the path/command for AppleScript
  const safeDir = dir.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const safeCmd = cmd.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

  const appleScript = `
    tell application "Terminal"
      activate
      do script "cd \\"${safeDir}\\" && ${safeCmd}"
    end tell
  `;

  return new Promise((resolve) => {
    console.log(`\x1b[2m↗ Opening terminal: ${cmd}\x1b[0m`);
    console.log(`\x1b[2m  path: ${dir}\x1b[0m\n`);

    const proc = spawn("osascript", ["-e", appleScript], { stdio: "pipe" });
    proc.on("close", () => { resolve(); });
    proc.on("error", () => {
      // osascript unavailable (Linux/CI) — fall back to inline
      console.log(`\x1b[2m$ ${cmd}\x1b[0m\n`);
      const fb = spawn("sh", ["-c", cmd], { cwd: dir, stdio: "inherit", env: { ...process.env } });
      fb.on("close", resolve);
      fb.on("error", resolve);
    });
  });
}

// ─── Intent classifier (zero LLM cost) ───────────────────────────────────────

type Intent = "read" | "write" | "run" | "debug";

const PATTERNS: [RegExp, Intent][] = [
  [/\b(run|start|launch|install|build|deploy|pod|gradle|metro|android|ios|npm|yarn|exec)\b/i, "run"],
  [/\b(fix|debug|error|crash|issue|problem|fail|broken|exception|traceback|why\s+is)\b/i, "debug"],
  [/\b(create|make|write|add|generate|new|scaffold|implement|refactor|update|change|edit|modify)\b/i, "write"],
  [/\b(open|show|read|explain|find|search|look|check|list|what|where|display|view|how\s+does)\b/i, "read"],
];

function classify(input: string): Intent {
  for (const [re, intent] of PATTERNS) {
    if (re.test(input)) return intent;
  }
  return "write";
}

// ─── Per-intent config (model + tools + turns) ───────────────────────────────

type Cfg = Pick<Options, "model" | "allowedTools" | "maxTurns">;

const CFG: Record<Intent, Cfg> = {
  //          model              tools                                       turns  cost/1M in
  read:  { model: "claude-haiku-4-5",  allowedTools: ["Read","Glob","Grep"],                maxTurns: 5 }, // $1
  run:   { model: "claude-haiku-4-5",  allowedTools: ["Bash","Read","Glob"],                maxTurns: 6 }, // $1
  write: { model: "claude-sonnet-4-6", allowedTools: ["Read","Write","Edit","Glob","Grep"], maxTurns: 8 }, // $3
  debug: { model: "claude-sonnet-4-6", allowedTools: ["Read","Glob","Grep","Bash"],         maxTurns: 7 }, // $3
};

const MODEL_TAG: Record<string, string> = {
  "claude-haiku-4-5":  "haiku",
  "claude-sonnet-4-6": "sonnet",
  "claude-opus-4-6":   "opus",
};

// ─── Spinner ──────────────────────────────────────────────────────────────────

class Spinner {
  private frames = ["⠋","⠙","⠹","⠸","⠼","⠴","⠦","⠧","⠇","⠏"];
  private timer: ReturnType<typeof setInterval> | null = null;
  private i = 0;

  start(label: string) {
    process.stdout.write("\n");
    this.timer = setInterval(() => {
      process.stdout.write(`\r\x1b[36m${this.frames[this.i++ % this.frames.length]}\x1b[0m \x1b[33m${label}\x1b[0m`);
    }, 80);
  }

  stop() {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    process.stdout.write("\r\x1b[2K");
  }
}

// ─── CLI ──────────────────────────────────────────────────────────────────────

const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
const ask = (q: string) => new Promise<string>((r) => rl.question(q, r));

// ─── Agent runner ─────────────────────────────────────────────────────────────

async function runAgent(userInput: string, cwd?: string): Promise<void> {
  const intent = classify(userInput);
  const cfg    = CFG[intent];
  const tag    = MODEL_TAG[cfg.model as string] ?? cfg.model;

  const options: Options = {
    permissionMode: "acceptEdits",
    systemPrompt:   buildSystemPrompt(cwd ?? process.cwd()),
    ...cfg,
    ...(cwd ? { cwd } : {}),
  };

  const spinner = new Spinner();
  spinner.start(`[${intent} · ${tag}] working…`);
  let printed = false;

  try {
    for await (const message of query({ prompt: userInput, options })) {
      const msg  = message as Record<string, unknown>;
      const type = msg.type as string | undefined;

      if (type === "assistant") {
        const content = (msg.message as Record<string, unknown> | undefined)?.content;
        if (Array.isArray(content)) {
          for (const b of content as Array<Record<string, unknown>>) {
            if (b?.type === "text" && typeof b.text === "string" && b.text) {
              if (!printed) { spinner.stop(); process.stdout.write(`\x1b[36m[${tag}]\x1b[0m `); printed = true; }
              process.stdout.write(b.text);
            }
          }
        }
      } else if (type === "result") {
        const r      = msg.result as string | undefined;
        const usage  = msg.usage  as Record<string, number> | undefined;
        if (r && !printed) { spinner.stop(); process.stdout.write(`\x1b[36m[${tag}]\x1b[0m ${r}`); printed = true; }
        // ── persist to history ──────────────────────────────────────────────
        saveHistory({
          id:           crypto.randomUUID(),
          prompt:       userInput,
          intent,
          model:        cfg.model as string,
          cwd:          cwd ?? process.cwd(),
          timestamp:    new Date().toISOString(),
          inputTokens:  usage?.input_tokens,
          outputTokens: usage?.output_tokens,
          costUsd:      msg.total_cost_usd as number | undefined,
        });
        break;
      }
    }
  } finally {
    spinner.stop();
  }

  if (!printed) process.stdout.write(`\x1b[36m[${tag}]\x1b[0m Done.\n`);
  process.stdout.write("\n\n");
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("\x1b[1m\x1b[35mUltronios\x1b[0m  \x1b[2mread/run→haiku  write/debug→sonnet\x1b[0m\n");
  console.log("\x1b[2mcwd <path>  history [n]  exit\x1b[0m\n");

  let cwd: string | undefined;

  while (true) {
    const raw = (await ask("\x1b[32m›\x1b[0m ")).trim();
    if (!raw) continue;
    if (raw === "exit" || raw === "quit") { rl.close(); process.exit(0); }
    if (raw.startsWith("cwd "))     { cwd = raw.slice(4).trim(); console.log(`\x1b[2m→ ${cwd}\x1b[0m\n`); continue; }
    if (raw.startsWith("history"))  { printHistory(Number(raw.split(" ")[1]) || 20); continue; }

    const direct = resolveDirectCmd(raw);
    if (direct) {
      await execDirect(direct, cwd);
    } else {
      try      { await runAgent(raw, cwd); }
      catch(e) { console.error("\x1b[31mErr:\x1b[0m", e instanceof Error ? e.message : e, "\n"); }
    }
  }
}

main().catch(console.error);
