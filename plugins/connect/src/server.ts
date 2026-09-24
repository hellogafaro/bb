import {
  createServerAccessRecheck,
  registerServerAccess,
} from "./server-access.js";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { registerConnectCli } from "./cli.js";
import { createKvCredentialStore } from "./credential.js";
import {
  connectRpcContract,
  createRpcHandlers,
  type MobilePairingGate,
} from "./rpc.js";
import { ShareRegistry } from "./shares.js";
import { ConnectTunnel } from "./tunnel.js";
import { ShareHostResolver } from "./hosts.js";
import { resolveLocalCloudLoopbackUrl } from "./local-loopback.js";
import { resolveDefaultConnectBaseUrl } from "./redeem.js";
import { CONNECT_REALTIME_CHANNEL } from "./types.js";

export const REMOTE_ACCESS_INSTRUCTIONS =
  "When the user views bb remotely and needs to open an HTTP server you started, run `bb connect expose <port>` from this thread and give them the returned URL as a Markdown link; localhost URLs do not work remotely.";

export default async function plugin(bb: BbPluginApi) {
  const settings = bb.settings.define({
    sendRemoteInstructions: {
      type: "boolean",
      label: "Tell agents about remote access",
      description:
        "When you use BB remotely, tell agents to share servers through Connect. Applies to new agent sessions.",
      default: true,
    },
  });
  let currentSettings = await settings.get();
  settings.onChange((next) => {
    currentSettings = next;
  });
  const store = createKvCredentialStore(bb.storage.kv);
  let tunnel!: ConnectTunnel;
  const hostResolver = new ShareHostResolver(() => bb.sdk);
  const getLoopbackBaseUrl = () =>
    resolveLocalCloudLoopbackUrl(
      tunnel.getCredential()?.serverUrl,
      process.env.BB_DEV_APP_PORT,
    ) ?? bb.server.loopbackBaseUrl;

  const shares = new ShareRegistry({
    kv: bb.storage.kv,
    hosts: bb.hosts,
    hostResolver,
    getLoopbackBaseUrl,
    getCredential: () => tunnel.getCredential(),
    log: bb.log,
    onChange: () => {
      bb.realtime.publish(CONNECT_REALTIME_CHANNEL, tunnel.status());
    },
  });

  bb.events.on("experimental_host.deleted", async ({ host }) => {
    await shares.pruneHost(host.id);
  });

  const recheckServerAccess = createServerAccessRecheck(bb);
  tunnel = new ConnectTunnel({
    store,
    shares,
    defaultBaseUrl: resolveDefaultConnectBaseUrl(process.env),
    getLoopbackBaseUrl,
    log: bb.log,
    onStatusChange: (status) => {
      bb.realtime.publish(CONNECT_REALTIME_CHANNEL, status);
      recheckServerAccess(status);
    },
  });

  await registerServerAccess(bb, tunnel);

  const mobilePairing: MobilePairingGate = {
    enabled: async () => (await bb.sdk.system.config()).experiments.mobileApp,
  };

  bb.rpc.register(
    connectRpcContract,
    createRpcHandlers(tunnel, hostResolver, mobilePairing),
  );
  registerConnectCli({ bb, tunnel, hostResolver, mobilePairing });

  bb.agents.contributeInstructions(() => {
    if (!currentSettings.sendRemoteInstructions) return null;
    if (!tunnel.status().paired) return null;
    return REMOTE_ACCESS_INSTRUCTIONS;
  });

  bb.background.service("tunnel", {
    async start(signal) {
      await tunnel.start();
      await new Promise<void>((resolve) => {
        if (signal.aborted) {
          resolve();
          return;
        }
        signal.addEventListener("abort", () => resolve(), { once: true });
      });
      tunnel.stop();
    },
  });
}
