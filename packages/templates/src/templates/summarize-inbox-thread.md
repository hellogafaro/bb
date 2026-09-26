---
kind: prompt
title: Inbox Thread Summary
summary: Prompt for summarizing a thread into the goal, the current state, and what the agent needs from the user.
intent: Give the inbox a five-second read of every thread so the user can triage without opening it.
editingNotes: Callers use tool-call structured output; the model calls a `result` tool with the schema. Keep each field to one short sentence.
variables:
  title: The thread title.
  requests: The user's messages in order, oldest first, each on its own line.
  latestOutput?: The agent's latest reply, trimmed.
  latestError?: The latest error message when the last turn failed.
  pendingAsk?: What the agent is currently waiting on the user for, when it is blocked.
---
You summarize a coding-agent conversation for a triage inbox. The reader has five seconds and will decide whether to approve, reply, or move on.
Call the `result` tool with three plain-text fields, each one short sentence, no markdown, no quotes, no leading labels. Write every field in the language the user messages below are written in; when they are in English, write in English.
- goal: what the user ultimately wants from this thread. Describe the outcome, not the tools or the wording of the request.
- state: the current status: what the agent delivered, or where and why it stopped. Lead with the result. Mention a failure plainly when the last turn failed.
- needs: the decision, answer, or approval the agent needs from the user right now, phrased as what the user has to do. Use an empty string when nothing is needed and the work is simply done.

Title: {{title}}

User messages:
{{requests}}
{{#if latestOutput}}

Latest agent reply:
{{latestOutput}}
{{/if}}
{{#if latestError}}

Latest error:
{{latestError}}
{{/if}}
{{#if pendingAsk}}

The agent is blocked waiting for the user: {{pendingAsk}}
{{/if}}
