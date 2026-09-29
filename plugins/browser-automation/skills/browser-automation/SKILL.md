---
name: browser-automation
description: Use the Browser Automation BB plugin to inspect and automate persistent browser pages in an explicit desktop or local headless session. Use for browser navigation, snapshots, clicking, forms, and verification screenshots.
---

Use `bb browser-automation`. Open one session, retain its session ID, then inspect,
act, and verify in short scripts.

`--machine` accepts an exact host ID or an unambiguous machine name. Exact IDs
take precedence over names; unknown or ambiguous names fail before opening a session.

Choose `--backend local --headless --machine <host-id>` for headless Chrome on
an enrolled host. Choose `--backend desktop --machine <host-id> --desktop
<instance-id>` for a new dedicated desktop automation tab. Starting desktop
control opens the side panel and selects the browser tab only if its thread is
already focused. New or activated controller pages follow the same rule;
automation does not switch threads or bring the desktop window forward. While
controlled, a desktop tab never takes keyboard focus from the composer or other
apps; the user presses Take over to type into it. Headless sessions remain headless.
Plugin-owned local/headless Chrome launches with `--no-sandbox`, disabling Chrome's
sandbox. Desktop attachment does not change the browser's launch flags.
Resolve the explicit instance with `bb browser instances --host <host-id> --json`
first. Never silently choose a different host, mode, or login profile.
Adding `--tab <tab-id>` hands off an existing tab and its profile's logged-in
authority; do so only when the user asked to use that tab. The CLI uses the
current thread, or `--thread <id>` outside a thread. Each session belongs to
that thread.

CLI opening:

```sh
bb browser-automation open --backend local --headless --machine <host-id> --json
bb browser-automation open --backend desktop --machine <host-id> --desktop <instance-id> --json
```

For a multi-step task described in words ("search this site for X and report the price"), prefer `do`: it
runs a fast Jev decision loop that observes the page, picks the next click/fill/select/press_key/scroll/goto
step, and repeats until the goal is done, blocked, or the step limit is reached. It needs an OpenRouter API
key configured on the server; it fails fast with a clear error otherwise.

```sh
bb browser-automation do <session-id> "search for wireless mice and report the top result's price" --json
bb browser-automation do <session-id> "log the page title after navigating to https://example.com" --max-steps 6 --json
```

`do` returns `{state, answer, steps, image}`: `state` is `done`, `blocked`, or `max_steps`; `answer` is the
model's final answer to the goal; `steps` lists each action taken (`{index, action, target, outcome}`);
`image` is a screenshot of the final state, in the same `{path, mimeType, width, height}` shape as `run`.
Read the image the same way as a `run`/`screenshot` capture. `do` always drives the named page `"main"`,
navigating it as needed; use `run` on a different named page if you need to keep `main` untouched.

For a precise, scripted check where you already know the exact steps or need a specific extracted value,
use `run` instead:

```sh
bb browser-automation run <session-id> --script 'const p = await browser.getPage("main"); await p.goto("https://example.com"); await p.snapshot()' --json
bb browser-automation run <session-id> --script 'const p = await browser.getPage("main"); await p.click("ref/e6"); await p.snapshot()' --json
bb browser-automation screenshot <session-id> --page main --json
```

Take a fresh snapshot before using refs after navigation or document changes.
Use refs from that session's DevBrowser snapshot. Do not mix agent-browser refs
or invent selectors. Prefer a cheap URL/text/snapshot check after each action;
request a screenshot when visual verification matters. Use
`await p.shot({type:"jpeg",maxEdge:960,quality:70}); undefined` inside scripts to
return a bounded JPEG file.

When a site needs credentials, use `fill-login` instead of asking the user for
a password in chat. It opens a masked form; the user types the values there
and they go straight into the page fields over CDP. The values never reach
you: `fill-login` returns only `{"filled":true,"fields":[...names]}`, never
the values themselves. Never ask the user to paste a password into the
conversation, and never try to read a filled field back (no
`page.$eval`/`page.evaluate` on the filled selector, no screenshot that would
reveal it, no logging it) — that would defeat the point.

