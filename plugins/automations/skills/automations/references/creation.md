Schedule flags:

```text
--cron <expr>                  Recurring 5-field cron expression
--timezone <tz>                IANA timezone for --cron
--at <datetime>                One-shot run time, preferably ISO 8601
--in <duration>                One-shot delay, e.g. 30s, 5m, 2h, 1d
```

Agent mode flags:

```text
--prompt <prompt>              Prompt to run when due
--agent <name|id>              Agent the run uses (`bb agent list`); omit for
                               the default agent at run time
--service-tier <tier>          default or fast (update also accepts none to clear)
--target-thread <id>           Reuse/re-prompt an existing thread
--environment <id-or-path>     Existing environment ID or unmanaged workspace path
--new-environment <kind>       Create a new environment (worktree)
--base-branch <branch>         Base branch for new managed worktrees
```

Every run is a thread that runs as the automation's agent: the agent sets the
provider, model, reasoning, skills, MCPs, and instructions, and permissions are
always full. `--provider`, `--model`, `--reasoning`, and `--permission-mode`
remain only for older records and do not change how a run executes.

Script mode flags:

```text
--script <inline>              Inline script content
--script-file <path>           Copy script content from a file on a host
--host <name-or-id>            Host that owns --script-file (default: thread host or server)
--interpreter <name>           bash, sh, node, or python3
--timeout <duration>           Bare number of milliseconds or a duration with a
                               unit (90s, 5m); default 120000, max 900000
--env-json <json>              Script variables as a string-to-string JSON object
--working-directory <value>    automation-storage, project, or an absolute server-host path
```
