import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { AutomationExecutionRequest } from "./rpc-types.js";

type AgentsApi = {
  sdk: { agents: Pick<BbPluginApi["sdk"]["agents"], "get"> };
};

export async function resolveAgentRef(
  bb: AgentsApi,
  ref: string,
): Promise<string> {
  return (await bb.sdk.agents.get({ agent: ref })).id;
}

export async function resolveAutomationAgent<
  Execution extends AutomationExecutionRequest,
>(bb: AgentsApi, execution: Execution): Promise<Execution> {
  if (execution.mode !== "agent" || execution.agentId === undefined) {
    return execution;
  }
  return { ...execution, agentId: await resolveAgentRef(bb, execution.agentId) };
}
