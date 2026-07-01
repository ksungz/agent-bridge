import { spawn } from "node:child_process";
import path from "node:path";
import { writeFile } from "node:fs/promises";
import { BridgeError } from "./errors.js";
import { ensureDir, timestamp } from "./fs-utils.js";
import type { AgentConfig, RunRecord, TaskPaths } from "./types.js";

export function renderArgs(args: string[], prompt: string): string[] {
  return args.map((arg) => arg.replaceAll("{{prompt}}", prompt));
}

export function commandHasPromptPlaceholder(args: string[]): boolean {
  return args.some((arg) => arg.includes("{{prompt}}"));
}

export async function runAgent(options: {
  agentName: string;
  config: AgentConfig;
  prompt: string;
  cwd: string;
  paths: TaskPaths;
  dryRun?: boolean;
}): Promise<RunRecord> {
  const args = renderArgs(options.config.args ?? [], options.prompt);
  const mode = options.config.promptMode ?? (commandHasPromptPlaceholder(options.config.args ?? []) ? "argument" : "stdin");
  const finalArgs = mode === "argument" ? args : args.filter((arg) => !arg.includes("{{prompt}}"));
  const startedAt = new Date();
  const id = `${timestamp(startedAt)}-${options.agentName}`;

  if (options.dryRun) {
    const record: RunRecord = {
      id,
      agent: options.agentName,
      prompt: options.prompt,
      stdout: "",
      stderr: "",
      exitCode: 0,
      durationMs: 0,
      startedAt: startedAt.toISOString(),
      command: options.config.command,
      args: finalArgs
    };
    await writeRunRecord(options.paths, record);
    return record;
  }

  const output = await spawnAgent({
    command: options.config.command,
    args: finalArgs,
    prompt: options.prompt,
    promptMode: mode,
    cwd: options.cwd,
    timeoutMs: options.config.timeoutMs ?? 10 * 60 * 1000,
    env: options.config.env
  });

  const record: RunRecord = {
    id,
    agent: options.agentName,
    prompt: options.prompt,
    stdout: output.stdout,
    stderr: output.stderr,
    exitCode: output.exitCode,
    durationMs: Date.now() - startedAt.getTime(),
    startedAt: startedAt.toISOString(),
    command: options.config.command,
    args: finalArgs
  };

  await writeRunRecord(options.paths, record);
  return record;
}

async function spawnAgent(options: {
  command: string;
  args: string[];
  prompt: string;
  promptMode: "argument" | "stdin";
  cwd: string;
  timeoutMs: number;
  env?: Record<string, string>;
}): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
  return new Promise((resolve, reject) => {
    const child = spawn(options.command, options.args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      shell: false,
      stdio: ["pipe", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new BridgeError(`Agent command timed out after ${options.timeoutMs}ms: ${options.command}`));
    }, options.timeoutMs);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(new BridgeError(`Failed to start agent command "${options.command}": ${error.message}`));
    });
    child.on("close", (exitCode) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, exitCode });
    });

    if (options.promptMode === "stdin") {
      child.stdin.end(options.prompt);
    } else {
      child.stdin.end();
    }
  });
}

async function writeRunRecord(paths: TaskPaths, record: RunRecord): Promise<void> {
  await ensureDir(paths.runs);
  const filePath = path.join(paths.runs, `${record.id}.md`);
  const body = [
    `# Run ${record.id}`,
    "",
    `- Agent: ${record.agent}`,
    `- Started: ${record.startedAt}`,
    `- Duration: ${record.durationMs}ms`,
    `- Exit code: ${record.exitCode}`,
    `- Command: ${record.command} ${record.args.map(shellQuote).join(" ")}`.trim(),
    "",
    "## Prompt",
    "",
    "```text",
    record.prompt,
    "```",
    "",
    "## Stdout",
    "",
    "```text",
    record.stdout.trim(),
    "```",
    "",
    "## Stderr",
    "",
    "```text",
    record.stderr.trim(),
    "```",
    ""
  ].join("\n");

  await writeFile(filePath, body, "utf8");
}

function shellQuote(value: string): string {
  if (/^[a-zA-Z0-9_./:=@-]+$/.test(value)) {
    return value;
  }

  return `'${value.replaceAll("'", "'\\''")}'`;
}
