import { type ReactElement, useContext, useEffect, useState } from "react";
import type { TimelineConversationAttachments } from "@bb/server-contract";
import { fileNameFromPath } from "@bb/thread-view";
import {
  ImageLightbox,
  getWrappedImageIndex,
} from "../../ui/image-lightbox.js";
import { cn } from "@bb/shared-ui/lib/utils";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@bb/shared-ui/context-menu";
import { buildProjectAttachmentContentUrl } from "@/lib/file-content-urls";
import { copyToClipboardWithToast } from "@/lib/clipboard";
import { downloadRawFile } from "@/lib/raw-file-url";
import { MarkdownLocalFileContextMenuContext } from "../../ui/markdown-link-routing.js";
import { renderMarkdownLocalFileContextMenuItem } from "../../ui/markdown-preview.js";
import type {
  ThreadTimelineLocalFileLinkHandler,
  UserAttachmentImageSrcResolver,
} from "./types.js";

interface ConversationImageItem {
  alt: string;
  src: string;
}

export interface ConversationAttachmentItems {
  filePaths: string[];
  imageItems: ConversationImageItem[];
}

interface ConversationAttachmentsProps extends ConversationAttachmentItems {
  align?: "start" | "end";
  onOpenLocalFileLink?: ThreadTimelineLocalFileLinkHandler;
  projectId?: string;
}

interface BuildAttachmentItemsArgs {
  attachments: TimelineConversationAttachments | null;
  projectId?: string;
  resolveUserAttachmentImageSrc?: UserAttachmentImageSrcResolver;
}

interface ProjectAttachmentHrefArgs {
  path: string;
  projectId: string | undefined;
}

interface PathClassificationArgs {
  path: string;
}

interface AttachmentChipMenuProps {
  children: ReactElement;
  onOpen: () => void;
  path: string;
  projectAttachmentHref: string | null;
}

const WINDOWS_ABSOLUTE_PATH_PATTERN = /^[a-zA-Z]:[\\/]/u;
const URL_SCHEME_PATTERN = /^[a-zA-Z][a-zA-Z0-9+.-]*:/u;

function isAbsoluteLocalPath({ path }: PathClassificationArgs): boolean {
  return path.startsWith("/") || WINDOWS_ABSOLUTE_PATH_PATTERN.test(path);
}

function isProjectAttachmentPath({ path }: PathClassificationArgs): boolean {
  return (
    path.length > 0 &&
    !path.startsWith("\\") &&
    !isAbsoluteLocalPath({ path }) &&
    !URL_SCHEME_PATTERN.test(path)
  );
}

function projectAttachmentHref({
  path,
  projectId,
}: ProjectAttachmentHrefArgs): string | null {
  if (!projectId || !isProjectAttachmentPath({ path })) {
    return null;
  }

  return buildProjectAttachmentContentUrl(projectId, path);
}

