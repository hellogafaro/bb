# bb secret command reference

Every command runs `infisical` on the server host from the invoking working directory. Add `--json` to `status`, `link`, and `set` to get failures as a JSON envelope; their success line is always JSON. Values never appear in argv, output, or the transcript.

## status

```bash
bb secret status
```

Prints `installed`, `version`, `authenticated`, `authMethod` (`profile` or `token`), `domain`, `linkedProjectId`, `projectFile`, and `missing` (the prerequisites to report when something is absent).

## link

```bash
bb secret link --project-id ID --env ENV
```

Verifies access with a names-only folder listing for the project and environment, then writes `.infisical.json` (`workspaceId`, `defaultEnvironment`, `gitBranchToEnvironmentMapping`) exactly as `infisical init` would. Fails if the directory is already linked to another project. Prints the project id, env, file, and top-level folder names.

## run

```bash
bb secret run --env ENV [--path PATH] [--project-id ID] -- COMMAND...
```

Runs `infisical run --env ENV --path PATH [--projectId ID] -- COMMAND...` and returns the command's exit code and output. `--env` is required. `--path` defaults to `/`.

## set

```bash
bb secret set NAME... --env ENV [--path PATH] [--project-id ID] \
  [--purpose TEXT] [--describe NAME TEXT]...
```

Opens a masked form in the thread showing the project, environment, path, purpose, and one field per name. Must run from a bb thread; the project comes from `--project-id` or the linked `.infisical.json`. After submission each value is written to a 0600 file in a private temp directory, passed to `infisical secrets set NAME=@FILE ...`, and the directory is removed before the command returns. Prints `project`, `env`, `path`, `names`, `created`, `updated`, and `unchanged`. Errors from infisical are forwarded with anything after `=` removed on lines that mention a requested name.

## ssh

```bash
bb secret ssh HOST [--login-user USER] [--out-file-path PATH] [-- INFISICAL_FLAGS...]
```

Runs `infisical ssh connect --hostname HOST ...`. Without `--out-file-path` Infisical opens an interactive session, which needs the host's TTY and cannot complete through bb; issue credentials to a file for your own client instead and delete them afterwards.

## pam

```bash
bb secret pam folder/account [--duration 30m] [--reason TEXT] [-- COMMAND...]
```

Runs `infisical pam access folder/account ...`. Pass a command after `--` to run it and exit; interactive shells need the host's TTY.
