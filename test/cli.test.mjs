import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(repoRoot, "dist", "cli.js");

async function makeWorkspace() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "agent-bridge-test-"));
  return dir;
}

async function run(args, cwd) {
  return execFileAsync("node", [cli, ...args], { cwd });
}

async function runFail(args, cwd) {
  try {
    await run(args, cwd);
  } catch (error) {
    return error;
  }

  throw new Error(`Expected command to fail: ${args.join(" ")}`);
}

test("init creates bridge config, agents, and an active task", async () => {
  const cwd = await makeWorkspace();
  const result = await run(["init", "Improve portfolio flow"], cwd);

  assert.match(result.stdout, /Initialized Agent Bridge/);
  assert.ok(existsSync(path.join(cwd, ".agent-bridge", "config.json")));
  assert.ok(existsSync(path.join(cwd, ".agent-bridge", "agents.json")));
  assert.ok(existsSync(path.join(cwd, ".agent-bridge", "state.json")));

  const state = JSON.parse(await readFile(path.join(cwd, ".agent-bridge", "state.json"), "utf8"));
  assert.match(state.activeTask, /improve-portfolio-flow$/);
});

test("ask runs a configured argument-mode fake agent and records the run", async () => {
  const cwd = await makeWorkspace();
  await run(["init", "Review landing page"], cwd);

  const fakeAgent = path.join(cwd, "fake-agent.mjs");
  await writeFile(
    fakeAgent,
    "console.log('FAKE_ARG:' + process.argv.slice(2).join(' ').includes('Review button copy'));\n",
    "utf8"
  );

  const agentsPath = path.join(cwd, ".agent-bridge", "agents.json");
  await writeFile(
    agentsPath,
    JSON.stringify(
      {
        agents: {
          fake: {
            command: "node",
            args: [fakeAgent, "{{prompt}}"],
            promptMode: "argument"
          }
        }
      },
      null,
      2
    ),
    "utf8"
  );

  const result = await run(["ask", "fake", "Review button copy"], cwd);
  assert.match(result.stdout, /FAKE_ARG:true/);

  const state = JSON.parse(await readFile(path.join(cwd, ".agent-bridge", "state.json"), "utf8"));
  const runsDir = path.join(cwd, ".agent-bridge", "tasks", state.activeTask, "runs");
  const runs = await readdir(runsDir);
  assert.equal(runs.length, 1);

  const runBody = await readFile(path.join(runsDir, runs[0]), "utf8");
  assert.match(runBody, /Review button copy/);
  assert.match(runBody, /FAKE_ARG:true/);
});

test("ask supports stdin-mode adapters without a prompt placeholder", async () => {
  const cwd = await makeWorkspace();
  await run(["init", "Summarize task"], cwd);

  const fakeAgent = path.join(cwd, "fake-stdin-agent.mjs");
  await writeFile(
    fakeAgent,
    [
      "let body = '';",
      "process.stdin.setEncoding('utf8');",
      "process.stdin.on('data', chunk => body += chunk);",
      "process.stdin.on('end', () => console.log('STDIN_HAS_REQUEST:' + body.includes('Make a short digest')));"
    ].join("\n"),
    "utf8"
  );

  await writeFile(
    path.join(cwd, ".agent-bridge", "agents.json"),
    JSON.stringify(
      {
        agents: {
          fake: {
            command: "node",
            args: [fakeAgent],
            promptMode: "stdin"
          }
        }
      },
      null,
      2
    ),
    "utf8"
  );

  const result = await run(["ask", "fake", "Make a short digest"], cwd);
  assert.match(result.stdout, /STDIN_HAS_REQUEST:true/);
});

test("handoff writes a brief with goal, decisions, and recent runs", async () => {
  const cwd = await makeWorkspace();
  await run(["init", "Prepare release"], cwd);

  const state = JSON.parse(await readFile(path.join(cwd, ".agent-bridge", "state.json"), "utf8"));
  const taskDir = path.join(cwd, ".agent-bridge", "tasks", state.activeTask);
  await writeFile(path.join(taskDir, "decisions.md"), "# Decisions\n\n- Keep adapter config generic.\n", "utf8");

  const fakeAgent = path.join(cwd, "fake-agent.mjs");
  await writeFile(fakeAgent, "console.log('release checked');\n", "utf8");
  await writeFile(
    path.join(cwd, ".agent-bridge", "agents.json"),
    JSON.stringify({ agents: { fake: { command: "node", args: [fakeAgent], promptMode: "stdin" } } }, null, 2),
    "utf8"
  );
  await run(["ask", "fake", "Check release notes"], cwd);

  const result = await run(["handoff", "codex"], cwd);
  assert.match(result.stdout, /Handoff written:/);

  const handoffs = await readdir(path.join(taskDir, "handoffs"));
  assert.equal(handoffs.length, 1);
  const handoff = await readFile(path.join(taskDir, "handoffs", handoffs[0]), "utf8");
  assert.match(handoff, /Prepare release/);
  assert.match(handoff, /Keep adapter config generic/);
  assert.match(handoff, /release checked/);
});

