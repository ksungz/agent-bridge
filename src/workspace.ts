import path from "node:path";
import { readdir, writeFile } from "node:fs/promises";
import {
  AGENTS_FILE,
  CONFIG_DIR,
  CONFIG_FILE,
  defaultAgents,
  defaultConfig,
  STATE_FILE
} from "./defaults.js";
import { BridgeError } from "./errors.js";
import { ensureDir, pathExists, readJson, readTextIfExists, slugify, timestamp, writeJson } from "./fs-utils.js";
import type { AgentsFile, BridgeConfig, BridgeState, TaskPaths } from "./types.js";

export interface Workspace {
  cwd: string;
  bridgeDir: string;
  configPath: string;
  agentsPath: string;
  statePath: string;
  config: BridgeConfig;
  agents: AgentsFile;
  state: BridgeState;
}

export async function loadWorkspace(cwd: string, options: { allowMissing?: boolean } = {}): Promise<Workspace> {
  const bridgeDir = path.join(cwd, CONFIG_DIR);
  const configPath = path.join(bridgeDir, CONFIG_FILE);
  const agentsPath = path.join(bridgeDir, AGENTS_FILE);
  const statePath = path.join(bridgeDir, STATE_FILE);

  if (!(await pathExists(configPath))) {
    if (options.allowMissing) {
      return {
        cwd,
        bridgeDir,
        configPath,
        agentsPath,
        statePath,
        config: defaultConfig,
        agents: defaultAgents,
        state: {}
      };
    }

    throw new BridgeError("Agent Bridge is not initialized. Run `agent-bridge init <task>` first.");
  }

  return {
    cwd,
    bridgeDir,
    configPath,
    agentsPath,
    statePath,
    config: await readJson<BridgeConfig>(configPath),
    agents: (await pathExists(agentsPath)) ? await readJson<AgentsFile>(agentsPath) : defaultAgents,
    state: (await pathExists(statePath)) ? await readJson<BridgeState>(statePath) : {}
  };
}

export async function initializeWorkspace(cwd: string, taskName: string): Promise<{ workspace: Workspace; task: string }> {
  const workspace = await loadWorkspace(cwd, { allowMissing: true });
  await ensureDir(workspace.bridgeDir);

  if (!(await pathExists(workspace.configPath))) {
    await writeJson(workspace.configPath, defaultConfig);
  }

  if (!(await pathExists(workspace.agentsPath))) {
    await writeJson(workspace.agentsPath, defaultAgents);
  }

  const task = await createTask(workspace, taskName);
  workspace.state.activeTask = task;
  await writeJson(workspace.statePath, workspace.state);

  return { workspace: await loadWorkspace(cwd), task };
}

export function taskPaths(workspace: Workspace, taskId: string): TaskPaths {
  const root = path.join(workspace.bridgeDir, workspace.config.tasksDir, taskId);

  return {
    root,
    goal: path.join(root, "goal.md"),
    context: path.join(root, "shared-context.md"),
    decisions: path.join(root, "decisions.md"),
    runs: path.join(root, "runs"),
    handoffs: path.join(root, "handoffs"),
    reviews: path.join(root, "reviews")
  };
}

export async function createTask(workspace: Workspace, taskName: string): Promise<string> {
  const id = `${timestamp()}-${slugify(taskName)}`;
  const paths = taskPaths(workspace, id);

  await ensureDir(paths.runs);
  await ensureDir(paths.handoffs);
  await ensureDir(paths.reviews);
  await writeFile(paths.goal, `# Goal\n\n${taskName.trim() || "Untitled task"}\n`, "utf8");
  await writeFile(
    paths.context,
    "# Shared Context\n\nAdd stable facts, constraints, links, and files that every agent should know.\n",
    "utf8"
  );
  await writeFile(
    paths.decisions,
    "# Decisions\n\nRecord decisions that future agents should not reopen without reason.\n",
    "utf8"
  );

  return id;
}

export async function setActiveTask(workspace: Workspace, taskId: string): Promise<void> {
  const paths = taskPaths(workspace, taskId);
  if (!(await pathExists(paths.root))) {
    throw new BridgeError(`Unknown task: ${taskId}`);
  }

  workspace.state.activeTask = taskId;
  await writeJson(workspace.statePath, workspace.state);
}

export async function getActiveTask(workspace: Workspace): Promise<string> {
  if (!workspace.state.activeTask) {
    throw new BridgeError("No active task. Run `agent-bridge init <task>` or `agent-bridge task use <task-id>`.");
  }

  return workspace.state.activeTask;
}

export async function listTasks(workspace: Workspace): Promise<string[]> {
  const dir = path.join(workspace.bridgeDir, workspace.config.tasksDir);
  if (!(await pathExists(dir))) {
    return [];
  }

  return (await readdir(dir, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

export async function readTaskText(paths: TaskPaths): Promise<{ goal: string; context: string; decisions: string }> {
  return {
    goal: await readTextIfExists(paths.goal),
    context: await readTextIfExists(paths.context),
    decisions: await readTextIfExists(paths.decisions)
  };
}
