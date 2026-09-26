export type CoreSettingSectionId =
  | "general"
  | "providers"
  | "appearance"
  | "keyboard"
  | "browser"
  | "files"
  | "projects"
  | "machines"
  | "environment-variables"
  | "updates"
  | "experiments"
  | "community";

export type CoreSettingAvailability =
  | "always"
  | "desktop-browser"
  | "local-helper-setup"
  | "local-daemon"
  | "system-config";

export interface CoreSettingCatalogEntry {
  id: string;
  label: string;
  sectionId: CoreSettingSectionId;
  description: string;
  aliases: readonly string[];
  path: string;
  availability: CoreSettingAvailability;
}

export interface CoreSettingsPageCatalogEntry {
  id: CoreSettingSectionId;
  label: string;
  description: string;
  aliases: readonly string[];
  path: string;
}

const pageDefinitions = [
  {
    id: "general",
    label: "General",
    description: "Thread, link, voice, and privacy preferences.",
    aliases: ["general settings", "preferences"],
  },
  {
    id: "providers",
    label: "Providers",
    description: "Agent providers and completed turn display.",
    aliases: ["provider settings", "models"],
  },
  {
    id: "appearance",
    label: "Appearance",
    description: "Theme, palette, wallpaper, and layout preferences.",
    aliases: ["appearance settings", "display"],
  },
  {
    id: "keyboard",
    label: "Keyboard",
    description: "Keyboard hints and shortcuts.",
    aliases: ["keyboard settings", "keybindings"],
  },
  {
    id: "browser",
    label: "Browser",
    description: "Browser connections and defaults.",
    aliases: ["browser settings"],
  },
  {
    id: "files",
    label: "Files",
    description: "Local editor integration and file openers.",
    aliases: ["file settings", "editor settings"],
  },
  {
    id: "projects",
    label: "Projects",
    description: "Project and repository settings.",
    aliases: ["project settings", "repositories"],
  },
  {
    id: "machines",
    label: "Machines",
    description: "Connected machine and access settings.",
    aliases: ["machine settings", "hosts"],
  },
  {
    id: "environment-variables",
    label: "Environment variables",
    description: "Scoped machine environment variables.",
    aliases: ["environment settings", "env vars"],
  },
  {
    id: "updates",
    label: "Updates",
    description: "App, CLI, and machine updates.",
    aliases: ["update settings", "versions"],
  },
  {
    id: "experiments",
    label: "Experiments",
    description: "Optional early features.",
    aliases: ["experimental settings", "feature flags"],
  },
  {
    id: "community",
    label: "Community",
    description: "BB community destinations.",
    aliases: ["community settings"],
  },
] as const satisfies readonly Omit<CoreSettingsPageCatalogEntry, "path">[];

export const CORE_SETTINGS_PAGES: readonly CoreSettingsPageCatalogEntry[] =
  pageDefinitions.map((entry) => ({
    ...entry,
    path: entry.id === "general" ? "/settings" : `/settings/${entry.id}`,
  }));

type SettingDefinition = Omit<
  CoreSettingCatalogEntry,
  "path" | "availability"
> & {
  availability?: CoreSettingAvailability;
};

