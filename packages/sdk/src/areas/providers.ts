import {
  providerGuardResponseSchema,
  type ProviderGuardResponse,
  type SystemExecutionOptionsResponse,
  type SystemProviderInfo,
  type SystemProvidersQuery,
} from "@bb/server-contract";
import {
  readExecutionOptions,
  signalRequestArgs,
  type CreateSdkAreaArgs,
} from "./common.js";

export type ProviderHostRoutingArgs =
  | { environmentId: string; hostId?: never }
  | { environmentId?: never; hostId: string }
  | { environmentId?: never; hostId?: never };

export type ProviderListArgs = ProviderHostRoutingArgs & {
  capability?: SystemProvidersQuery["capability"];
  signal?: AbortSignal;
};
export type ProviderModelsArgs = ProviderHostRoutingArgs & {
  providerId?: string;
  signal?: AbortSignal;
};

export type ProviderListResult = SystemProviderInfo[];
export type ProviderModelsResult = SystemExecutionOptionsResponse;
export type ProviderGuardResult = ProviderGuardResponse;

export interface ProviderGuardArgs {
  hostId?: string;
  projectPath?: string;
  signal?: AbortSignal;
}

export interface ProvidersArea {
  list(args?: ProviderListArgs): Promise<ProviderListResult>;
  models(args?: ProviderModelsArgs): Promise<ProviderModelsResult>;
  guardStatus(args?: ProviderGuardArgs): Promise<ProviderGuardResult>;
  guardFix(args?: ProviderGuardArgs): Promise<ProviderGuardResult>;
}

export function createProvidersArea(args: CreateSdkAreaArgs): ProvidersArea {
  const { transport } = args;

  async function guard(
    path: string,
    init: RequestInit,
  ): Promise<ProviderGuardResult> {
    const baseUrl = transport.baseUrl.replace(/\/$/u, "");
    const response = await transport.resolve(
      transport.fetch(`${baseUrl}/api/v1/providers/guard${path}`, init),
    );
    return providerGuardResponseSchema.parse(await response.json());
  }

  return {
    async list(input = {}) {
      return transport.readJson(
        transport.api.v1.system.providers.$get(
          {
            query: {
              capability: input.capability,
              environmentId: input.environmentId,
              hostId: input.hostId,
            },
          },
          ...signalRequestArgs(input.signal),
        ),
      );
    },
    async models(input = {}) {
      return readExecutionOptions(transport, input);
    },
    guardStatus(input = {}) {
      const query = new URLSearchParams();
      if (input.hostId) query.set("hostId", input.hostId);
      if (input.projectPath) query.set("projectPath", input.projectPath);
      const text = query.toString();
      return guard(text ? `?${text}` : "", {
        method: "GET",
        ...(input.signal ? { signal: input.signal } : {}),
      });
    },
    guardFix(input = {}) {
      return guard("/fix", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          hostId: input.hostId ?? null,
          projectPath: input.projectPath ?? null,
        }),
        ...(input.signal ? { signal: input.signal } : {}),
      });
    },
  };
}
