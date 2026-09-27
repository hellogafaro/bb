# One full run

Step 3 of [PLAN.md](../PLAN.md). A run takes a task from "work on this" to a delivered, approved, logged result without a standing PM agent, and survives restarts without duplicate work or sends.

## What a run is

A run is a BB workflow started from the task's project. Nothing else is needed: no run tables, no run service, no run-specific interaction kinds, no Runs page. The workflows plugin already provides hidden worker threads, replay of finished steps after a restart, structured results, a live run card and panel, and, since September 2026, two additions made for this plan:

- `agent(prompt, { agent: "cody" })` runs a worker as a named BB agent with its skills, MCPs, instructions, and model.
- `ask(prompt, { options, detail })` pauses the run for a human decision. The card appears on the visible run thread and in the inbox, push fires, a timeout or restart asks again, and an answered step replays from cache so it is never re-asked. The cached answer is keyed on the prompt and detail, so an edited update text invalidates its approval.

The six loops and the rules every agent follows live in the core operating model that BB injects into every thread (`packages/templates/src/templates/operating-model.md`). Agents carry identity and ownership only. Skills carry the tool-specific how: `tasks-operations` for Notion, `email-operations`, `summarize` for the handoff shape. The closing agent, Sidekick today, is the only writer of task state, tracked time, and outbound messages.

## Slice 1

Prove the loop end to end on one shape of work before generalizing.

- **Source:** a task link in the task system, Notion Tasks today, with a repository when the task is coding work.
- **Trigger:** "work on this <link>" in any thread. A `run` skill reads the task, picks the project, and spawns the visible origin thread that starts the named workflow. `bb workflows run --name one-full-run` from a thread in that project does the same by hand.
- **Channel:** the reply goes back as a comment on the task, and the task status and time are updated. Other channels come in step 4 of PLAN.md.
- **Work kinds:** coding tasks in a project checkout or worktree, and document or research tasks in a personal workspace.

## The script

`.bb/workflows/one-full-run.js` in each project that runs it, until the plugin also resolves names from the data dir. Steps, each a worker as the named agent, or an `ask()`:

1. Context: a small worker reads the task and returns the brief as structured output. Raises a decision through `ask()` when the outcome or repository is unclear.
2. Execute: the owning agent, Cody for code, in the project checkout. Returns the handoff: result, checks run, evidence, open issues, actual work time.
3. Review: a fresh worker, a different model when possible, read-only. Returns pass or findings. Findings go back to step 2, at most two rounds, then `ask()` for accept, retry, or stop.
4. Communicate: a worker drafts the update. `ask()` shows the exact text with Approve and Decline. On approval, a Sidekick worker posts the comment, updates status and evidence links, and logs the work time.
5. Close: the run returns the outcome. The origin thread receives the completion message and the inbox card clears.

## Known limits

- Core allows one pending interaction per thread. A second `ask()` on the same run waits and retries until the first is answered.
- The workflow run timeout, 24 hours by default, still applies to an unanswered approval.
- Finished steps never repeat, so the only duplicate-write exposure is a worker interrupted mid-step after it already posted. External writes stay in their own small final step. Effect receipts inside the plugin are the fix if a real run ever duplicates a write.
- Notion writes are on `confirm`. The first real run decides whether the closing agent's comment and status tools move to `allow`, since the human already approved the exact text in the `ask()` step, or whether the origin thread posts the comment itself.
- `bb workflows list` and `status` are scoped to the current thread's project. There is no cross-project run list; the inbox is the cross-project view.

## Proving it

Run three real tasks from the task system: one coding, one document, one that fails review once. Fix what breaks in the script, the skills, or the operating model text, never in a single agent. Then the checks from the operating-model rollout:

- A worker's assembled instructions contain the operating model once.
- Three replies from three agents open without preamble and close without an offer.
- A worker asked mid-step to post the update itself declines and returns a handoff.
- A UI change ships with a screenshot or recording without being asked.
- A result longer than a screen arrives as a Markdown file with a preview link.
- A request that needs a second agent gets one child with a complete brief.
- A Fable 5.1 thread on a ten-minute task shows an opener, a mid-task note, and a closing recap.

Write the verification recipe for `verify-bb` once the three tasks pass.

## Not in slice 1

Channels other than the task system for intake and replies. Parallel runs that share a repository. Cost accounting beyond the wall-clock limit. A shared workflow location outside the project. Editing the step order per task; the script is fixed and steps are skipped, not reordered.
