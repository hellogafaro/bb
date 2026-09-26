import semver from "semver";
import { z } from "zod";
import {
  FORK_LATEST_RELEASE_API_URL,
  FORK_RELEASE_TAG_PREFIX,
} from "@bb/domain/fork-release";
import type { SystemVersionResponse } from "@bb/server-contract";
import type { ServerLogger, ServerRuntimeConfig } from "../../types.js";

const LATEST_RELEASE_TIMEOUT_MS = 5_000;
const LATEST_RELEASE_CACHE_TTL_MS = 60 * 60 * 1000;
const UPGRADE_COMMAND = "bb-reload";

const latestReleaseResponseSchema = z
  .object({
    tag_name: z.string().min(1),
  })
  .passthrough();

export interface AppVersionService {
  getSystemVersion(
    args?: AppVersionGetSystemVersionArgs,
  ): Promise<SystemVersionResponse>;
}

interface AppVersionGetSystemVersionArgs {
  forceRefresh?: boolean;
}

interface CreateAppVersionServiceArgs {
  config: Pick<ServerRuntimeConfig, "appVersion" | "isDevelopment">;
  fetchImpl?: typeof fetch;
  githubToken: string | null;
  logger: ServerLogger;
  cacheTtlMs?: number;
  now?: () => number;
}

interface LatestReleaseCacheEntry {
  cachedAt: number;
  latestVersion: string;
}

export function createAppVersionService(
  args: CreateAppVersionServiceArgs,
): AppVersionService {
  const fetchImpl = args.fetchImpl ?? fetch;
  const cacheTtlMs = args.cacheTtlMs ?? LATEST_RELEASE_CACHE_TTL_MS;
  const now = args.now ?? (() => Date.now());
  const logger = args.logger;
  const config = args.config;
  const githubToken = args.githubToken;

  let cache: LatestReleaseCacheEntry | null = null;
  let inflight: Promise<string | null> | null = null;

  async function fetchLatestRelease(): Promise<string | null> {
    const controller = new AbortController();
    const timeoutHandle = setTimeout(
      () => controller.abort(),
      LATEST_RELEASE_TIMEOUT_MS,
    );
    const authenticated = githubToken !== null;
    try {
      const response = await fetchImpl(FORK_LATEST_RELEASE_API_URL, {
        headers: {
          accept: "application/vnd.github+json",
          "user-agent": "bb-app",
          "x-github-api-version": "2022-11-28",
          ...(githubToken === null
            ? {}
            : { authorization: `Bearer ${githubToken}` }),
        },
        signal: controller.signal,
      });
      if (!response.ok) {
        logger.warn(
          {
            status: response.status,
            url: FORK_LATEST_RELEASE_API_URL,
            authenticated,
          },
          authenticated
            ? "Failed to fetch latest bb release from GitHub"
            : "Failed to fetch latest bb release from GitHub; set GITHUB_TOKEN or GH_TOKEN if the release repository is private",
        );
        return null;
      }
      const json = await response.json();
      const parsed = latestReleaseResponseSchema.safeParse(json);
      if (!parsed.success) {
        logger.warn(
          { url: FORK_LATEST_RELEASE_API_URL, issue: parsed.error.message },
          "GitHub latest release response did not match expected shape",
        );
        return null;
      }
      const tagName = parsed.data.tag_name;
      if (!tagName.startsWith(FORK_RELEASE_TAG_PREFIX)) {
        logger.warn(
          { url: FORK_LATEST_RELEASE_API_URL, tagName },
          "GitHub latest release tag is not a desktop-v<version> tag",
        );
        return null;
      }
      return tagName.slice(FORK_RELEASE_TAG_PREFIX.length);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn(
        { url: FORK_LATEST_RELEASE_API_URL, error: message },
        "GitHub latest release lookup failed",
      );
      return null;
    } finally {
      clearTimeout(timeoutHandle);
    }
  }

  async function getLatestVersion(args?: {
    forceRefresh?: boolean;
  }): Promise<string | null> {
    const currentTime = now();
    if (
      args?.forceRefresh !== true &&
      cache !== null &&
      currentTime - cache.cachedAt < cacheTtlMs
    ) {
      return cache.latestVersion;
    }
    if (inflight !== null) {
      return inflight;
    }
    const requestPromise = (async () => {
      const result = await fetchLatestRelease();
      if (result !== null) {
        cache = { cachedAt: now(), latestVersion: result };
      }
      return result;
    })();
    inflight = requestPromise;
    try {
      return await requestPromise;
    } finally {
      if (inflight === requestPromise) {
        inflight = null;
      }
    }
  }

  return {
    async getSystemVersion(
      args: AppVersionGetSystemVersionArgs = {},
    ): Promise<SystemVersionResponse> {
      const baseResponse: SystemVersionResponse = {
        currentVersion: config.appVersion,
        latestVersion: null,
        source: "github",
        updateAvailable: false,
        isDevelopment: config.isDevelopment,
        upgradeCommand: UPGRADE_COMMAND,
      };

      if (config.isDevelopment) {
        return baseResponse;
      }

      const latestVersion = await getLatestVersion({
        forceRefresh: args.forceRefresh,
      });
      if (latestVersion === null) {
        return baseResponse;
      }

      const parsedCurrent = semver.parse(config.appVersion);
      const parsedLatest = semver.parse(latestVersion);
      if (parsedCurrent === null || parsedLatest === null) {
        logger.warn(
          {
            currentVersion: config.appVersion,
            latestVersion,
          },
          "Skipping update check because a version is not valid semver",
        );
        return { ...baseResponse, latestVersion };
      }

      return {
        ...baseResponse,
        latestVersion,
        updateAvailable: semver.gt(parsedLatest, parsedCurrent),
      };
    },
  };
}
