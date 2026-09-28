import { z } from "zod";
import type { DynamicTool, ToolCallResponse } from "@bb/domain";
import { computerOperationSchema } from "@bb/host-daemon-contract";
import { computerStartRequestSchema } from "@bb/server-contract";
import type { WorkSessionDeps } from "../../types.js";
import {
  act,
  cancel,
  doctor,
  listMachines,
  observe,
  screenshot,
  start,
  status,
  record,
} from "./computer.js";

const machinesParameters = z.object({}).strict();
const doctorParameters = z.object({ hostId: z.string().min(1) }).strict();
const observeParameters = z
  .object({ hostId: z.string().min(1), appId: z.string().max(160).optional() })
  .strict();
const actParameters = z
  .object({ hostId: z.string().min(1), action: computerOperationSchema })
  .strict();
const screenshotParameters = z
  .object({ hostId: z.string().min(1), appId: z.string().max(160).optional() })
  .strict();
const recordParameters = z
  .object({
    hostId: z.string().min(1),
    action: z.enum(["start", "stop"]),
    runId: z.string().uuid(),
  })
  .strict();
const startParameters = computerStartRequestSchema;
const statusParameters = z.object({ runId: z.string().uuid() }).strict();
const cancelParameters = z.object({ runId: z.string().uuid() }).strict();

const COMPUTER_TOOL_DEFINITIONS = {
  computer_machines: {
    description:
      "List machines this thread can observe or control with Computer.",
    parameters: machinesParameters,
  },
  computer_doctor: {
    description:
      "Check Cua Driver readiness on a machine (binary, daemon, accessibility, windows).",
    parameters: doctorParameters,
  },
  computer_observe: {
    description:
      "Return the current target table (indexed clickable/typable elements with bounds) for the active window on a machine, or a named app.",
    parameters: observeParameters,
  },
  computer_act: {
    description:
      "Perform one operation (click/double_click/type/set_value/select/scroll/hotkey/wait) against a targetId from the latest computer_observe, identified by its snapshotId. Re-observe after acting.",
    parameters: actParameters,
  },
  computer_screenshot: {
    description:
      "Capture a screenshot of the machine's desktop (or a named app's window) into this thread's storage.",
    parameters: screenshotParameters,
  },
  computer_record: {
    description:
      "Start or stop a screen recording for a run; the finished MP4 and trajectory land in this thread's storage.",
    parameters: recordParameters,
  },
  computer_start: {
    description:
      "Start a goal-driven run on a machine. In agent mode (default, and the only mode without a configured TypeSafe key) this immediately escalates: drive the goal yourself with computer_observe/computer_act and report computer_status. In jev mode it runs a typed-choice decision loop in the background.",
    parameters: startParameters,
  },
  computer_status: {
    description: "Read a run's status (state, step count, last action summary).",
    parameters: statusParameters,
  },
  computer_cancel: {
    description: "Cancel a run.",
    parameters: cancelParameters,
  },
} satisfies Record<string, { description: string; parameters: z.ZodType }>;

export const COMPUTER_TOOL_NAMES = Object.keys(
  COMPUTER_TOOL_DEFINITIONS,
) as (keyof typeof COMPUTER_TOOL_DEFINITIONS)[];
export type ComputerToolName = (typeof COMPUTER_TOOL_NAMES)[number];

export function isComputerToolName(name: string): name is ComputerToolName {
  return Object.hasOwn(COMPUTER_TOOL_DEFINITIONS, name);
}

export function computerDynamicTools(): DynamicTool[] {
  return COMPUTER_TOOL_NAMES.map((name) => ({
    name,
    description: COMPUTER_TOOL_DEFINITIONS[name].description,
    inputSchema: z.toJSONSchema(COMPUTER_TOOL_DEFINITIONS[name].parameters, {
      io: "input",
    }),
  }));
}

function toolResult(value: unknown): ToolCallResponse {
  return { success: true, contentItems: [{ type: "inputText", text: JSON.stringify(value) }] };
}

function invalidArguments(): ToolCallResponse {
  return {
    success: false,
    contentItems: [{ type: "inputText", text: "Invalid arguments." }],
  };
}

export interface ComputerToolCallArgs {
  tool: ComputerToolName;
  input: unknown;
  threadId: string;
  signal: AbortSignal;
}

export async function handleComputerToolCall(
  deps: WorkSessionDeps,
  args: ComputerToolCallArgs,
): Promise<ToolCallResponse> {
  switch (args.tool) {
    case "computer_machines": {
      return toolResult(await listMachines(deps, args.threadId));
    }
    case "computer_doctor": {
      const parsed = doctorParameters.safeParse(args.input);
      if (!parsed.success) return invalidArguments();
      return toolResult(await doctor(deps, parsed.data.hostId));
    }
    case "computer_observe": {
      const parsed = observeParameters.safeParse(args.input);
      if (!parsed.success) return invalidArguments();
      return toolResult(await observe(deps, parsed.data.hostId, parsed.data.appId));
    }
    case "computer_act": {
      const parsed = actParameters.safeParse(args.input);
      if (!parsed.success) return invalidArguments();
      return toolResult(
        await act(deps, parsed.data.hostId, parsed.data.action, args.signal),
      );
    }
    case "computer_screenshot": {
      const parsed = screenshotParameters.safeParse(args.input);
      if (!parsed.success) return invalidArguments();
      return toolResult(
        await screenshot(deps, parsed.data.hostId, args.threadId, parsed.data.appId),
      );
    }
    case "computer_record": {
      const parsed = recordParameters.safeParse(args.input);
      if (!parsed.success) return invalidArguments();
      return toolResult(
        await record(
          deps,
          parsed.data.hostId,
          args.threadId,
          parsed.data.action,
          parsed.data.runId,
        ),
      );
    }
    case "computer_start": {
      const parsed = startParameters.safeParse(args.input);
      if (!parsed.success) return invalidArguments();
      return toolResult(await start(deps, parsed.data));
    }
    case "computer_status": {
      const parsed = statusParameters.safeParse(args.input);
      if (!parsed.success) return invalidArguments();
      return toolResult(status(parsed.data.runId));
    }
    case "computer_cancel": {
      const parsed = cancelParameters.safeParse(args.input);
      if (!parsed.success) return invalidArguments();
      return toolResult(cancel(parsed.data.runId));
    }
  }
}
