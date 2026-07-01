import path from "node:path";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { timestamp } from "./fs-utils.js";
import type { TaskPaths } from "./types.js";
import { readTaskText } from "./workspace.js";

export async function createHandoff(paths: TaskPaths, target = "next-agent"): Promise<{ filePath: string; content: string }> {
  const task = await readTaskText(paths);
  const latestRuns = await readLatestRuns(paths, 3);
  const content = [
    `# Handoff Brief: ${target}`,
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
    "## Recent Agent Runs",
    latestRuns.length > 0 ? latestRuns.join("\n\n---\n\n") : "No agent runs recorded yet.",
    "",
    "## Next Agent Instructions",
    "- Read the goal, shared context, and decisions before acting.",
    "- Preserve existing decisions unless new evidence invalidates them.",
    "- Report what you changed, how you verified it, and what remains uncertain.",
    "- Do not hide unknowns or unverified claims.",
    ""
  ].join("\n");

  const filePath = path.join(paths.handoffs, `${timestamp()}-${target}.md`);
  await writeFile(filePath, content, "utf8");
  return { filePath, content };
}

async function readLatestRuns(paths: TaskPaths, count: number): Promise<string[]> {
  try {
    const files = (await readdir(paths.runs))
      .filter((file) => file.endsWith(".md"))
      .sort()
      .slice(-count);

    return Promise.all(
      files.map(async (file) => {
        const body = await readFile(path.join(paths.runs, file), "utf8");
        return trimRun(body);
      })
    );
  } catch {
    return [];
  }
}

function trimRun(body: string): string {
  const lines = body.split("\n");
  const head = lines.slice(0, 12).join("\n");
  const stdoutIndex = lines.findIndex((line) => line === "## Stdout");
  const stdoutSnippet = stdoutIndex >= 0 ? lines.slice(stdoutIndex, stdoutIndex + 16).join("\n") : "";
  return [head, stdoutSnippet].filter(Boolean).join("\n\n");
}
