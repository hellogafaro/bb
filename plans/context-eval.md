# Context evaluation: injected instructions

Measures the BB instruction text appended to each thread's system prompt before and after the XML-group change (commit on `main`, September 2026). Sizes are characters and estimated tokens (chars/4). Provider breakdowns come from the latest recorded Claude Code context snapshot for the thread (`bb thread context <id> --json`); Codex threads record no breakdown.

Method: the assembled text was reproduced from live data (`~/.bb/bb.db`, `~/.bb/AGENTS.md`, enabled MCP servers, agent records, plugin contribution texts) through the real assembly pieces (`connectedInstructions`, the MCP tool snippets, and, after, `buildInstructionGroups`). The before text for `thr_p79p9kwy47` was checked against the live system prompt of that thread and matched. Live outputs are under the thread storage of `thr_p79p9kwy47` (`context-eval/before`, `context-eval/after`).

## Threads

| Thread | Class | Agent | Provider |
| --- | --- | --- | --- |
| `thr_wua57hhpk2` | Chat thread in the bb repo project | none | claude-code |
| `thr_2c29mdekbr` | Dexter chat thread (personal workspace) | Dexter | claude-code |
| `thr_yyd2zvimug` | Automation run (child of Sidekick's root thread, origin `automations`) | none | codex |
| `thr_p79p9kwy47` | Agent-spawned child thread (this task) | bb | claude-code |

## Before

| Thread | Chars | Est. tokens | Provider breakdown (latest snapshot) |
| --- | ---: | ---: | --- |
| `thr_wua57hhpk2` | 5,299 | 1,325 | 2026-09-24, claude-opus-5-5: system prompt 3,501; system tools 2,817; skills 6,244; memory files 2,341 (`projects/bb/AGENTS.md` 2,324, `CLAUDE.md` 17); total 450,352 / 1,000,000 |
| `thr_2c29mdekbr` | 7,643 | 1,911 | 2026-09-25, claude-opus-5-5: system prompt 4,728; system tools 7,670; skills 1,389; memory files 1,631 (`~/.bb/AGENTS.md`); total 19,084 / 1,000,000 |
| `thr_yyd2zvimug` | 5,299 | 1,325 | none recorded (Codex) |
| `thr_p79p9kwy47` | 5,500 | 1,375 | none recorded yet (turn in progress) |

The before text used prose headers ("The following instructions come from…") between sections and put the MCP sentence "Use mcp_search…" after the `<connected_mcps>` XML.

## After

| Thread | Chars | Est. tokens | Groups (chars / est. tokens) |
| --- | ---: | ---: | --- |
| `thr_wua57hhpk2` | 5,093 | 1,274 | bb_tools 1,021 / 256; connected_mcps 156 / 39; bb_plugin connect 251 / 63; bb_plugin workflows 597 / 150; bb_rules 3,060 / 765 |
| `thr_2c29mdekbr` | 7,307 | 1,827 | same as above plus connected_mcps 89 / 23 (agent scope: infisical, notion) and bb_agent 2,279 / 570 |
| `thr_yyd2zvimug` | 6,183 | 1,546 | same as the chat thread plus bb_run 1,088 / 272 |
| `thr_p79p9kwy47` | 6,359 | 1,590 | same as the chat thread plus bb_agent 174 / 44 and bb_run 1,088 / 272 |

Provider breakdowns after the change are not yet available: they are recorded by the running server, which still runs the previous build. Once the fork is rebuilt and a turn completes, `bb thread context <id> --instructions` prints the recorded snapshot under the group table.

## Reading the numbers

- Removing the prose headers saves about 200 characters per thread; the XML tags cost less than the sentences they replace.
- The unattended block adds 1,088 characters (about 272 tokens) to child and plugin-originated threads only.
- The data-dir `AGENTS.md` is the largest group (about 60 percent of the text). Claude Code also reads it natively when the workspace sits under `~/.bb` (the Dexter thread's memory files show it), so that thread receives it twice.
- The workspace `.bb/AGENTS.md` was not present for any of the four threads, so skipping it changed nothing here. Claude Code reads the repository root `AGENTS.md` natively (2,324 tokens in the chat thread's memory files).
- The text is now byte-stable across turns for a given thread: the connect plugin no longer embeds the remote URL or depends on recent remote activity.
