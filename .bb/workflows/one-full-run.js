export const meta = {
  name: "one-full-run",
  description: "Take one task from brief to an approved, recorded result",
  inputSchema: {
    type: "object",
    properties: { task: { type: "string" } },
    required: ["task"],
  },
  phases: [
    { title: "Context", detail: "Brief from the task" },
    { title: "Execute", detail: "Owning agent does the work" },
    { title: "Review", detail: "Fresh worker checks the result" },
    { title: "Approve", detail: "Human approves the update" },
    { title: "Close", detail: "Closing agent records the result" },
  ],
};

const briefSchema = {
  type: "object",
  properties: {
    title: { type: "string" },
    outcome: { type: "string" },
    doneChecks: { type: "array", items: { type: "string" } },
    constraints: { type: "string" },
    workspace: { type: "string" },
  },
  required: ["title", "outcome", "doneChecks", "constraints", "workspace"],
};

const handoffSchema = {
  type: "object",
  properties: {
    result: { type: "string" },
    checksRun: { type: "array", items: { type: "string" } },
    evidence: { type: "array", items: { type: "string" } },
    openIssues: { type: "array", items: { type: "string" } },
    commit: { type: "string" },
    workMinutes: { type: "number" },
  },
  required: ["result", "checksRun", "evidence", "openIssues", "commit", "workMinutes"],
};

const verdictSchema = {
  type: "object",
  properties: {
    pass: { type: "boolean" },
    findings: { type: "array", items: { type: "string" } },
  },
  required: ["pass", "findings"],
};

const closeSchema = {
  type: "object",
  properties: {
    done: { type: "boolean" },
    note: { type: "string" },
  },
  required: ["done", "note"],
};

phase("Context");
const brief = await agent(
  `Read the task at ${args.task} with the Notion MCP, read only. Return the brief: title, the outcome in one paragraph, the done checks as a list, constraints, and the workspace (a local repository path or "personal"). Do not change the task.`,
  { agent: "sidekick", schema: briefSchema, label: "Brief" },
);

phase("Execute");
const work = `Task: ${brief.title}\nOutcome: ${brief.outcome}\nDone checks:\n- ${brief.doneChecks.join("\n- ")}\nConstraints: ${brief.constraints}\nWorkspace: ${brief.workspace}`;
let handoff = await agent(
  `${work}\n\nDo this work in the current workspace and commit it. Take a screenshot of the result with dev-browser and save it under $BB_THREAD_STORAGE/evidence/. Return the handoff: result, checks run, evidence file paths, open issues, the commit hash, and actual work minutes.`,
  { agent: "cody", schema: handoffSchema, label: "Execute" },
);

let verdict = { pass: false, findings: [] };
for (let round = 0; round < 3; round++) {
  phase("Review");
  verdict = await agent(
    `${work}\n\nHandoff from the executor:\n${JSON.stringify(handoff, null, 2)}\n\nReview the artifact in the current workspace against every done check and the real outcome. Open the page yourself and look at it. Do not edit anything. Return pass true with no findings, or pass false with one finding per problem.`,
    { schema: verdictSchema, label: `Review ${round + 1}` },
  );
  if (verdict.pass || round === 2) break;
  phase("Execute");
  handoff = await agent(
    `${work}\n\nYour previous handoff:\n${JSON.stringify(handoff, null, 2)}\n\nThe reviewer found:\n- ${verdict.findings.join("\n- ")}\n\nFix these in the current workspace, commit, refresh the screenshot, and return a new handoff.`,
    { agent: "cody", schema: handoffSchema, label: `Repair ${round + 1}` },
  );
}

if (!verdict.pass) {
  const decision = await ask("Review did not pass after two repairs. Accept the result as is, or stop?", {
    detail: verdict.findings.map((f) => `- ${f}`).join("\n"),
    options: ["Accept", "Stop"],
  });
  if (decision === "Stop") return { closed: false, handoff, verdict };
}

phase("Approve");
const draft = await agent(
  `${work}\n\nHandoff:\n${JSON.stringify(handoff, null, 2)}\nVerdict:\n${JSON.stringify(verdict, null, 2)}\n\nDraft the comment for the task in Notion as the person would read it: what changed, the commit, the checks, and any open issue. Plain prose, at most five sentences, no agent language. Return only the comment text.`,
  { agent: "sidekick", label: "Draft update" },
);
const choice = await ask("Post this update to the task and mark it done?", {
  detail: draft,
  options: ["Approve", "Decline"],
});
if (choice === "Decline") return { closed: false, handoff, verdict, draft };

phase("Close");
let closed = { done: false, note: "" };
for (let attempt = 0; attempt < 2; attempt++) {
  closed = await agent(
    `Task: ${args.task}\n\nPost this exact comment on the task, attach the evidence files listed in the handoff, set the task status to done, and log ${handoff.workMinutes} minutes of actual work in Timesheets. Comment text:\n\n${draft}\n\nHandoff:\n${JSON.stringify(handoff, null, 2)}\n\nFetch the task afterwards. Return done true only when the comment, attachments, status, and time entry are all confirmed on the page, with a one-line note; otherwise done false with what is missing and why.`,
    { agent: "sidekick", schema: closeSchema, label: attempt === 0 ? "Close in Notion" : "Close in Notion, retry" },
  );
  if (closed.done) break;
  const next = await ask("The close in Notion did not complete. Retry or stop?", {
    detail: closed.note,
    options: ["Retry", "Stop"],
  });
  if (next === "Stop") break;
}
return { closed: closed.done, commit: handoff.commit, verdict, note: closed.note };