const definitions = [
  {
    id: "navigate-after-create",
    label: "Navigate to threads on creation",
    sectionId: "general",
    description: "Choose whether a new thread opens immediately.",
    aliases: ["new thread navigation"],
  },
  {
    id: "markdown-editing",
    label: "Markdown formatting in prompt box",
    sectionId: "general",
    description: "Use rich text formatting while composing a prompt.",
    aliases: ["editor", "rich text"],
  },
  {
    id: "followup-behavior",
    label: "Default thread followup behavior",
    sectionId: "general",
    description: "Choose whether Enter steers or queues a followup.",
    aliases: ["queue", "steer"],
  },
  {
    id: "in-app-links",
    label: "Open links in the in-app browser",
    sectionId: "general",
    description: "Open web links inside BB.",
    aliases: ["browser links"],
    availability: "desktop-browser",
  },
  {
    id: "localhost-links",
    label: "Rewrite localhost links",
    sectionId: "general",
    description: "Point localhost links at the current host.",
    aliases: ["local links"],
  },
  {
    id: "new-branch-prefix",
    label: "New branch prefix",
    sectionId: "general",
    description: "Set the prefix used for new managed branches.",
    aliases: ["git branch"],
  },
  {
    id: "cli-skills",
    label: "bb CLI skills",
    sectionId: "general",
    description: "Install BB skills for command line agents.",
    aliases: ["skills install"],
  },
  {
    id: "microphone",
    label: "Microphone",
    sectionId: "general",
    description: "Select the microphone for voice input.",
    aliases: ["voice input", "audio input"],
  },
  {
    id: "streamer-mode",
    label: "Streamer mode",
    sectionId: "general",
    description: "Hide custom models during screen sharing.",
    aliases: ["privacy", "hide models"],
  },
  {
    id: "anonymous-usage",
    label: "Share anonymous usage data",
    sectionId: "general",
    description: "Control anonymous usage telemetry.",
    aliases: ["telemetry", "analytics"],
  },
  {
    id: "diagnostic-events",
    label: "Show diagnostic events",
    sectionId: "general",
    description: "Show provider diagnostics for troubleshooting.",
    aliases: ["logs", "diagnostics"],
  },
  {
    id: "default-provider",
    label: "Providers",
    sectionId: "providers",
    description: "Set the default agent and its order in provider pickers.",
    aliases: ["provider", "model", "default agent"],
  },
  {
    id: "collapse-finished-turns",
    label: "Collapse finished turns",
    sectionId: "providers",
    description: "Choose how completed provider turns appear.",
    aliases: ["completed turns"],
  },
  {
    id: "theme",
    label: "Theme",
    sectionId: "appearance",
    description: "Choose light, dark, or system appearance.",
    aliases: ["dark mode", "light mode", "appearance"],
  },
  {
    id: "palette",
    label: "Palette",
    sectionId: "appearance",
    description: "Choose the app color palette.",
    aliases: ["colors", "color scheme"],
  },
  {
    id: "favicon-color",
    label: "Favicon color",
    sectionId: "appearance",
    description: "Choose the browser tab icon color.",
    aliases: ["tab icon"],
  },
  {
    id: "wallpaper",
    label: "Wallpaper",
    sectionId: "appearance",
    description: "Choose the workspace background image.",
    aliases: ["background image"],
  },
  {
    id: "split-dimming",
    label: "Fade inactive splits",
    sectionId: "appearance",
    description: "Adjust dimming of inactive split panes.",
    aliases: ["split view"],
  },
  {
    id: "sidebar-footer",
    label: "Sidebar footer",
    sectionId: "appearance",
    description: "Arrange footer items in the sidebar.",
    aliases: ["footer"],
  },
  {
    id: "keyboard-hints",
    label: "Show keyboard hints when holding CMD / Control",
    sectionId: "keyboard",
    description: "Show available shortcuts while holding the modifier key.",
    aliases: ["hotkeys", "keyboard shortcuts"],
  },
  {
    id: "keyboard-shortcuts",
    label: "Keyboard shortcuts",
    sectionId: "keyboard",
    description: "Find and customize keyboard shortcuts.",
    aliases: ["hotkeys", "keybindings"],
  },
  {
    id: "browsers",
    label: "Browsers",
    sectionId: "browser",
    description: "Manage browser connections and browser defaults.",
    aliases: ["browser settings"],
  },
  {
    id: "local-editor-integration",
    label: "Local editor integration",
    sectionId: "files",
    description: "Grant local access for opening files in an editor.",
    aliases: ["editor", "default app"],
    availability: "local-helper-setup",
  },
  {
    id: "directory-open-target",
    label: "Directory default",
    sectionId: "files",
    description: "Choose the app used to open directories.",
    aliases: ["default app", "folder opener"],
    availability: "local-daemon",
  },
  {
    id: "file-open-target",
    label: "File default",
    sectionId: "files",
    description: "Choose the app used to open files.",
    aliases: ["default app", "file opener"],
    availability: "local-daemon",
  },
  {
    id: "file-openers",
    label: "File openers",
    sectionId: "files",
    description: "Choose default openers for file extensions.",
    aliases: ["default app", "file extensions"],
  },
  {
    id: "projects",
    label: "Projects",
    sectionId: "projects",
    description: "Find and manage project settings.",
    aliases: ["repositories", "repo"],
  },
  {
    id: "machines",
    label: "Machines",
    sectionId: "machines",
    description: "Find and manage connected machines.",
    aliases: ["hosts", "computers"],
  },
  {
    id: "machine-access",
    label: "Machine access",
    sectionId: "machines",
    description: "Configure how machines connect to the server.",
    aliases: ["remote access", "connection"],
  },
  {
    id: "connection-method",
    label: "Connection method",
    sectionId: "machines",
    description: "Choose how machines connect to the server.",
    aliases: ["remote access provider", "machine connection"],
  },
  {
    id: "server-address",
    label: "Server address",
    sectionId: "machines",
    description: "Set the server address used by machines.",
    aliases: ["server URL", "remote URL"],
  },
  {
    id: "environment-variables",
    label: "Environment variables",
    sectionId: "environment-variables",
    description: "Manage scoped machine environment variables.",
    aliases: ["env vars", "environment", "secrets"],
  },
  {
    id: "updates",
    label: "Updates",
    sectionId: "updates",
    description: "Check app, CLI, and machine updates.",
    aliases: ["upgrade", "versions"],
  },
  {
    id: "changelog-preview",
    label: "Changelog preview",
    sectionId: "experiments",
    description: "Show recent release notes on the Updates page.",
    aliases: ["release notes"],
  },
  {
    id: "mobile-app",
    label: "Mobile app",
    sectionId: "experiments",
    description: "Enable mobile app pairing features.",
    aliases: ["phone"],
  },
  {
    id: "multi-machine-picker",
    label: "Multi-machine picker",
    sectionId: "experiments",
    description: "Use searchable machine and environment pickers.",
    aliases: ["machine picker"],
  },
  {
    id: "server-move",
    label: "Server move",
    sectionId: "experiments",
    description: "Enable moving the server to another machine.",
    aliases: ["move server"],
  },
  {
    id: "sidebar-progressive-disclosure",
    label: "Sidebar progressive disclosure",
    sectionId: "experiments",
    description: "Reveal sidebar groups progressively.",
    aliases: ["sidebar groups"],
  },
  {
    id: "timeline-windowing",
    label: "Timeline windowing",
    sectionId: "experiments",
    description: "Mount nearby rows in long timelines.",
    aliases: ["timeline performance"],
  },
  {
    id: "community",
    label: "Community",
    sectionId: "community",
    description: "Open BB community destinations.",
    aliases: ["Discord", "GitHub"],
  },
] as const satisfies readonly SettingDefinition[];

export type CoreSettingId = (typeof definitions)[number]["id"];

export const CORE_SETTINGS_CATALOG: readonly CoreSettingCatalogEntry[] =
  definitions.map((entry) => ({
    ...entry,
    path: `${entry.sectionId === "general" ? "/settings" : `/settings/${entry.sectionId}`}?setting=${encodeURIComponent(entry.id)}`,
    availability: "availability" in entry ? entry.availability : "always",
  }));

export function getCoreSettingById(
  id: string,
): CoreSettingCatalogEntry | undefined {
  return CORE_SETTINGS_CATALOG.find((entry) => entry.id === id);
}
