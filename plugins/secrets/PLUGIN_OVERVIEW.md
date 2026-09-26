Every secret lives in Infisical. This plugin gives agents one way to use them: a two-line instruction that points at the `secrets` skill, the skill itself, and the `bb secret` CLI, which wraps the `infisical` CLI on the server host without ever handling a value on argv or in output.

## What you get

- A constant instruction in every thread: secrets live in Infisical, use the `secrets` skill, never expose a value.
- The `secrets` skill: resolve repo, project, environment, and the narrowest folder path; prefer injection over reads; write through the Infisical MCP or the masked form; keep SSH and PAM access short-lived; report only names, scope, and results.
- `bb secret status`, `link`, `run`, `set`, `ssh`, and `pam`, described in [the CLI reference](skills/secrets/references/cli.md).
- A masked form in the thread for `bb secret set`, showing the project, environment, folder path, purpose, and one field per name, with a show or hide control per field.

## How a write works

The agent runs `bb secret set STRIPE_KEY --env dev --path /api --purpose "Configure the API"` from inside a thread. The user types the values into the form. Each value goes into a 0600 file inside a private temp directory, `infisical secrets set STRIPE_KEY=@FILE` reads it, and the directory is deleted before the command returns. The agent receives the project, environment, path, and the names created, updated, or unchanged. Infisical errors are forwarded with anything after `=` removed on lines that mention a requested name.

## Requirements

- The `infisical` CLI installed on the server host and authenticated with a profile or `INFISICAL_TOKEN`. `bb secret status` reports what is missing; the agent reports only that prerequisite.
- `bb secret set` must run from a bb thread and needs a linked `.infisical.json` or `--project-id`.
- `--env` is always explicit. Nothing in this plugin defaults an environment.
- Interactive `ssh` and `pam` sessions need the host's own TTY; through bb use `--out-file-path` or a command after `--`.
