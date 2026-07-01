import type { TaskPaths } from "./types.js";
import { readTaskText } from "./workspace.js";

export interface BuildPromptInput {
  taskId: string;
  paths: TaskPaths;
  userPrompt: string;
  targetAgent: string;
}

export async function buildAgentPrompt(input: BuildPromptInput): Promise<string> {
  const task = await readTaskText(input.paths);

  return [
    "# Agent Bridge Request",
    "",
    `Target agent: ${input.targetAgent}`,
    `Task id: ${input.taskId}`,
    "",
    "## Goal",
    task.goal.trim(),
    "",
    "## Shared Context",
    task.context.trim(),
    "",
    "## Decisions To Preserve",
    task.decisions.trim(),
    "",
    "## Current Request",
    input.userPrompt.trim(),
    "",
    "## Response Contract",
    "- Stay within the provided task context unless the user request explicitly expands it.",
    "- Separate facts, assumptions, risks, and recommended next actions.",
    "- If you need another agent to continue, include a concise handoff note.",
    "- Do not claim files were edited, tests were run, or external state was verified unless that actually happened."
  ].join("\n");
}
