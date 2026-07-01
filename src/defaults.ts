import type { AgentsFile, BridgeConfig } from "./types.js";

export const CONFIG_DIR = ".agent-bridge";
export const CONFIG_FILE = "config.json";
export const AGENTS_FILE = "agents.json";
export const STATE_FILE = "state.json";

export const defaultConfig: BridgeConfig = {
  version: 1,
  tasksDir: "tasks",
  defaultAgents: ["claude", "codex", "gemini"]
};

export const defaultAgents: AgentsFile = {
  agents: {
    claude: {
      command: "claude",
      args: ["--print", "{{prompt}}"],
      promptMode: "argument",
      description: "Claude Code non-interactive print mode"
    },
    codex: {
      command: "codex",
      args: ["exec", "--skip-git-repo-check", "--sandbox", "read-only", "{{prompt}}"],
      promptMode: "argument",
      description: "Codex CLI non-interactive exec mode"
    },
    gemini: {
      command: "gemini",
      args: ["--prompt", "{{prompt}}"],
      promptMode: "argument",
      description: "Gemini CLI non-interactive prompt mode"
    }
  }
};
