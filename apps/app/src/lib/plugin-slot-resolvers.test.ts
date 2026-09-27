import { describe, expect, it, vi } from "vitest";
import type {
  PluginComposerCustomizationSlot,
  PluginMessageDirectiveSlot,
  PluginPendingInteractionSlot,
} from "./plugin-slots";
import {
  resolveComposerActions,
  resolveComposerBanners,
  resolveComposerDraftObservers,
  resolveComposerEditorEffects,
  resolveComposerPlusMenuItems,
  resolveMessageDirectiveRegistry,
  resolvePendingInteraction,
  resolveReplacement,
} from "./plugin-slot-resolvers";

function Component() {
  return null;
}

function composerCustomization(
  overrides: Partial<PluginComposerCustomizationSlot> &
    Pick<PluginComposerCustomizationSlot, "id">,
): PluginComposerCustomizationSlot {
  return {
    pluginId: "composer-plugin",
    generation: 1,
    ...overrides,
  };
}

describe("Composer slot resolvers", () => {
  it("projects applicable contributions in registration order with generation keys", () => {
    const onDraftChange = vi.fn();
    const match = () => [];
    const all = composerCustomization({
      id: "all",
      actions: [{ id: "action", component: Component }],
      banners: [{ id: "banner", component: Component }],
      plusMenu: [{ id: "menu", label: "Menu", run: () => {} }],
      richText: {
        effects: [{ id: "effect", className: "effect", match }],
        onDraftChange,
      },
    });
    const thread = composerCustomization({
      id: "thread",
      scopes: ["thread"],
      actions: [{ id: "thread-action", component: Component }],
    });
    const newThread = composerCustomization({
      id: "new-thread",
      scopes: ["new-thread"],
      actions: [{ id: "hidden", component: Component }],
    });

    expect(resolveComposerActions([all, thread, newThread], "thread")).toEqual([
      expect.objectContaining({
        key: "composer-plugin/1/all/action",
        customizationId: "all",
      }),
      expect.objectContaining({
        key: "composer-plugin/1/thread/thread-action",
        customizationId: "thread",
      }),
    ]);
    expect(resolveComposerBanners([all], "thread")[0]?.banner.id).toBe(
      "banner",
    );
    expect(resolveComposerPlusMenuItems([all], "thread")[0]?.item.id).toBe(
      "menu",
    );
    expect(resolveComposerEditorEffects([all], "thread")[0]).toEqual(
      expect.objectContaining({ effects: all.richText?.effects }),
    );
    expect(resolveComposerDraftObservers([all], "thread")[0]).toEqual(
      expect.objectContaining({ onDraftChange }),
    );
  });

  it("treats omitted scopes as all, empty scopes as none, and changes keys by generation", () => {
    const all = composerCustomization({
      id: "all",
      actions: [{ id: "action", component: Component }],
    });
    const none = composerCustomization({
      id: "none",
      scopes: [],
      actions: [{ id: "hidden", component: Component }],
    });

    expect(resolveComposerActions([all, none], "side-chat")).toHaveLength(1);
    expect(
      resolveComposerActions([{ ...all, generation: 2 }], "side-chat")[0]?.key,
    ).toBe("composer-plugin/2/all/action");
  });
});

describe("keyed renderer resolvers", () => {
  it("resolves pending interactions by plugin and renderer id", () => {
    const mine: PluginPendingInteractionSlot = {
      pluginId: "mine",
      generation: 1,
      id: "form",
      component: Component,
    };
    const theirs = { ...mine, pluginId: "theirs" };

    expect(resolvePendingInteraction([theirs, mine], "mine", "form")).toBe(
      mine,
    );
    expect(resolvePendingInteraction([mine], "mine", "missing")).toBeNull();
  });

  it("resolves unique directives and reports deterministic collisions", () => {
    const alpha: PluginMessageDirectiveSlot = {
      pluginId: "zeta",
      generation: 1,
      id: "card",
      component: Component,
    };
    const beta = { ...alpha, pluginId: "alpha" };
    const chart = { ...alpha, id: "chart" };

    expect(
      resolveMessageDirectiveRegistry([alpha, beta, chart]).get("card"),
    ).toEqual({ status: "collision", pluginIds: ["alpha", "zeta"] });
  });
});

describe("replacement resolvers", () => {
  it("selects the first applicable provider and reveals the next after removal", () => {
    const alpha = { id: "alpha", applies: false };
    const beta = { id: "beta", applies: true };
    const gamma = { id: "gamma", applies: true };

    expect(
      resolveReplacement([alpha, beta, gamma], (candidate) =>
        Boolean(candidate.applies),
      ),
    ).toEqual({ kind: "plugin", registration: beta });
    expect(
      resolveReplacement([alpha, gamma], (candidate) =>
        Boolean(candidate.applies),
      ),
    ).toEqual({ kind: "plugin", registration: gamma });
    expect(resolveReplacement([], () => true)).toEqual({ kind: "owner" });
  });
});
