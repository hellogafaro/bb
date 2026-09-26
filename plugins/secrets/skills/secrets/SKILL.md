---
name: secrets
description: "When a task needs environment variables, tokens, API keys, certificates, private keys, SSH or PAM access, or Infisical projects, environments, folders, or secrets."
---

# Secrets live in Infisical

Infisical is the only secret store. Use the `infisical` MCP for discovery (projects, environments, folders, secret names) and authorized writes, and `bb secret` for repo linking, process injection, the user-typed form, and SSH/PAM. Never open Infisical in a browser, including login. If `bb secret status` reports something missing, report only that prerequisite and stop.

## Resolve scope before every read or change

1. **Repo or service** from the working directory, Git remote, metadata, and local docs.
2. **Project** from a verified `.infisical.json` (`bb secret status`) or the MCP project listing. Never guess. Link an unlinked repo with `bb secret link --project-id ID --env ENV`.
3. **Environment** from the task or deployment context. Always pass `--env`; never rely on a default.
4. **Path** as narrow as possible (`--path /service`). Ask one focused question only if scope stays materially ambiguous.

## Use secrets without seeing them

Prefer injection over reads:

```bash
bb secret run --env prod --path /api -- pnpm start
```

Use `--project-id` only when the directory is unlinked. Use `--recursive` only when required. Do not do bulk reads, `infisical export`, or persistent `.env` files when injection works.

## Write secrets

Prefer scoped MCP writes with explicit project, environment, and path. When the value must come from the user, batch every known name into one masked form:

```bash
bb secret set STRIPE_KEY RESEND_KEY --env dev --path /api \
  --purpose "Configure the API" --describe STRIPE_KEY "Stripe secret key"
```

The user types the values; they reach `infisical` through 0600 temp files that are deleted at once. Trust the returned names, project, env, and path. Never ask the user to paste a secret into chat. Verify scope and authorization before deleting or rotating anything.

## SSH and PAM

Prefer short-lived access: `bb secret ssh HOST --login-user USER --out-file-path PATH` or `bb secret pam folder/account -- COMMAND`. Load keys into the process or `ssh-agent`; create a file only when required, owner-only, and delete it immediately. Interactive sessions need the host's own TTY.

## Never expose a value

Never print, echo, `cat`, summarize, or dump values: no bare `infisical secrets`, no `infisical export` to stdout, no `env` or `printenv`, no shell substitution into argv, no tracing, source, commits, issues, or docs. Report only names, verified scope, and results.

Command details: [references/cli.md](references/cli.md).