test("review runs multiple configured agents and writes a review index", async () => {
  const cwd = await makeWorkspace();
  await run(["init", "Compare agent opinions"], cwd);

  const agentA = path.join(cwd, "agent-a.mjs");
  const agentB = path.join(cwd, "agent-b.mjs");
  await writeFile(agentA, "console.log('A reviewed');\n", "utf8");
  await writeFile(agentB, "console.log('B reviewed');\n", "utf8");

  await writeFile(
    path.join(cwd, ".agent-bridge", "agents.json"),
    JSON.stringify(
      {
        agents: {
          a: { command: "node", args: [agentA], promptMode: "stdin" },
          b: { command: "node", args: [agentB], promptMode: "stdin" }
        }
      },
      null,
      2
    ),
    "utf8"
  );

  const result = await run(["review", "Find blind spots", "--agents=a,b"], cwd);
  assert.match(result.stdout, /Review written:/);

  const state = JSON.parse(await readFile(path.join(cwd, ".agent-bridge", "state.json"), "utf8"));
  const taskDir = path.join(cwd, ".agent-bridge", "tasks", state.activeTask);
  const runs = await readdir(path.join(taskDir, "runs"));
  const reviews = await readdir(path.join(taskDir, "reviews"));

  assert.equal(runs.length, 2);
  assert.equal(reviews.length, 1);

  const review = await readFile(path.join(taskDir, "reviews", reviews[0]), "utf8");
  assert.match(review, /Find blind spots/);
  assert.match(review, /a/);
  assert.match(review, /b/);
});

test("commands fail clearly before initialization", async () => {
  const cwd = await makeWorkspace();
  const error = await runFail(["agents"], cwd);

  assert.equal(error.code, 1);
  assert.match(error.stderr, /not initialized/i);
});

test("ask fails for unknown agents without creating a run", async () => {
  const cwd = await makeWorkspace();
  await run(["init", "Unknown agent"], cwd);

  const error = await runFail(["ask", "missing", "hello"], cwd);
  assert.equal(error.code, 1);
  assert.match(error.stderr, /Unknown agent/);

  const state = JSON.parse(await readFile(path.join(cwd, ".agent-bridge", "state.json"), "utf8"));
  const runs = await readdir(path.join(cwd, ".agent-bridge", "tasks", state.activeTask, "runs"));
  assert.equal(runs.length, 0);
});

test("non-zero agent exits are recorded and surfaced as failures", async () => {
  const cwd = await makeWorkspace();
  await run(["init", "Failing agent"], cwd);

  const failingAgent = path.join(cwd, "failing-agent.mjs");
  await writeFile(
    failingAgent,
    "console.error('intentional failure'); process.exit(7);\n",
    "utf8"
  );
  await writeFile(
    path.join(cwd, ".agent-bridge", "agents.json"),
    JSON.stringify({ agents: { failing: { command: "node", args: [failingAgent], promptMode: "stdin" } } }, null, 2),
    "utf8"
  );

  const error = await runFail(["ask", "failing", "trigger failure"], cwd);
  assert.equal(error.code, 7);
  assert.match(error.stderr, /intentional failure/);
  assert.match(error.stderr, /Agent exited with code 7/);

  const state = JSON.parse(await readFile(path.join(cwd, ".agent-bridge", "state.json"), "utf8"));
  const runsDir = path.join(cwd, ".agent-bridge", "tasks", state.activeTask, "runs");
  const runs = await readdir(runsDir);
  assert.equal(runs.length, 1);
  const runBody = await readFile(path.join(runsDir, runs[0]), "utf8");
  assert.match(runBody, /intentional failure/);
  assert.match(runBody, /Exit code: 7/);
});
