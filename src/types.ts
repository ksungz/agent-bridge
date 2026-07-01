export type PromptMode = "argument" | "stdin";

export interface AgentConfig {
  command: string;
  args?: string[];
  promptMode?: PromptMode;
  description?: string;
  timeoutMs?: number;
  env?: Record<string, string>;
}

export interface AgentsFile {
  agents: Record<string, AgentConfig>;
}

export interface BridgeConfig {
  version: 1;
  tasksDir: string;
  defaultAgents: string[];
}

export interface BridgeState {
  activeTask?: string;
}

export interface TaskPaths {
  root: string;
  goal: string;
  context: string;
  decisions: string;
  runs: string;
  handoffs: string;
  reviews: string;
}

export interface RunRecord {
  id: string;
  agent: string;
  prompt: string;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  durationMs: number;
  startedAt: string;
  command: string;
  args: string[];
}
