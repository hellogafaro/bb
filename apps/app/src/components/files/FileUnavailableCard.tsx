import { Button } from "@bb/shared-ui/button";
import { EmptyStatePanel } from "@bb/shared-ui/empty-state";
import { Icon } from "@bb/shared-ui/icon";
import { formatByteSize } from "@/components/git-diff/GitDiffCardHeader";
import { fileExt, fileName } from "./editor-routing";
import { FileGlyph } from "./FileGlyph";
import { FILES_COPY } from "./files-copy";

export const FILE_UNAVAILABLE_FRAME_CLASS =
  "flex h-full min-h-0 flex-1 flex-col items-center justify-center p-4";

export const FILE_UNAVAILABLE_CARD_CLASS =
  "flex w-full max-w-md flex-col items-center gap-3 rounded-lg px-4 py-6";

interface FileUnavailableCardProps {
  mimeType: string | null;
  onDownload: (() => void) | null;
  onOpenExternally?: () => void;
  path: string;
  reason: "too-large" | "type";
  sizeBytes: number | null;
}

function describeUnavailableFile(
  path: string,
  reason: FileUnavailableCardProps["reason"],
): string {
  if (reason === "too-large") {
    return "This file is too large to preview.";
  }
  const extension = fileExt(path);
  return extension === ""
    ? "Preview isn't available for this file type."
    : `Preview isn't available for .${extension} files.`;
}

export function FileUnavailableCard({
  mimeType,
  onDownload,
  onOpenExternally,
  path,
  reason,
  sizeBytes,
}: FileUnavailableCardProps) {
  const details = [
    mimeType,
    sizeBytes === null ? null : formatByteSize(sizeBytes),
  ].filter((detail) => detail !== null);
  return (
    <div className={FILE_UNAVAILABLE_FRAME_CLASS}>
      <EmptyStatePanel className={FILE_UNAVAILABLE_CARD_CLASS}>
        <FileGlyph path={path} className="size-8" />
        <div className="flex max-w-full flex-col items-center gap-0.5">
          <p className="max-w-full truncate font-medium text-foreground">
            {fileName(path)}
          </p>
          {details.length === 0 ? null : (
            <p className="text-xs leading-5">{details.join(" · ")}</p>
          )}
        </div>
        <p>{describeUnavailableFile(path, reason)}</p>
        {onDownload === null && !onOpenExternally ? null : (
          <div className="flex flex-wrap justify-center gap-2">
            {onDownload === null ? null : (
              <Button type="button" size="sm" onClick={onDownload}>
                <Icon name="Download" aria-hidden />
                {FILES_COPY.download}
              </Button>
            )}
            {onOpenExternally ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onOpenExternally}
              >
                <Icon name="ExternalLink" aria-hidden />
                {FILES_COPY.openExternally}
              </Button>
            ) : null}
          </div>
        )}
      </EmptyStatePanel>
    </div>
  );
}