function AttachmentChipMenu({
  children,
  onOpen,
  path,
  projectAttachmentHref,
}: AttachmentChipMenuProps) {
  const getLocalFileContextMenuItems = useContext(
    MarkdownLocalFileContextMenuContext,
  );
  const localFileItems =
    projectAttachmentHref === null && getLocalFileContextMenuItems !== null
      ? getLocalFileContextMenuItems({ lineRange: null, path })
      : null;

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="min-w-44">
        <ContextMenuItem onSelect={onOpen}>Open preview</ContextMenuItem>
        <ContextMenuSeparator />
        {localFileItems === null ? (
          <>
            {projectAttachmentHref === null ? null : (
              <ContextMenuItem
                onSelect={() => {
                  downloadRawFile(
                    projectAttachmentHref,
                    fileNameFromPath(path),
                  );
                }}
              >
                Download
              </ContextMenuItem>
            )}
            <ContextMenuItem
              onSelect={() => {
                void copyToClipboardWithToast(path, {
                  successMessage: "File path copied",
                  errorMessage: "Failed to copy file path",
                });
              }}
            >
              Copy file path
            </ContextMenuItem>
          </>
        ) : (
          localFileItems.map(renderMarkdownLocalFileContextMenuItem)
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}

export function buildAttachmentItems({
  attachments,
  projectId,
  resolveUserAttachmentImageSrc,
}: BuildAttachmentItemsArgs): ConversationAttachmentItems {
  if (!attachments) {
    return {
      filePaths: [],
      imageItems: [],
    };
  }

  const imageItems: ConversationImageItem[] = [
    ...attachments.imageUrls.map((url) => ({
      alt: fileNameFromPath(url),
      src: url,
    })),
    ...attachments.localImagePaths.map((path) => ({
      alt: fileNameFromPath(path),
      src: resolveUserAttachmentImageSrc
        ? resolveUserAttachmentImageSrc(path, projectId)
        : path,
    })),
  ];

  return {
    filePaths: attachments.localFilePaths,
    imageItems,
  };
}

export function ConversationAttachments({
  align = "start",
  filePaths,
  imageItems,
  onOpenLocalFileLink,
  projectId,
}: ConversationAttachmentsProps) {
  const [expandedImageIndex, setExpandedImageIndex] = useState<number | null>(
    null,
  );
  const currentImageItem =
    expandedImageIndex === null
      ? null
      : (imageItems[expandedImageIndex] ?? null);
  const hasMultipleImages = imageItems.length > 1;
  const justifyClassName = align === "end" ? "justify-end" : "justify-start";

  useEffect(() => {
    if (expandedImageIndex === null || expandedImageIndex < imageItems.length) {
      return;
    }
    setExpandedImageIndex(null);
  }, [expandedImageIndex, imageItems.length]);

  if (filePaths.length === 0 && imageItems.length === 0) {
    return null;
  }

  return (
    <div className="mt-2 space-y-2">
      {imageItems.length > 0 ? (
        <div className={cn("flex flex-wrap gap-2", justifyClassName)}>
          {imageItems.map((imageItem, index) => (
            <button
              type="button"
              key={`${imageItem.src}-${index}`}
              className={cn(
                "cursor-zoom-in overflow-hidden rounded-md border focus-visible:outline-none",
                align === "end"
                  ? "border-border bg-surface-raised"
                  : "border-border bg-surface-recessed",
              )}
              onClick={() => setExpandedImageIndex(index)}
              title={imageItem.alt}
            >
              <img
                src={imageItem.src}
                alt={imageItem.alt}
                className={cn(
                  "object-cover",
                  align === "end" ? "h-20 max-w-36" : "h-16 w-24",
                )}
                loading="lazy"
                decoding="async"
              />
            </button>
          ))}
        </div>
      ) : null}
      {filePaths.length > 0 ? (
        <div className={cn("flex flex-wrap gap-1.5", justifyClassName)}>
          {filePaths.map((path) => {
            const className = cn(
              "inline-flex max-w-full items-center rounded-full border px-2 py-0.5 text-xs text-muted-foreground",
              align === "end"
                ? "border-surface-selected-border bg-surface-raised"
                : "border-border bg-surface-recessed",
            );
            const label = (
              <span className="truncate">{fileNameFromPath(path)}</span>
            );
            const attachmentHref = projectAttachmentHref({ path, projectId });

            if (attachmentHref) {
              return (
                <AttachmentChipMenu
                  key={path}
                  onOpen={() => {
                    window.open(attachmentHref, "_blank", "noreferrer");
                  }}
                  path={path}
                  projectAttachmentHref={attachmentHref}
                >
                  <a
                    href={attachmentHref}
                    target="_blank"
                    rel="noreferrer"
                    className={cn(
                      className,
                      "cursor-pointer hover:bg-state-hover",
                    )}
                  >
                    {label}
                  </a>
                </AttachmentChipMenu>
              );
            }

            if (!onOpenLocalFileLink || !isAbsoluteLocalPath({ path })) {
              return (
                <span key={path} className={cn(className, "cursor-default")}>
                  {label}
                </span>
              );
            }

            const openPreview = () => {
              onOpenLocalFileLink({ lineRange: null, path });
            };
            return (
              <AttachmentChipMenu
                key={path}
                onOpen={openPreview}
                path={path}
                projectAttachmentHref={null}
              >
                <button
                  type="button"
                  className={cn(
                    className,
                    "cursor-pointer hover:bg-state-hover",
                  )}
                  onClick={openPreview}
                >
                  {label}
                </button>
              </AttachmentChipMenu>
            );
          })}
        </div>
      ) : null}
      <ImageLightbox
        title="Attached image preview"
        imageSrc={currentImageItem?.src ?? null}
        imageAlt={currentImageItem?.alt ?? "Attached image"}
        hasMultipleImages={hasMultipleImages}
        onPrevious={() => {
          setExpandedImageIndex(
            expandedImageIndex === null || imageItems.length <= 1
              ? expandedImageIndex
              : getWrappedImageIndex({
                  currentIndex: expandedImageIndex,
                  direction: "previous",
                  itemCount: imageItems.length,
                }),
          );
        }}
        onNext={() => {
          setExpandedImageIndex(
            expandedImageIndex === null || imageItems.length <= 1
              ? expandedImageIndex
              : getWrappedImageIndex({
                  currentIndex: expandedImageIndex,
                  direction: "next",
                  itemCount: imageItems.length,
                }),
          );
        }}
        onClose={() => setExpandedImageIndex(null)}
      />
    </div>
  );
}
