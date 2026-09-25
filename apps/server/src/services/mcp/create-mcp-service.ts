import type { AppDeps } from "../../types.js";
import { callHostOnlineRpc } from "../hosts/online-rpc.js";
import { resolvePrimaryHostId } from "../hosts/primary-host.js";
import { serverAccessStatus } from "../machines/server-access.js";
import { oauthRedirectBase, serverAccessPublicUrl } from "./oauth-redirect.js";
import { OFFICIAL_REGISTRY } from "./registry.js";
import { McpService } from "./service.js";
import { daemonStdioHost } from "./stdio-host.js";

type McpServiceDeps = Pick<
  AppDeps,
  | "config"
  | "db"
  | "hub"
  | "lifecycleDedupers"
  | "logger"
  | "machineAuth"
  | "pendingInteractions"
  | "pluginHostArtifacts"
  | "providerRegistry"
  | "skillTreeRegistry"
  | "telemetry"
>;

function requirePrimaryHostId(deps: McpServiceDeps): string {
  const hostId = resolvePrimaryHostId(deps);
  if (!hostId) throw new Error("No host available for isolated MCP servers");
  return hostId;
}

async function publicServerUrl(deps: McpServiceDeps): Promise<string | null> {
  try {
    return serverAccessPublicUrl(await serverAccessStatus(deps));
  } catch {
    return null;
  }
}

export function createMcpService(deps: McpServiceDeps): McpService {
  const call = callHostOnlineRpc;
  return new McpService({
    db: deps.db,
    dataDir: deps.config.dataDir,
    logger: {
      info: (message) => deps.logger.info(message),
      warn: (message) => deps.logger.warn(message),
    },
    notify: (id, changes) => deps.hub.notifyMcp(id, changes),
    pendingInteractions: deps.pendingInteractions,
    primaryHostId: () => resolvePrimaryHostId(deps),
    registryUrl: OFFICIAL_REGISTRY,
    oauthRedirectBase: async () =>
      oauthRedirectBase({
        appUrl: deps.config.appUrl ?? null,
        publicUrl: await publicServerUrl(deps),
        loopbackBaseUrl: `http://127.0.0.1:${deps.config.serverPort}`,
      }),
    stdioHost: daemonStdioHost({
      hostId: () => requirePrimaryHostId(deps),
      start: (hostId, command, timeoutMs) =>
        call(deps, {
          hostId,
          timeoutMs,
          command: { type: "mcp.stdio.start", ...command },
        }),
      refresh: (hostId, id, timeoutMs) =>
        call(deps, {
          hostId,
          timeoutMs,
          command: { type: "mcp.stdio.refresh", id },
        }),
      close: async (hostId, id, timeoutMs) => {
        await call(deps, {
          hostId,
          timeoutMs,
          command: { type: "mcp.stdio.close", id },
        });
      },
      callTool: (hostId, input, timeoutMs) =>
        call(deps, {
          hostId,
          timeoutMs,
          command: { type: "mcp.stdio.callTool", ...input },
        }),
      getPrompt: (hostId, input, timeoutMs) =>
        call(deps, {
          hostId,
          timeoutMs,
          command: { type: "mcp.stdio.getPrompt", ...input },
        }),
      readResource: (hostId, input, timeoutMs) =>
        call(deps, {
          hostId,
          timeoutMs,
          command: { type: "mcp.stdio.readResource", ...input },
        }),
    }),
  });
}
