# Browser Automation for BB

Thread-owned browser scripts, desktop attachment, and local headless Chrome
on enrolled hosts. Requires the public
`bb.sdk.experimental_desktopBrowsers` API (SDK 0.4.48 or newer).

Browser Automation is optional and disabled by default. Enable it in plugin
settings when you want to use it.

The plugin was scaffolded with `bb plugin new browser-automation`. It has server, host,
app, CLI, RPC, and a bundled skill. Agents use the CLI through the skill. Screenshot
commands return temporary JPEG file paths and the browser host ID. Local headless
sessions show a live preview inline in the chat that expands into a lightbox; see
[Live preview](#live-preview). Screenshot cards and a screenshot sidebar viewer are not included. Cloud provisioning and arbitrary CDP endpoints are excluded.

## Runtime installation and provenance

The DevBrowser runtime is installed automatically on the **selected browser
host** the first time a session is opened there. Nothing is installed on the
server or on the invoking agent's machine, and the user's global npm
installation is never touched. `runtime-pin.ts` pins one exact npm release:

| Field        | Value                                                               |
| ------------ | ------------------------------------------------------------------- |
| package      | `dev-browser@1.0.0-rc.3` from `registry.npmjs.org`                  |
| repository   | [SawyerHood/dev-browser](https://github.com/SawyerHood/dev-browser) |
| tag / commit | `v1.0.0-rc.3` at `a25e7672e199153b2f5b52a841a62436a28d925f`         |
| linux-x64    | `390dd08f8321807bca2e1e060ec031511adb0af002e871dfde3b1f6c8feac914`  |
| linux-arm64  | `8a1d7c80c3bede69809996848526b5ed43cf6f0965d87f99e4349b775f76042e`  |
| darwin-x64   | `76f70f6e8a48c5caf546003e09d9daa4a0cb756d191c4f7fc3c300c2e2935522`  |
| darwin-arm64 | `d68887f7df149915811bf362b208377c2d0d7d500297d4d5977dab129db5b5eb`  |

The digests are the SHA-256 values published in that release's `SHA256SUMS`.
The pin never follows the `next` or `latest` dist-tags and never falls back to
another version. Windows has no upstream artifact and is refused.

On the browser host the installer (`installer.ts`, run inside the plugin host
worker) performs these steps under
`<plugin host dataDir>/runtime/npm/`, a directory owned by the plugin:

1. Locate `npm` on the host worker's `PATH`; a missing npm is a clear error
   naming the host requirement. npm 9.5 or newer is required for attestation
   checks.
2. `npm install --ignore-scripts` of the exact version from the pinned
   registry (passed explicitly, so a host `.npmrc` mirror cannot substitute
   it) into a private staging directory with a plugin-owned npm cache. The
   package's own postinstall is never run, and the resolved tarball URL must
   come from the pinned registry.
3. `npm audit signatures --json` must exit zero with no invalid or missing
   signatures. The SLSA provenance attestation is then fetched from the
   registry: its subject digest must equal the installed tarball integrity and
   its workflow must name the pinned repository at tag `v<version>`.
4. Download `dev-browser-<platform>` and `SHA256SUMS` from the GitHub release
   for that tag into the package's `bin/dev-browser-bin`, the location the
   package's own shim expects. The stream digest must equal the pinned
   digest, and `SHA256SUMS` must agree, before the file is used.
5. Run `dev-browser-bin --version` and require the pinned version, write
   `verified.json`, and atomically rename the staging directory to
   `runtime/npm/dev-browser@<version>/`.

Warm starts read `verified.json`, re-hash the binary, and use it without npm or
network access; a tampered or missing binary triggers a fresh install. A lock
file, created atomically with the installer's PID, serializes concurrent
installs across worker processes; in-process callers share one job. Locks
whose owner process is gone are reclaimed only after re-checking their
identity, and staging directories are scoped per package version. An interrupted or failed install removes its staging directory
and leaves no partial runtime; the next open retries. When no session is
waiting on an install for 15 seconds, the install is cancelled.

Because a first install can exceed the 30-second host RPC deadline, the server
polls the host's `prepare` RPC, which long-polls the shared install job and
reports progress, before calling `open`.

### No fallback

A platform without a recorded digest fails with an explicit error; the plugin
never falls back to another version, a `PATH` binary, or the older pre-release
integration build. The `smoke` task takes an explicitly provided binary and
labels it `developer-artifact`; that source exists only for fixtures and is
never chosen automatically. The upstream MIT license is preserved in
`DEVBROWSER-LICENSE`.

### Bumping the pin

1. Wait for the upstream tag workflow to publish both the npm version and the
   GitHub release; merging alone publishes nothing.
2. Fetch `https://github.com/SawyerHood/dev-browser/releases/download/v<version>/SHA256SUMS`
   and copy the four digests into `runtimeRelease.artifacts`.
3. Confirm `npm view dev-browser@<version> gitHead` matches the tag commit.
4. Run `pnpm exec turbo run smoke:install --filter=bb-plugin-browser-automation` on a
   Linux and a macOS host.

Headless sessions need Chrome/Chromium on that host. The plugin checks
`<plugin host dataDir>/runtime/chrome`, the standard macOS Chrome path, then
`google-chrome`, `google-chrome-stable`, `chromium`, and `chromium-browser` on
PATH. The `runtime/chrome` entry can be a symlink to an installed executable.
Plugin-owned local/headless Chrome always launches with `--no-sandbox`, disabling
Chrome's sandbox so it can run on hosts that restrict unprivileged user namespaces.
Desktop sessions attach to an existing browser and do not change its launch flags.

## CLI and agent workflow

Choose both the backend and its host explicitly. There is no silent fallback or
profile migration. Find desktop instances through BB's core desktop-browser
CLI/SDK discovery. The selected instance's generation is resolved on opening.

```sh
bb browser-automation open --backend local --headless --machine <host-id> --json
bb browser-automation open --backend desktop --machine <desktop-host-id> --desktop <instance-id> --json
bb browser-automation list --json
bb browser-automation run <session-id> --script 'const p = await browser.getPage("main"); await p.goto("https://example.com"); await p.snapshot()' --json
bb browser-automation run <session-id> --script-file ./check.js --script-host <invoking-host-id> --timeout-ms 30000 --json
bb browser-automation do <session-id> "search this site and report the top result" --max-steps 20 --timeout-ms 120000 --json
bb browser-automation pages <session-id> --json
bb browser-automation screenshot <session-id> --page main --json
bb browser-automation preview <session-id> [--after <sequence>] --json
bb browser-automation fill-login <session-id> --page main --username-selector <sel> --password-selector <sel> [--otp-selector <sel>] [--submit-selector <sel>] [--label "GitHub login"] --json
bb browser-automation stop <session-id> --json
bb browser-automation close <session-id> --json
```

`fill-login` asks the user for credentials through a masked form
(`bb.ui.requestInput`, the same pattern as the Secrets plugin) and fills the
submitted values into the named page's fields over CDP using plain CSS
selectors: a username, a password, and an optional one-time code field for a
combined login+2FA form. The values never reach the agent, the transcript, the
tool result, or logs: the command returns only `{filled: true, fields:
[...names]}`. Core additionally redacts any `sensitiveFields` a plugin's
`requestInput` call declares from the pending interaction's persisted row and
its timeline description, in case a plugin's own `describeSubmission`
carelessly echoes a value; this plugin declares its submitted field names as
sensitive, and the Secrets plugin does the same for the values it collects.

Outside a thread, supply `--thread <thread-id>`. Calls from an existing thread
cannot override its ownership. `--script-file` requires `--script-host <host-id>` naming the source host
explicitly and is read through `bb.sdk.files`, then transferred as script text to the
browser host. Relative paths use the invoking CLI working directory. Browser
file reads/writes still occur on the browser's host; scripts are not run in the
workspace directory.

Desktop sessions create a tab in a dedicated, project-scoped automation
profile: every automation tab for threads in the same project shares one
Electron session partition (`persist:bb-browser-automation-<hash>`, keyed by
project ID), so its cookies, localStorage, and IndexedDB persist across
sessions and app restarts the same way a personal Chrome profile would.
Acquiring control opens the side panel and selects its browser tab only when
the owning thread is already focused. New or activated controller pages
follow the same rule. Automation does not switch threads or bring the desktop
window forward. While controlled, a desktop tab never takes keyboard focus
from the composer or other apps; press Take over to type into it, complete a
captcha, or handle a passkey button through the "Continue in your browser"
handoff prompt (the in-app browser has no native WebAuthn UI), then press
Take over again to give control back. Pass
`--tab <tab-id>` only for an explicit handoff of an existing tab. This grants the
existing profile's browsing authority, including its authenticated cookies;
release preserves that tab and login. Plugin-created tabs in its dedicated
profile are disposed by `close`. `stop` releases control and preserves desktop
tabs, including plugin-created ones, until close or cleanup.

Local sessions own a Chrome process and a persistent, project-scoped profile:
every local session for a project reuses that project's one Chrome profile on
the selected host (under the plugin's host data directory), so cookies,
localStorage, and IndexedDB survive `stop`, `close`, and later sessions with
no flag to set. Only one session may hold that profile at a time; opening a
second session for the same project on the same host while one is already
running fails with a clear error naming the conflict. Each session still owns
a fresh `DEV_BROWSER_HOME` and socket under the worker's temporary directory
for its own daemon and capture files, separate from the persistent profile
directory. `stop`, timeout, or cancellation terminates that local session and
releases the profile; open another session to resume. `close` disposes its
processes and session directory, leaving the profile's cookies in place.
Desktop handoff tabs remain open. Sessions expire after 30 minutes, with
five-minute idle cleanup; active scripts do not count as idle. Archiving,
deleting, or failing a thread closes its sessions; normal idle turns preserve
them. Externally invoked CLI runs remain subject to the same per-run timeout
and absolute session expiry. Run timeouts default to 30 seconds and are
bounded to 1–120 seconds. Runs are serialized per session.

## Interactive takeover

A local headless session's live preview lightbox (below) can become
interactive: pressing **Take over** forwards the lightbox's mouse, keyboard,
and scroll events to the real page over CDP (`Input.dispatchMouseEvent`,
`Input.dispatchKeyEvent`, `Input.insertText`), the same way a person would use
a real browser, so they can type a 2FA code, solve a captcha, or otherwise act
where the agent cannot. Neither backend can complete a native passkey or
QR/hybrid WebAuthn prompt in-session: headless Chrome has no Bluetooth
proximity on the machine running the browser, and BB's in-app desktop browser
(Electron) has no native WebAuthn UI at all. In the desktop backend, a passkey
button instead shows an in-tab "Continue in your browser" prompt so the user
can finish the passkey in their real system browser and bring the sign-in
back; press Take over and click the button to trigger it.
Runs on that session (`run`, `pages`, `screenshot`)
pause automatically while a person holds control, backed by the same
control-gate pattern used for the Computer tab's human-control stream
(`control-gate.ts`), and resume once **Give back control** releases it. There
is no agent-facing "ask for control" command: when an agent needs a person to
complete a step it cannot, it asks the user directly (with its standard
question tool) to open the live preview and press Take over, then retries
once they are done.

DevBrowser scripts are trusted code, not a security sandbox. Script output is
bounded to 512 KB before parsing and 160,000 text characters after parsing.
Up to four JPEGs fit within a combined 500 KB budget. Image file paths
must resolve inside that session's capture directory; oversized files and
escaping symlinks fail. CLI `run` and `screenshot` JSON returns `hostId` plus
`images: [{path, mimeType, width, height}]`, without inline image bytes. Paths
are in the browser session's temporary directory on the selected host. Agents
read them directly on that machine, or use `bb file read <path> --host <host-id>
--json` to fetch a remote image and decode its base64 content to a local temporary
JPEG. The bundled skill includes a copy-pasteable command. Read or copy captures
before closing the session; cleanup removes them. Endpoints and connection
credentials are removed from structured script text and never included in
session records or CLI session results.

The CLI uses the same validated operation handlers as RPC. The
RPC contract in `contracts.ts` exposes `open`, `list`, `run`, `do`, `pages`,
`screenshot`, `preview`, `fillLogin`, `stop`, and `close` to both the CLI and the app;
`takeover`, `release`, and `input` are RPC-only, used by the live preview
lightbox to let a person hold and use interactive control (see "Interactive
takeover" above).
RPC inputs include `threadId`; session operations also include `sessionId`.
`open.selection` is `{backend:"local",hostId}` or
`{backend:"desktop",hostId,instanceId,tabId?}`. A tab ID is an explicit handoff.
Agents discover the commands through the skill and CLI help.

## Goal-driven automation (`do`)

`bb browser-automation do <session-id> "<natural-language task>"` drives the session's `"main"` page toward
a goal with a fast Jev decision loop, instead of a hand-written script. Each step runs one DevBrowser script
that both performs the previous step's action (click, fill, select, press_enter, scroll_down, scroll_up, or
goto by ref) and takes a fresh interactive ARIA snapshot plus the page's visible text for the next decision,
so acting and observing cost one script run per step rather than two. The plugin's only OpenRouter call is
`POST https://openrouter.ai/api/alpha/decisions` (`jev.ts`, `TypeSafeDecisionsJevProvider`), which runs
TypeSafe's Jev model directly, pinned to the plugin constant `typesafe/jev-1.13` with no chat model, no other
OpenRouter endpoint, and no environment override. One request per step asks the operation choice (click,
fill, select, press_enter, scroll_down, scroll_up, goto, done, or blocked), a `click_target`/`fill_target`/
`select_target` choice for each compatible operation, built from the snapshot's refs as
`id -> "role: name (value)"` and capped around 240, plus two "noul" (probability) heads: `submit` (press
Enter right after a fill) and `goal_complete_after` (speculative completion — when its probability clears
0.7, the loop executes that action, re-observes, and finishes without another decision call). The Decisions
API returns choices only, never free text, so fill values and goto URLs are resolved locally from candidates
extracted from the goal (quoted strings, text after type/enter/search for/fill, the text after a colon, and
literal `https://` URLs) and offered as `fill_text`/`goto_url` choice heads; when the chosen candidate is
"none" the step ends `blocked` with a clear reason instead of guessing. The final answer on `done` is
resolved the same way: an `answer_evidence` head offers the page title, the visible text split into short
sentence/line segments, and short phrases synthesized from element state (`"checkbox 1 checked"`,
`"combobox 1: Option 2"`, since checked/selected/value state never appears in visible text), and the chosen
segment is returned verbatim — the calling agent phrases the final prose. The shared `elements` state table
(role/name/value/checked/selected/disabled per ref, the same data behind those synthesized segments) is
visible to every question, including the operation choice, so an already-satisfied checkbox or a `<select>`
that already holds the right option is legible to the model instead of only to the target head. `select`
executes by matching the option's visible text against `<option>.textContent`, since Puppeteer's
`page.select()` matches the HTML `value` attribute, not the label text Jev is given. When a target head
answers "none" for an operation that needs a target, the step is re-asked once with that outcome recorded in
recent_outcomes before treating it as invalid. After each action the loop settles briefly (about 50ms, 200ms
after a fill) and waits for the page to finish loading only when the URL actually changed, instead of an
unconditional fixed wait. A malformed/invalid Decisions API answer or a timed-out decision call (about 10s)
is retried once; if the retry also fails, the step degrades to `blocked` instead of throwing and losing the
whole run. The API key is the shared `OPENROUTER_API_KEY`; `do` fails fast with a clear error when it is
unset. The loop stops at `--max-steps` (default 20, max 40) or `--timeout-ms` (default 120000, max 300000),
whichever comes first, and every step script runs through the same `run` handler as scripted `run` calls, so
it shares session run serialization, per-run error handling, and cancellation with the rest of the plugin.
The result is `{state, answer, url, title, steps, image, costUsd, model}`: `state` is `done`, `blocked`, or
`max_steps`; `url`/`title` are the page's final state; `steps` is one entry per action taken; `image` is a
final JPEG screenshot in the session's capture directory, read the same way as `run`/`screenshot` output;
`costUsd` sums each decision call's reported `usage.cost`; `model` is the Jev model used. Prefer `run` when
the exact steps or an exact extracted value are already known; `run`'s scripts and serialization are
unchanged by this feature.

The host supervises Chrome and the DevBrowser daemon as separate children. Each
child owns a process group. Closing the worker pipe also stops those groups, so
a worker crash does not leave browsers running. Stop sends TERM then KILL after
1.5 seconds. The plugin does not discover or kill processes from PID files.
Server metadata persists ownership and cleanup needs; restart reconciles active
sessions and revokes their desktop leases. Unreachable desktop cleanup remains
recorded for reconciliation on a later plugin load. Desktop lease loss is
observed using the public SDK subscription; core revokes the CDP endpoint
immediately, and the plugin stops its worker session when notified.

## Live preview

Opening a local headless session returns a `previewDirective` in the CLI
result, `::browser-preview{session="<session-id>"}`. The plugin's agent
instructions tell the agent to paste it once, as a standalone line, in its next
message. BB renders that line inline in the chat as a live thumbnail of the
browser with the page title, location, and a Live, Ended, or Unavailable state.
The card collapses, and its expand button opens the same live view in a
lightbox sized to the window; on compact screens the lightbox is the shared
responsive drawer. The lightbox is mounted once per window as an app overlay,
not inside the card, so it stays open and live when the timeline paginates the
card away. Desktop sessions return no directive and never preview: that
browser is already visible in the app's side panel, and its brokered connection
is not reused for previews.

Frames come from a second, read-only CDP connection that the host worker opens
to the session's own Chrome (`preview.ts`). It runs `Page.startScreencast` as
JPEG at about four frames per second, at most 800 pixels on the long edge for
thumbnails. While a lightbox requests `size: "full"` it recasts the same page at
up to 1280 pixels, the headless window's width, and returns to thumbnails ten
seconds after the last full-size request. It casts only while something is
watching: the connection closes after 15 seconds
without a request and reopens on demand. It previews the page that navigated
most recently, preferring any page over `about:blank`, so it follows the named
page a script is driving. Previews never enter the per-session run queue, so
they keep updating while a script runs and never delay one.

The app long-polls the `preview` RPC with the last sequence it rendered and the
`size` it needs, `thumbnail` by default; the
server forwards to the host's `preview` RPC, which answers as soon as a newer
frame exists or after five seconds with `frame: null`. An inline card polls
only while the window is visible and it is expanded and scrolled into view, so
cards left behind in the chat history cost nothing. The lightbox opens from the
card's current frame and then runs its own poller; the card pauses its poller
while its session's lightbox is open. Preview requests are not
session activity: watching a preview does not postpone the five-minute idle
cleanup. When the session stops, closes, or expires, the card keeps its last
frame dimmed for as long as it stays mounted; a card first viewed after that
shows only its Ended header. A card whose session it can never read, such as a
directive copied into a forked thread, gives up after five failed requests.

`bb browser-automation preview <session-id> --json` reports the same live frame
as `{session, frame}` where `frame` has `sequence`, `mimeType`, `width`,
`height`, `url`, `title`, and `bytes`, or is `null` when nothing newer than
`--after` arrived. It omits the image bytes; use `screenshot` for a file.

## Validation

From the BB checkout, use Turbo:

```sh
pnpm exec turbo run test typecheck build --filter=bb-plugin-browser-automation
DEV_BROWSER_SMOKE_BINARY=/absolute/path/to/verified/dev-browser \
DEV_BROWSER_SMOKE_CHROME=/absolute/path/to/chrome \
pnpm exec turbo run smoke --filter=bb-plugin-browser-automation
DEV_BROWSER_SMOKE_CHROME=/absolute/path/to/chrome \
pnpm exec turbo run smoke:install --filter=bb-plugin-browser-automation
```

`installer.test.ts` drives the installer against a fake `npm` and a local
release server: exact-version install, provenance rejection, digest and
`SHA256SUMS` mismatches, warm reuse without npm or network, tampered-binary
reinstall, concurrent callers, stale locks, and cancellation cleanup.

`smoke:install` performs a real cold install of the pinned release from
npm and GitHub into a disposable data directory, then a warm resolve with no
npm on `PATH`, then drives real headless Chrome through the installed binary,
including a cross-origin iframe snapshot and a JPEG screenshot. It prints the
binary path, its SHA-256, and timings.

`smoke` takes an explicit binary and creates disposable directories and runs
real Chrome, without starting a BB core or using an existing browser profile.
It verifies named pages, navigation, clicking, JPEG bytes, a live preview that
follows a second named page while its script runs and switches to full-size
frames on request, serialization,
independent session cancellation, a synchronous infinite-loop timeout,
reopening, closing a runtime session (further runs are rejected), and
preservation of an attached browser and its page state after that session
closes.
Both smokes link directly to Chrome and exercise the production launch flags
without a wrapper. The attachment smoke also launches its separate browser
fixture with `--no-sandbox` so it works on hosts with restricted user namespaces.

Build with a current BB CLI: an older installed CLI can successfully bundle the
sources while stamping old SDK metadata. Inspect `dist/*.meta.json` before any
future installation or distribution. Generated bundles and declarations are
ignored. No plugin installation or live core is needed for these checks.
