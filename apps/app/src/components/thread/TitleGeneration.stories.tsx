import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ThreadResponse } from "@bb/server-contract";
import { Button } from "@bb/shared-ui/button";
import { ThreadDetailHeader } from "@/views/thread-detail/ThreadDetailHeader";
import { SidebarProvider } from "@/components/ui/sidebar";
import { DefaultPaneContextProvider } from "@/views/thread-detail/PaneContext";
import { ThreadRow } from "@/components/sidebar/ThreadRow";
import { makeThreadListEntry } from "../../../.ladle/story-fixtures";
import { makeThreadResponse } from "@/test/fixtures/thread-responses";
import { threadQueryKey } from "@/hooks/queries/query-keys";
import { sdk } from "@/lib/sdk";
import {
  ThreadActionsProvider,
  useThreadActions,
} from "./ThreadActionsProvider";
import { ThreadActionsMenu } from "./ThreadActionsMenu";

export default { title: "thread/Title generation" };

const initialThread = makeThreadResponse({
  id: "thr_title_preview",
  title: "Original title",
});

function Preview() {
  const { generateTitle, generatingTitleIds } = useThreadActions();
  const { data: thread } = useQuery({
    queryKey: threadQueryKey(initialThread.id),
    queryFn: async () => initialThread,
    initialData: initialThread,
    enabled: false,
  });
  const pending = useRef<{
    resolve: (thread: ThreadResponse) => void;
    reject: (error: Error) => void;
  } | null>(null);
  const [ready, setReady] = useState(false);
  const [canResolve, setCanResolve] = useState(false);
  useEffect(() => {
    const original = sdk.threads.generateTitle;
    sdk.threads.generateTitle = (input) => {
      if (input.threadId !== initialThread.id) return original(input);
      return new Promise((resolve, reject) => {
        pending.current = { resolve, reject };
        setCanResolve(true);
      });
    };
    setReady(true);
    return () => {
      sdk.threads.generateTitle = original;
      pending.current?.reject(new Error("Preview closed"));
    };
  }, []);
  const isGenerating = generatingTitleIds.has(thread.id);
  const finish = (title: string) => {
    pending.current?.resolve({ ...thread, title });
    pending.current = null;
    setCanResolve(false);
  };
  const row = makeThreadListEntry(thread);
  return (
    <div className="w-full space-y-6 pt-24">
      <div className="flex flex-wrap gap-2">
        <Button
          disabled={!ready || isGenerating}
          onClick={() => void generateTitle(thread.id)}
        >
          Generate title
        </Button>
        <Button disabled={!canResolve} onClick={() => finish("Short")}>
          Resolve short
        </Button>
        <Button
          disabled={!canResolve}
          onClick={() =>
            finish(
              "A much longer generated thread title to verify stable layout",
            )
          }
        >
          Resolve long
        </Button>
        <Button
          disabled={!canResolve}
          onClick={() => {
            pending.current?.reject(new Error("Inference unavailable"));
            pending.current = null;
            setCanResolve(false);
          }}
        >
          Fail generation
        </Button>
      </div>
      <div
        data-testid="title-generation-header"
        className="overflow-hidden rounded-md border"
      >
        <ThreadDetailHeader
          actionsMenu={() => <ThreadActionsMenu thread={row} />}
          childPillLabel="child"
          isSecondaryPanelOpen={false}
          onToggleSecondaryPanel={() => {}}
          threadId={thread.id}
          threadTitle={thread.title ?? "Untitled"}
        />
      </div>
      <div
        data-testid="title-generation-sidebar"
        className="w-full max-w-sm rounded-md bg-sidebar p-2 text-sidebar-foreground"
      >
        <ThreadRow
          projectId={thread.projectId}
          thread={row}
          isActive
          hasComposerDraft={false}
          options={{ kind: "default", depth: 1, isCompact: false }}
        />
      </div>
    </div>
  );
}

export function PendingAndResolved() {
  return (
    <SidebarProvider className="min-h-0 w-full">
      <DefaultPaneContextProvider>
        <ThreadActionsProvider>
          <Preview />
        </ThreadActionsProvider>
      </DefaultPaneContextProvider>
    </SidebarProvider>
  );
}
