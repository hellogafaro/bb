import type { IconName } from "@bb/shared-ui/icon";

interface GetFileNameFromPathArgs {
  path: string;
}

interface HasPathDirectorySegmentArgs {
  path: string;
  segment: string;
}

interface GetFileExtensionArgs {
  path: string;
}

export function getFileNameFromPath({ path }: GetFileNameFromPathArgs): string {
  return path.slice(path.lastIndexOf("/") + 1) || path;
}

function getFileExtension({ path }: GetFileExtensionArgs): string {
  const name = getFileNameFromPath({ path });
  const dotIndex = name.lastIndexOf(".");
  return dotIndex <= 0 ? "" : name.slice(dotIndex + 1).toLowerCase();
}

function hasPathDirectorySegment({
  path,
  segment,
}: HasPathDirectorySegmentArgs): boolean {
  return path.toLowerCase().split("/").slice(0, -1).includes(segment);
}

const ICON_NAME_BY_EXTENSION = new Map<string, IconName>([
  ...["pdf", "doc", "docx", "odt", "rtf", "txt"].map(
    (extension) => [extension, "FileText"] as const,
  ),
  ...["zip", "tar", "gz", "tgz", "bz2", "xz", "7z", "rar"].map(
    (extension) => [extension, "Archive"] as const,
  ),
  ...[
    "apng",
    "avif",
    "bmp",
    "gif",
    "heic",
    "heif",
    "ico",
    "jpeg",
    "jpg",
    "png",
    "svg",
    "tif",
    "tiff",
    "webp",
  ].map((extension) => [extension, "Image"] as const),
  ...["csv", "tsv", "xls", "xlsx", "ods"].map(
    (extension) => [extension, "GridView"] as const,
  ),
  ...["avi", "m4v", "mkv", "mov", "mp4", "mpeg", "mpg", "ogv", "webm"].map(
    (extension) => [extension, "Play"] as const,
  ),
  ...["aac", "aiff", "flac", "m4a", "mp3", "oga", "ogg", "opus", "wav"].map(
    (extension) => [extension, "Mic"] as const,
  ),
  ...["ppt", "pptx", "key", "odp"].map(
    (extension) => [extension, "File"] as const,
  ),
]);

export function resolveRightPanelFileIconName(path: string): IconName {
  const extension = getFileExtension({ path });
  const inReports = hasPathDirectorySegment({ path, segment: "reports" });
  const isMarkdown = extension === "md" || extension === "markdown";
  const isHtml = extension === "html" || extension === "htm";

  if (inReports && (isMarkdown || isHtml)) {
    return "ChartColumn";
  }
  if (isMarkdown) {
    return "File";
  }
  if (isHtml) {
    return "AppWindow";
  }
  return ICON_NAME_BY_EXTENSION.get(extension) ?? "Code";
}
