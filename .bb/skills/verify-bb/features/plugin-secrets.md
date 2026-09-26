# Infisical secrets

Status: **not yet audited after the Infisical rewrite**. The rows below replace the dotenv recipes; run them against a disposable Infisical project and environment only.

## Setup and entry points

`bb secret` in a synthetic thread with a fake `infisical` binary on PATH or a disposable Infisical project. Enter only dummy values; never read real credentials into agent context. The plugin runs `infisical` on the server host from the invoking working directory.

Use the main skill’s isolated targets and evidence rules. A plugin can be present
in this checkout but disabled in an installation. Enable it only in the test
store before checking its surfaces. Read its current command/schema definitions
from the source below; CLI references use the matching source CLI described in
SKILL.md. Inspect nested `--help` before selecting flags and IDs.

## Source

- `plugins/secrets/package.json`
- `plugins/secrets/src/server.ts`
- `plugins/secrets/src/infisical.ts`
- `plugins/secrets/app.tsx`
- `plugins/secrets/skills/secrets/references/cli.md`

## Feature recipes

| Feature | Drive | Observable success |
| --- | --- | --- |
| Instruction | Start a thread and inspect the injected instructions. | The two-line Infisical router appears verbatim and points at the `secrets` skill. |
| Status | Run `bb secret status` in linked and unlinked directories. | JSON reports installed, authenticated, auth method, linked project id, and `missing`; no email or token appears. |
| Link | Run `bb secret link --project-id ID --env ENV` against the disposable project, then against a bad id. | Success writes `.infisical.json` with workspaceId and defaultEnvironment; failure writes nothing and forwards the infisical message. |
| Run | Run `bb secret run --env ENV -- sh -c 'test -n "$DUMMY"'`. | The command sees the injected variable; bb prints only the command's own output. |
| Set form and labels | Run `bb secret set DUMMY --env ENV --path /qa --purpose ...` and inspect the card. | The form shows project, environment, folder, purpose, and a masked field per name. |
| Reveal, submit, cancel | Toggle reveal, submit a dummy value, then cancel another request. | Only submission calls infisical; transcript keeps names and scope, never the value; the temp directory is gone afterwards. |
| Error redaction | Point the fake binary at a failing `secrets set` that echoes the value. | The forwarded error shows `NAME=[redacted]`. |
| ssh and pam | Run `bb secret ssh HOST --out-file-path PATH` and `bb secret pam folder/account -- true` with the fake binary. | argv maps to `infisical ssh connect` and `infisical pam access`. |

## Evidence and cleanup

Record each row’s UI/tool/CLI action and observed result separately. Inspect the
registered plugin command and SDK call before claiming agent parity. Preserve
failed attempts and missing prerequisites as unverified results. Remove the
disposable project link, dummy secrets, and any issued credential files.
