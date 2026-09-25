import { useAtomValue } from "jotai";
import { FORK_BUILTIN_THREAD_LIST } from "@/lib/fork-flags";
import { resolvePreferredReplacement } from "@/lib/plugin-replacement-preference";
import { createSyncedPreferenceAtom } from "@/lib/ui-preferences/synced-preference-atom";
import {
  resolveReplacement,
  type ResolvedReplacement,
} from "@/lib/plugin-slot-resolvers";
import { usePluginSlots, type PluginThreadListSlot } from "@/lib/plugin-slots";

export const threadListProviderAtom = createSyncedPreferenceAtom(
  "sidebar.threadListProvider",
);

export function useThreadListReplacement(): ResolvedReplacement<PluginThreadListSlot> {
  const { threadLists } = usePluginSlots();
  const preference = useAtomValue(threadListProviderAtom);
  return FORK_BUILTIN_THREAD_LIST
    ? resolveReplacement(threadLists)
    : resolvePreferredReplacement(threadLists, preference);
}
