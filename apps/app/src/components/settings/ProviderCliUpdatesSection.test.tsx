// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Host } from "@bb/domain";
import { makeHost as makeHostFixture } from "@bb/test-helpers/domain-fixtures";
import { TooltipProvider } from "@bb/shared-ui/tooltip";
import {
  useProviderCliInstallRunner,
  type ProviderCliActionableIssue,
  type ProviderCliIssue,
} from "@/components/provider-cli/provider-cli-install";
import {
  getProviderCliInstallSnapshot,
  resetProviderCliInstallStoreForTests,
} from "@/components/provider-cli/provider-cli-install-store";
import { invalidateHostProviderCliStatus } from "@/hooks/cache-owners/provider-cli-status-cache-owner";
import {
  useUpdateInventory,
  type UpdateInventory,
  type UpdateInventoryMachine,
} from "@/hooks/useUpdateInventory";
import { ProviderCliUpdatesSection } from "./ProviderCliUpdatesSection";

vi.mock("@/hooks/useUpdateInventory", () => ({
  useUpdateInventory: vi.fn(),
}));

vi.mock("@/hooks/useHostDaemon", () => ({
  useHostDaemon: () => ({ localDaemonHostId: "host_laptop" }),
}));

vi.mock("@/hooks/queries/system-queries", () => ({
  useSystemConfig: () => ({ data: { primaryHostId: "host_server" } }),
  useSystemProviders: () => ({ data: [] }),
}));

vi.mock("@/hooks/cache-owners/provider-cli-status-cache-owner", () => ({
  invalidateHostProviderCliStatus: vi.fn(async () => undefined),
}));

const startInstallMock = vi.fn();

vi.mock("@/components/provider-cli/provider-cli-install", async (original) => ({
  ...(await original<
    typeof import("@/components/provider-cli/provider-cli-install")
  >()),
  useProviderCliInstallRunner: vi.fn(),
}));

const useUpdateInventoryMock = vi.mocked(useUpdateInventory);
const useProviderCliInstallRunnerMock = vi.mocked(useProviderCliInstallRunner);
const invalidateMock = vi.mocked(invalidateHostProviderCliStatus);

function makeHost(overrides: Partial<Host> & Pick<Host, "id" | "name">): Host {
  return makeHostFixture({
    lastSeenAt: Date.now(),
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  });
}

function makeUpdateIssue(
  provider: "codex" | "claude-code",
): ProviderCliActionableIssue {
  const displayName = provider === "codex" ? "Codex" : "Claude Code";
  const executableName = provider === "codex" ? "codex" : "claude";
  const action = {
    kind: "update" as const,
    label: "Update" as const,
    command: `${executableName} update`,
  };
  return {
    provider,
    status: {
      displayName,
      executableName,
      executablePath: `/usr/local/bin/${executableName}`,
      installed: true,
      installSource: "npmGlobal",
      currentVersion: "1.0.0",
      latestVersion: "1.0.1",
      minimumSupportedVersion: null,
      npmPackageName: null,
      npmGlobalPackageVersion: null,
      installAction: action,
      needsUpdate: true,
      versionUnsupported: false,
    },
    action,
    title: `${displayName} update available`,
    description: "1.0.0 -> 1.0.1",
    fingerprint: `${provider}:outdated`,
  };
}

function makeMachine(args: {
  host: Host;
  issues?: ProviderCliIssue[];
  statusError?: boolean;
}): UpdateInventoryMachine {
  const issues = args.issues ?? [];
  const status = (provider: "codex" | "claude-code") => {
    const issue = issues.find((entry) => entry.provider === provider);
    if (issue !== undefined) {
      return issue.status;
    }
    const base = makeUpdateIssue(provider).status;
    return { ...base, latestVersion: base.currentVersion, needsUpdate: false };
  };
  const connected = args.host.status === "connected" && !args.statusError;
  return {
    host: args.host,
    isPrimary: false,
    providerStatus: connected
      ? { codex: status("codex"), "claude-code": status("claude-code") }
      : null,
    statusPending: false,
    statusFetching: false,
    statusError: args.statusError ?? false,
    issues,
    canRetryDaemonUpdate: false,
  };
}

function makeInventory(machines: UpdateInventoryMachine[]): UpdateInventory {
  return {
    isLoading: false,
    systemVersion: undefined,
    desktopInfo: null,
    appUpdateAvailable: false,
    desktopUpdateReady: false,
    machines,
    pluginAttentionCount: 0,
    actionableCount: 0,
    hasAttention: false,
    lastCheckedAt: null,
  };
}

function useRunner(
  overrides: Partial<ReturnType<typeof useProviderCliInstallRunner>> = {},
): void {
  useProviderCliInstallRunnerMock.mockReturnValue({
    failuresByJobKey: new Map(),
    queuedJobKeys: new Set<string>(),
    runningJobKey: null,
    startInstall: startInstallMock,
    ...overrides,
  });
}

function renderSection(): void {
  render(
    <MemoryRouter>
      <TooltipProvider>
        <QueryClientProvider client={new QueryClient()}>
          <ProviderCliUpdatesSection />
        </QueryClientProvider>
      </TooltipProvider>
    </MemoryRouter>,
  );
}

