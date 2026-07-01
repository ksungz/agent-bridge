# Adapter Spec

Agent Bridge runs local command-line agents through adapter entries in `.agent-bridge/agents.json`.

## Shape

```json
{
  "agents": {
    "name": {
      "command": "agent-command",
      "args": ["--flag", "{{prompt}}"],
      "promptMode": "argument",
      "description": "Optional human-readable label",
      "timeoutMs": 600000,
      "env": {
        "OPTIONAL_ENV": "value"
      }
    }
  }
}
```

## Fields

- `command`: executable name or path.
- `args`: command arguments. `{{prompt}}` is replaced by the built task prompt.
- `promptMode`: `argument` or `stdin`.
- `description`: shown by `agent-bridge agents`.
- `timeoutMs`: optional per-agent timeout. Defaults to 10 minutes.
- `env`: optional environment variables merged into the spawned process.

## Prompt Modes

### argument

Use this when a CLI accepts the prompt as an argument.

```json
{
  "command": "gemini",
  "args": ["--prompt", "{{prompt}}"],
  "promptMode": "argument"
}
```

### stdin

Use this when a CLI reads the prompt from stdin.

```json
{
  "command": "node",
  "args": ["./tools/reviewer.mjs"],
  "promptMode": "stdin"
}
```

If `promptMode` is omitted and `args` contains `{{prompt}}`, Agent Bridge treats it as `argument`. Otherwise it uses `stdin`.

## Notes

- Agent Bridge does not manage provider authentication.
- Agent Bridge does not bypass subscription limits or provider policies.
- Agent Bridge records local process output; do not put secrets in prompts.
- Prefer read-only review prompts unless you explicitly want an agent to edit files.
- Provider CLIs may emit logs to stderr. Agent Bridge preserves those logs in run records.
- Test adapters with `agent-bridge ask <agent> "hello" --dry-run` first, then run a short real prompt.
