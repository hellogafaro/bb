import {
  RiArrowLeftRightLine,
  RiCodeSSlashLine,
  RiComputerLine,
  RiDatabase2Line,
  RiPulseLine,
  RiSparkling2Line,
  RiStackLine,
  RiTerminalBoxLine,
  RiTestTubeLine,
  RiTimeLine,
} from "react-icons/ri";
import type { IconType } from "react-icons";
import type { IconName } from "@bb/shared-ui/icon";
import accountPoolManifest from "../../../plugins/account-pool/package.json";
import askUserQuestionManifest from "../../../plugins/ask-user-question/package.json";
import automationsManifest from "../../../plugins/automations/package.json";
import browserAutomationManifest from "../../../plugins/browser-automation/package.json";
import concurrencyLimitManifest from "../../../plugins/concurrency-limit/package.json";
import docsManifest from "../../../plugins/docs/package.json";
import draftsManifest from "../../../plugins/drafts/package.json";
import githubManifest from "../../../plugins/github/package.json";
import inlineVisManifest from "../../../plugins/inline-vis/package.json";
import keepAwakeManifest from "../../../plugins/keep-awake/package.json";
import memoryManifest from "../../../plugins/memory/package.json";
import environmentModalSandboxManifest from "../../../plugins/environment-modal-sandbox/package.json";
import environmentPersonalWorkspaceManifest from "../../../plugins/environment-personal-workspace/package.json";
import environmentProjectCheckoutManifest from "../../../plugins/environment-project-checkout/package.json";
import providerUsageManifest from "../../../plugins/provider-usage/package.json";
import providerRetryManifest from "../../../plugins/provider-retry/package.json";
import pushNotificationsManifest from "../../../plugins/push-notifications/package.json";
import connectManifest from "../../../plugins/connect/package.json";
import secretsManifest from "../../../plugins/secrets/package.json";
import scheduledSendManifest from "../../../plugins/scheduled-send/package.json";
import sideChatManifest from "../../../plugins/side-chat/package.json";
import tasksManifest from "../../../plugins/tasks/package.json";
import workflowsManifest from "../../../plugins/workflows/package.json";
import environmentGitWorktreeManifest from "../../../plugins/environment-git-worktree/package.json";
import providerAcpManifest from "../../../plugins/provider-acp/package.json";
import providerClaudeCodeManifest from "../../../plugins/provider-claude-code/package.json";
import providerCodexManifest from "../../../plugins/provider-codex/package.json";
import providerPiManifest from "../../../plugins/provider-pi/package.json";

const FIRST_PARTY_PLUGINS = [
  accountPoolManifest,
  askUserQuestionManifest,
  automationsManifest,
  browserAutomationManifest,
  concurrencyLimitManifest,
  docsManifest,
  draftsManifest,
  githubManifest,
  inlineVisManifest,
  keepAwakeManifest,
  memoryManifest,
  environmentModalSandboxManifest,
  environmentPersonalWorkspaceManifest,
  environmentProjectCheckoutManifest,
  providerUsageManifest,
  providerRetryManifest,
  pushNotificationsManifest,
  connectManifest,
  secretsManifest,
  scheduledSendManifest,
  sideChatManifest,
  tasksManifest,
  workflowsManifest,
  environmentGitWorktreeManifest,
  providerAcpManifest,
  providerClaudeCodeManifest,
  providerCodexManifest,
  providerPiManifest,
];

export function pluginIcon(displayName: string): IconName | null {
  const icon = FIRST_PARTY_PLUGINS.find(
    (plugin) => plugin.bb.name === displayName,
  )?.bb.branding.icon;
  return icon && !icon.startsWith("./") ? icon : null;
}

export function firstPartyPluginId(displayName: string): string | null {
  const plugin = FIRST_PARTY_PLUGINS.find(
    (plugin) => plugin.bb.name === displayName,
  );
  return plugin?.name.replace(/^bb-plugin-/, "") ?? null;
}

const SURFACE_ICONS: Record<string, IconType> = {
  cli: RiTerminalBoxLine,
  "agent-tools": RiSparkling2Line,
  background: RiTimeLine,
  wire: RiArrowLeftRightLine,
  storage: RiDatabase2Line,
  "thread-events": RiPulseLine,
  "host-workers": RiComputerLine,
  "bb-sdk": RiCodeSSlashLine,
  "host-components": RiStackLine,
  testing: RiTestTubeLine,
};

export function surfaceIcon(surfaceId: string): IconType | null {
  return SURFACE_ICONS[surfaceId] ?? null;
}
