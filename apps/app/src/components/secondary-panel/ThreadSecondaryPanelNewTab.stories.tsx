import { useCallback, useState, type ReactNode } from "react";
import type { Host } from "@bb/domain";
import { makeHost } from "@bb/test-helpers/domain-fixtures";
import { StoryCard, StoryRow } from "../../../.ladle/story-card";
import { ThreadSecondaryPanel } from "./ThreadSecondaryPanel";
import type { SecondaryPanelRenderableTab } from "./ThreadSecondaryPanel";
import { NewTabPage } from "./NewTabPage";
import { Icon } from "@bb/shared-ui/icon";
import {
  createNewTabFixedPanelTab,
  createTerminalFixedPanelTab,
  type SecondaryFileFixedPanelTab,
} from "@/lib/fixed-panel-tabs-state";
import {
  resolveTerminalHost,
  TerminalHostSelector,
} from "./TerminalHostSelector";

export default {
  title: "right-panel/New tab",
};

const ENVIRONMENT_ID = "env_open_file_story";
const STORY_TERMINAL_ID = "term_new_tab_story";

const MAC_STUDIO = makeHost({
  id: "host_mac_studio",
  name: "Mac Studio",
});
const MACBOOK_PRO = makeHost({
  ...MAC_STUDIO,
  id: "host_macbook_pro",
  name: "MacBook Pro",
});
const BUILD_SERVER = makeHost({
  ...MAC_STUDIO,
  id: "host_build_server",
  name: "Build server",
  status: "disconnected",
});

const noop = () => {};

interface PanelStageProps {
  children: ReactNode;
  presentation?: "card" | "sidebar";
}

interface NewTabPanelStoryProps {
  presentation?: "card" | "sidebar";
  terminalHosts?: readonly Host[];
}

interface NewTabStoryOutcome {
  hostName: string | null;
}

function createStoryActiveTab(
  outcome: NewTabStoryOutcome | null,
): SecondaryFileFixedPanelTab {
  if (outcome === null) {
    return createNewTabFixedPanelTab();
  }

  return createTerminalFixedPanelTab({ terminalId: STORY_TERMINAL_ID });
}

function PanelStage({ children, presentation = "card" }: PanelStageProps) {
  return (
    <div
      className={
        presentation === "sidebar"
          ? "flex h-screen min-h-[640px] w-full max-w-[480px] min-w-0 flex-col overflow-hidden border-l border-border bg-sidebar"
          : "flex h-[380px] w-full max-w-[720px] min-w-0 flex-col overflow-hidden rounded-md border border-border bg-background"
      }
    >
      {children}
    </div>
  );
}

function NewTabPanelStory({
  presentation,
  terminalHosts,
}: NewTabPanelStoryProps) {
  const [outcome, setOutcome] = useState<NewTabStoryOutcome | null>(null);
  const [preferredTerminalHostId, setPreferredTerminalHostId] = useState<
    string | null
  >(null);
  const selectedTerminalHost = resolveTerminalHost({
    hosts: terminalHosts ?? [],
    preferredHostId: preferredTerminalHostId,
    primaryHostId: terminalHosts?.[0]?.id ?? null,
  });
  const handleStartTerminal = useCallback(() => {
    setOutcome({ hostName: selectedTerminalHost?.name ?? null });
  }, [selectedTerminalHost]);
  const handleOpenNewTab = useCallback(() => {
    setOutcome(null);
  }, []);
  const activeTab = createStoryActiveTab(outcome);
  const content =
    outcome === null ? (
      <NewTabPage
        onStartTerminal={handleStartTerminal}
        startTerminalDisabled={
          terminalHosts !== undefined &&
          selectedTerminalHost?.status !== "connected"
        }
        startTerminalTrailing={
          terminalHosts === undefined ? undefined : (
            <TerminalHostSelector
              disabled={false}
              hosts={terminalHosts}
              isLoading={false}
              onChange={setPreferredTerminalHostId}
              selectedHostId={selectedTerminalHost?.id ?? null}
            />
          )
        }
      />
    ) : (
      <div className="flex min-h-full flex-col justify-center bg-neutral-950 px-4 font-mono text-xs text-emerald-100">
        <p>$ bb terminal start</p>
        <p className="pt-1 text-emerald-300">
          Terminal tab opened from the New tab page
          {outcome.hostName === null ? "." : ` on ${outcome.hostName}.`}
        </p>
      </div>
    );
  const panelTab: SecondaryPanelRenderableTab = {
    contentFillsRegion: outcome !== null,
    label: outcome === null ? "New tab" : "Terminal",
    leadingVisual:
      outcome === null ? (
        <Icon name="NewTab" className="size-3.5" aria-hidden />
      ) : (
        <Icon name="Terminal" className="size-3.5" aria-hidden />
      ),
    onClose: outcome === null ? noop : () => setOutcome(null),
    onSelect: noop,
    renderContent: () => content,
    statusLabel: null,
    tab: activeTab,
  };

  return (
    <PanelStage presentation={presentation}>
      <ThreadSecondaryPanel
        activeTab={activeTab}
        canUseGitUi
        requestedMergeBaseBranch="main"
        environmentId={ENVIRONMENT_ID}
        tabs={[panelTab]}
        fixedTabs={[]}
        isOpen
        metadataContent={null}
        onCollapse={noop}
        onClose={noop}
        onTabReorder={noop}
        onOpenNewTab={handleOpenNewTab}
        onPanelFocus={noop}
        isConversationCollapsed={false}
        onToggleConversationCollapse={noop}
        renderAsDrawer
      />
    </PanelStage>
  );
}

export function CollapseControl() {
  return (
    <div className="flex min-h-screen w-full justify-end bg-background">
      <NewTabPanelStory presentation="sidebar" />
    </div>
  );
}

export function NewTab() {
  return (
    <StoryCard>
      <StoryRow label="default" hint="stable launcher: Actions only">
        <NewTabPanelStory />
      </StoryRow>
      <StoryRow
        label="one machine"
        hint="the terminal action shows its only machine as a quiet value"
      >
        <NewTabPanelStory terminalHosts={[MAC_STUDIO]} />
      </StoryRow>
      <StoryRow
        label="multiple machines"
        hint="the terminal action includes a compact machine selector"
      >
        <NewTabPanelStory
          terminalHosts={[MAC_STUDIO, MACBOOK_PRO, BUILD_SERVER]}
        />
      </StoryRow>
    </StoryCard>
  );
}
