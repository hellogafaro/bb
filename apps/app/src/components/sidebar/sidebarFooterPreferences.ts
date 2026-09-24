import { useAtom } from "jotai";
import {
  usePluginSlots,
  type PluginSidebarFooterItemSlot,
} from "@/lib/plugin-slots";
import { createSyncedPreferenceAtom } from "@/lib/ui-preferences/synced-preference-atom";
import { arrangeByStoredOrder, reorderStoredOrder } from "@/lib/stored-order";

export const sidebarFooterOrderAtom = createSyncedPreferenceAtom(
  "sidebar.footerOrder",
);
export const sidebarFooterHiddenAtom = createSyncedPreferenceAtom(
  "sidebar.hiddenFooterItems",
);
const RETIRED_FOOTER_ITEM_KEYS = new Set(["plugin:connect/remote-access"]);

export type BuiltinFooterId = "settings";
export type FooterItem = { key: string; label: string; icon: string } & (
  | { kind: "builtin"; id: BuiltinFooterId }
  | { kind: "plugin"; slot: PluginSidebarFooterItemSlot }
);
export function footerPreferenceKey(item: {
  pluginId: string;
  id: string;
}): string {
  return `plugin:${encodeURIComponent(item.pluginId)}/${encodeURIComponent(item.id)}`;
}

export function useSidebarFooterPreferences() {
  const { sidebarFooterItems } = usePluginSlots();
  const [order, setOrder] = useAtom(sidebarFooterOrderAtom);
  const [hidden, setHidden] = useAtom(sidebarFooterHiddenAtom);
  const items: FooterItem[] = [
    {
      kind: "builtin",
      id: "settings",
      key: "builtin:settings",
      label: "Settings",
      icon: "Settings",
    },
    ...sidebarFooterItems.flatMap((slot): FooterItem[] => {
      const key = footerPreferenceKey(slot);
      if (RETIRED_FOOTER_ITEM_KEYS.has(key)) return [];
      return [
        { kind: "plugin", key, label: slot.label, icon: slot.icon, slot },
      ];
    }),
  ];
  const { ordered, normalizedOrder } = arrangeByStoredOrder({
    items,
    storedOrder: order,
    getId: (item) => item.key,
  });
  return {
    items: ordered,
    hidden,
    setVisible(key: string, visible: boolean) {
      setHidden((previous) =>
        visible
          ? previous.filter((id) => id !== key)
          : [...new Set([...previous, key])],
      );
    },
    move(activeId: string, overId: string) {
      const next = reorderStoredOrder({
        activeId,
        overId,
        order: normalizedOrder,
        visibleIds: ordered.map((item) => item.key),
      });
      if (next) setOrder(next);
    },
  };
}