```sh
bb browser-automation fill-login <session-id> --page main --username-selector "#email" --password-selector "#password" --submit-selector "button[type=submit]" --label "GitHub login" --json
bb browser-automation fill-login <session-id> --page main --username-selector "#email" --password-selector "#password" --otp-selector "#otp" --submit-selector "button[type=submit]" --label "GitHub login with 2FA" --json
```

Selectors are plain CSS selectors on the named page (not snapshot refs); find
them with a snapshot first if you are not sure of the form's structure.
Accepts `--page` (default `main`), an optional `--submit-selector` clicked
after filling, and an optional `--otp-selector` for a combined login+2FA form.

`run` and `screenshot` return JSON with `hostId` and `images`, where each image
has `path`, `mimeType`, `width`, and `height`. The path is in the browser session's
temporary directory on that host. Use your image-reading tool on the path when
you are on the same machine. If the browser host differs, fetch the image to
local temporary storage first (substitute the returned path and host ID):

```sh
bb file read '<image-path>' --host '<host-id>' --json | node -e '
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const file = JSON.parse(fs.readFileSync(0, "utf8"));
if (file.contentEncoding !== "base64") throw new Error("Expected binary image");
const destination = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "browser-image-")), "capture.jpg");
fs.writeFileSync(destination, Buffer.from(file.content, "base64"), {mode: 0o600});
console.log(destination);
'
```

Read the printed local path with your image-reading tool. Do not print base64
image bytes into the conversation. Read or copy captures before closing the
session: cleanup removes its temporary directory. Remove local copies when
finished.

A local headless `open` returns a `previewDirective`, for example
`::browser-preview{session="<session-id>"}`. Copy it into your next message
exactly once as a standalone line, before you continue working. Do not wrap it
in backticks or a code fence, and do not invent or edit the session ID. BB
renders it as a live view of that browser in the chat, which the user can
expand, so they can watch while you work. Desktop
sessions return no directive; that browser is already visible in the side
panel. `bb browser-automation preview <session-id> --json` reports the live
frame's `url`, `title`, size, and `sequence` without image bytes; it is not a
substitute for `screenshot` when you need to see the page.

`pages` lists persistent pages. Runs serialize within a session. Scripts are
trusted JavaScript with Puppeteer-style DevBrowser APIs, not a sandbox.
`--script-file` requires `--script-host <host-id>` naming the source host explicitly. Browser file
operations and `localhost` refer to the browser host. Transfer files explicitly.

Stop cancels running and queued work and releases desktop control. Cancellation
and timeout stop the session too; open a new session to resume. Close disposes
owned Chrome and plugin-created desktop tabs while preserving handed-off tabs.
Close sessions after use. Five-minute idle and thirty-minute absolute expiry
apply. Timeouts default to 30 seconds, maximum 120 seconds: pass either
`--timeout-ms <1000-120000>` or `--timeout <duration>`, where a duration carries
a unit (`90s`, `2m`, `1500ms`) and a bare number is read as seconds (1-120) or
milliseconds (1000-120000).

A run may return at most 4 screenshots, JPEG only, 500 KB combined; a larger or
differently encoded capture fails the run. `bb browser-automation --help` and
`bb browser-automation <command> --help` print every flag with these limits.
Unknown commands and flags fail with a suggestion, and with `--json` a failure
prints `{"ok":false,"error":{"code":…,"message":…,"hint":…}}` on stdout (code
`session_unavailable` when the session stopped or expired, `screenshot_limit`
for capture limits) while the same message stays on stderr.

An unavailable backend or a failed runtime install is an actionable setup
error, not permission to attach to a random browser. The first open on a host
installs the pinned `dev-browser` npm release into plugin-owned host storage
there and verifies its provenance and digest; it needs npm, network access, and
Chrome on that host, and can take a minute. Later opens reuse the verified
install offline. The exact pin and Chrome setup are documented in the plugin
README. Cloud browsers and arbitrary CDP endpoints are unsupported.
