#!/usr/bin/env node
import { relative } from "node:path";
import path from "node:path";
import { writeFile } from "node:fs/promises";
import { BridgeError } from "./errors.js";
import { buildAgentPrompt } from "./prompt.js";
import { runAgent } from "./runner.js";
import { ensureDir, timestamp } from "./fs-utils.js";
import {
  getActiveTask,
  initializeWorkspace,
  listTasks,
  loadWorkspace,
  setActiveTask,
  taskPaths
} from "./workspace.js";
import { createHandoff } from "./handoff.js";

interface ParsedArgs {
  command: string;
  args: string[];
  flags: Set<string>;
  rawFlags: string[];
}

async function main(argv: string[]): Promise<void> {
  const parsed = parseArgs(argv);
  const cwd = process.cwd();

  switch (parsed.command) {
    case "init":
      await commandInit(cwd, parsed.args.join(" ") || "New agent task");
      return;
    case "agents":
      await commandAgents(cwd);
      return;
    case "task":
      await commandTask(cwd, parsed.args);
      return;
    case "ask":
      await commandAsk(cwd, parsed.args, parsed.flags.has("--dry-run"));
      return;
    case "review":
      await commandReview(cwd, parsed.args, parsed.flags.has("--dry-run"), getFlagValue(parsed.rawFlags, "--agents"));
      return;
    case "handoff":
      await commandHandoff(cwd, parsed.args[0]);
      return;
    case "digest":
      await commandDigest(cwd);
      return;
    case "help":
    case "--help":
    case "-h":
      printHelp();
      return;
    case "--version":
    case "-v":
      console.log("0.1.0");
      return;
    default:
      throw new BridgeError(`Unknown command: ${parsed.command}\nRun \`agent-bridge help\`.`);
  }
}

function parseArgs(argv: string[]): ParsedArgs {
  const [command = "help", ...rest] = argv;
  const rawFlags = rest.filter((arg) => arg.startsWith("--"));
  const flags = new Set(rawFlags.map((arg) => arg.split("=")[0] ?? arg));
  const args = rest.filter((arg) => !arg.startsWith("--"));
  return { command, args, flags, rawFlags };
}

function getFlagValue(rawFlags: string[], name: string): string | undefined {
  const prefix = `${name}=`;
  return rawFlags.find((flag) => flag.startsWith(prefix))?.slice(prefix.length);
}

async function commandInit(cwd: string, taskName: string): Promise<void> {
  const result = await initializeWorkspace(cwd, taskName);
  console.log(`Initialized Agent Bridge`);
  console.log(`Active task: ${result.task}`);
  console.log(`Config: ${relative(cwd, result.workspace.configPath)}`);
  console.log(`Agents: ${relative(cwd, result.workspace.agentsPath)}`);
}

async function commandAgents(cwd: string): Promise<void> {
  const workspace = await loadWorkspace(cwd);
  for (const [name, agent] of Object.entries(workspace.agents.agents)) {
    console.log(`${name}\t${agent.command}\t${agent.description ?? ""}`);
  }
}

async function commandTask(cwd: string, args: string[]): Promise<void> {
  const workspace = await loadWorkspace(cwd);
  const [subcommand, taskId] = args;

  if (subcommand === "list" || !subcommand) {
    const tasks = await listTasks(workspace);
    const active = workspace.state.activeTask;
    for (const task of tasks) {
      console.log(`${task === active ? "*" : " "} ${task}`);
    }
    return;
  }

  if (subcommand === "use") {
    if (!taskId) {
      throw new BridgeError("Usage: agent-bridge task use <task-id>");
    }
    await setActiveTask(workspace, taskId);
    console.log(`Active task: ${taskId}`);
    return;
  }

  throw new BridgeError("Usage: agent-bridge task [list|use <task-id>]");
}

async function commandAsk(cwd: string, args: string[], dryRun: boolean): Promise<void> {
  const [agentName, ...promptParts] = args;
  if (!agentName || promptParts.length === 0) {
    throw new BridgeError("Usage: agent-bridge ask <agent> <prompt> [--dry-run]");
  }

  const workspace = await loadWorkspace(cwd);
  const agent = workspace.agents.agents[agentName];
  if (!agent) {
    throw new BridgeError(`Unknown agent "${agentName}". Run \`agent-bridge agents\` to list configured agents.`);
  }

  const taskId = await getActiveTask(workspace);
  const paths = taskPaths(workspace, taskId);
  const prompt = await buildAgentPrompt({
    taskId,
    paths,
    targetAgent: agentName,
    userPrompt: promptParts.join(" ")
  });

  const run = await runAgent({ agentName, config: agent, prompt, cwd, paths, dryRun });
  console.log(`Run recorded: ${run.id}`);
  if (run.stdout.trim()) {
    console.log("");
    console.log(run.stdout.trim());
  }
  if (run.stderr.trim()) {
    console.error(run.stderr.trim());
  }
  if (run.exitCode !== 0) {
    throw new BridgeError(`Agent exited with code ${run.exitCode}`, run.exitCode ?? 1);
  }
}

