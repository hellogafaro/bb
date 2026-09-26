export const FORK_RELEASE_REPOSITORY = "hellogafaro/bb";

export const FORK_RELEASE_TAG_PREFIX = "desktop-v";

export const FORK_LATEST_RELEASE_API_URL = `https://api.github.com/repos/${FORK_RELEASE_REPOSITORY}/releases/latest`;

export function createForkReleaseDownloadBaseUrl(releaseTag: string): string {
  return `https://github.com/${FORK_RELEASE_REPOSITORY}/releases/download/${releaseTag}/`;
}
