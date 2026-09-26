export const FORK_CUSTOMIZE_PAGE = true as const;

export const FORK_BUILTIN_THREAD_LIST: boolean = true;

export const FORK_BUILTIN_FILE_OPENER: boolean = true;

export const FORK_HIDDEN_SETTINGS_SECTIONS: readonly string[] = [
  "browser",
  "marketplaces",
  "community",
  ...(FORK_BUILTIN_FILE_OPENER ? ["files"] : []),
];

export const FORK_HIDE_BROWSER: boolean = true;
export const FORK_HIDE_WORKSPACE_CHANGES_BANNER: boolean = true;
export const FORK_AGENT_COMPOSER = true as const;