async function commandHandoff(cwd: string, target?: string): Promise<void> {
  const workspace = await loadWorkspace(cwd);
  const taskId = await getActiveTask(workspace);
  const paths = taskPaths(workspace, taskId);
  const handoff = await createHandoff(paths, target ?? "next-agent");
  console.log(`Handoff written: ${relative(cwd, handoff.filePath)}`);
}

async function commandReview(cwd: string, args: string[], dryRun: boolean, agentsFlag?: string): Promise<void> {
  if (args.length === 0) {
    throw new BridgeError("Usage: agent-bridge review <prompt> [--agents=a,b] [--dry-run]");
  }

  const workspace = await loadWorkspace(cwd);
  const selectedAgents = agentsFlag
    ? agentsFlag.split(",").map((agent) => agent.trim()).filter(Boolean)
    : workspace.config.defaultAgents;

  if (selectedAgents.length === 0) {
    throw new BridgeError("No review agents selected.");
  }

  const taskId = await getActiveTask(workspace);
  const paths = taskPaths(workspace, taskId);
  await ensureDir(paths.reviews);

  const userPrompt = args.join(" ");
  const runIds: string[] = [];
  const failures: string[] = [];

  for (const agentName of selectedAgents) {
    const agent = workspace.agents.agents[agentName];
    if (!agent) {
      failures.push(`${agentName}: not configured`);
      continue;
    }

    const prompt = await buildAgentPrompt({
      taskId,
      paths,
      targetAgent: agentName,
      userPrompt: [
        "Multi-agent review request.",
        "",
        userPrompt,
        "",
        "Focus on risks, blind spots, and concrete next actions. Do not repeat other agents unless needed."
      ].join("\n")
    });

    const run = await runAgent({ agentName, config: agent, prompt, cwd, paths, dryRun });
    runIds.push(run.id);
    if (run.exitCode !== 0) {
      failures.push(`${agentName}: exit code ${run.exitCode}`);
    }
  }

  const reviewFile = path.join(paths.reviews, `${timestamp()}-review.md`);
  await writeFile(
    reviewFile,
    [
      "# Multi-Agent Review",
      "",
      `Task: ${taskId}`,
      `Prompt: ${userPrompt}`,
      "",
      "## Runs",
      ...runIds.map((id) => `- ${id}`),
      "",
      "## Failures",
      failures.length > 0 ? failures.map((failure) => `- ${failure}`).join("\n") : "None",
      ""
    ].join("\n"),
    "utf8"
  );

  console.log(`Review written: ${relative(cwd, reviewFile)}`);
  if (failures.length > 0) {
    throw new BridgeError(`Review completed with failures: ${failures.join("; ")}`);
  }
}

async function commandDigest(cwd: string): Promise<void> {
  const workspace = await loadWorkspace(cwd);
  const tasks = await listTasks(workspace);
  console.log(`Agent Bridge workspace: ${relative(cwd, workspace.bridgeDir)}`);
  console.log(`Active task: ${workspace.state.activeTask ?? "none"}`);
  console.log(`Tasks: ${tasks.length}`);
  console.log(`Agents: ${Object.keys(workspace.agents.agents).join(", ")}`);
}

function printHelp(): void {
  console.log(`Agent Bridge

Usage:
  agent-bridge init <task name>
  agent-bridge agents
  agent-bridge task list
  agent-bridge task use <task-id>
  agent-bridge ask <agent> <prompt> [--dry-run]
  agent-bridge review <prompt> [--agents=a,b] [--dry-run]
  agent-bridge handoff [target-agent]
  agent-bridge digest

Agent adapters live in .agent-bridge/agents.json.
Use {{prompt}} in args to pass the built task prompt as an argument, or omit it and set promptMode to "stdin".
`);
}

main(process.argv.slice(2)).catch((error: unknown) => {
  if (error instanceof BridgeError) {
    console.error(error.message);
    process.exit(error.exitCode);
  }

  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