function providerRow(name: string): HTMLElement {
  const row = screen
    .getAllByText(name)
    .map((element) => element.closest("[data-resource-row]"))
    .find((element): element is HTMLElement => element instanceof HTMLElement);
  if (row === undefined) {
    throw new Error(`No row for ${name}`);
  }
  return row;
}

const server = makeHost({ id: "host_server", name: "server" });
const laptop = makeHost({ id: "host_laptop", name: "laptop" });

beforeEach(() => {
  useRunner();
});

afterEach(() => {
  cleanup();
  resetProviderCliInstallStoreForTests();
  vi.clearAllMocks();
});

describe("ProviderCliUpdatesSection", () => {
  it("lists each machine's CLI versions and runs updates through the install runner", () => {
    const issue = makeUpdateIssue("claude-code");
    useUpdateInventoryMock.mockReturnValue(
      makeInventory([
        makeMachine({ host: server, issues: [issue] }),
        makeMachine({ host: laptop }),
      ]),
    );

    renderSection();

    expect(screen.getByText("Provider CLIs")).toBeDefined();
    expect(screen.getByText("server")).toBeDefined();
    expect(screen.getByText("laptop")).toBeDefined();
    expect(screen.getByText("Server")).toBeDefined();
    expect(screen.getByText("This machine")).toBeDefined();
    expect(screen.getAllByText("Codex")).toHaveLength(2);
    expect(
      document.querySelectorAll('[data-update-state="up-to-date"]'),
    ).toHaveLength(3);
    expect(screen.getByText("1.0.1")).toBeDefined();

    fireEvent.click(
      screen.getByRole("button", {
        name: "Update available · Update Claude Code on server",
      }),
    );
    expect(startInstallMock).toHaveBeenCalledWith({
      hostId: "host_server",
      issue,
    });
    expect(invalidateMock).toHaveBeenCalledWith(
      expect.objectContaining({ hostId: "host_server" }),
    );
    expect(invalidateMock).toHaveBeenCalledWith(
      expect.objectContaining({ hostId: "host_laptop" }),
    );
  });

  it("shows an installing CLI as in progress without an action", () => {
    const issue = makeUpdateIssue("codex");
    useUpdateInventoryMock.mockReturnValue(
      makeInventory([makeMachine({ host: server, issues: [issue] })]),
    );
    useRunner({ runningJobKey: "host_server:codex" });

    renderSection();

    expect(
      providerRow("Codex").querySelector('[data-update-state="in-progress"]'),
    ).not.toBeNull();
    expect(
      screen.queryByRole("button", { name: /Update Codex on server/ }),
    ).toBeNull();
  });

  it("keeps a failed install's error, log, and retry on the row", () => {
    const issue = makeUpdateIssue("claude-code");
    const logDialogState = {
      displayName: "Claude Code",
      log: "$ claude update\npermission denied\n",
      message: "Command exited with code 1",
      title: "Claude Code update log",
    };
    useUpdateInventoryMock.mockReturnValue(
      makeInventory([makeMachine({ host: server, issues: [issue] })]),
    );
    useRunner({
      failuresByJobKey: new Map([
        [
          "host_server:claude-code",
          { issueFingerprint: issue.fingerprint, logDialogState },
        ],
      ]),
    });

    renderSection();

    expect(screen.getByRole("alert").textContent).toBe(
      "Command exited with code 1",
    );
    fireEvent.click(
      screen.getByRole("button", { name: "View Claude Code update log" }),
    );
    expect(getProviderCliInstallSnapshot().logDialogState).toEqual(
      logDialogState,
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: "Failed · Retry Claude Code on server",
      }),
    );
    expect(startInstallMock).toHaveBeenCalledWith({
      hostId: "host_server",
      issue,
    });
  });

  it("updates every actionable CLI across machines from Update all", () => {
    const serverIssue = makeUpdateIssue("claude-code");
    const laptopIssue = makeUpdateIssue("codex");
    useUpdateInventoryMock.mockReturnValue(
      makeInventory([
        makeMachine({ host: server, issues: [serverIssue] }),
        makeMachine({ host: laptop, issues: [laptopIssue] }),
      ]),
    );

    renderSection();

    fireEvent.click(
      screen.getByRole("button", { name: "Update all 2 CLI tools" }),
    );
    expect(startInstallMock).toHaveBeenCalledWith({
      hostId: "host_server",
      issue: serverIssue,
    });
    expect(startInstallMock).toHaveBeenCalledWith({
      hostId: "host_laptop",
      issue: laptopIssue,
    });
  });

  it("offers a recheck when a machine's CLI status fails", () => {
    useUpdateInventoryMock.mockReturnValue(
      makeInventory([makeMachine({ host: server, statusError: true })]),
    );

    renderSection();
    invalidateMock.mockClear();

    fireEvent.click(
      screen.getByRole("button", {
        name: "Failed · Check server's CLIs again",
      }),
    );
    expect(invalidateMock).toHaveBeenCalledWith(
      expect.objectContaining({ hostId: "host_server" }),
    );
  });

  it("leaves offline machines and never-installed CLIs off the list", () => {
    useUpdateInventoryMock.mockReturnValue(
      makeInventory([
        makeMachine({
          host: makeHost({
            id: "host_offline",
            name: "offline",
            status: "disconnected",
          }),
        }),
      ]),
    );

    renderSection();

    expect(screen.queryByText("offline")).toBeNull();
    expect(screen.getByText("No provider CLIs installed.")).toBeDefined();
  });
});
