import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  TEXT_FILE_PREVIEW_MAX_BYTES,
  type FilePreviewLineRange,
} from "@bb/client-core";
import { Button } from "@bb/shared-ui/button";
import {
  COARSE_POINTER_COMPACT_ICON_BUTTON_CLASS,
  COARSE_POINTER_TOOLBAR_ACTION_BUTTON_CLASS,
} from "@bb/shared-ui/coarse-pointer-sizing";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@bb/shared-ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@bb/shared-ui/dropdown-menu";
import { Icon } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import { preventOverlayTriggerSelection } from "@bb/shared-ui/overlay-trigger";
import { Tooltip, TooltipContent, TooltipTrigger } from "@bb/shared-ui/tooltip";
import { appToast } from "@/components/ui/app-toast";
import { splitAbsoluteHostFilePath } from "@/hooks/queries/host-file-preview-query";
import {
  buildRawFileUrl,
  downloadRawFile,
  type RawFileSource,
} from "@/lib/raw-file-url";
import { probeFileMetadata, type FileMetadataProbe } from "@/lib/api";
import { sdk } from "@/lib/sdk";
import type { FileEditorHandle } from "./CodeEditor";
import {
  fileLocationKey,
  useFileDocumentStore,
  type DiskChange,
  type DiskFile,
  type DiskState,
  type Draft,
  type FileDocumentStore,
} from "./file-document-store";
import { FileGlyph } from "./FileGlyph";
import { FileUnavailableCard } from "./FileUnavailableCard";
import { fileName, isImagePath, isMarkdownPath } from "./file-paths";
import { useFileTarget, type FileTargetSource } from "./file-target";
import type { FileLocation } from "./files-transport";
import { FILES_COPY } from "./files-copy";
import { FileSkeleton } from "./FileSkeleton";

const CodeEditor = lazy(() =>
  import("./CodeEditor").then(({ CodeEditor }) => ({ default: CodeEditor })),
);
const MarkdownEditor = lazy(() =>
  import("./MarkdownEditor").then(({ MarkdownEditor }) => ({
    default: MarkdownEditor,
  })),
);

const AUTOSAVE_DELAY_MS = 5_000;
const RICH_MARKDOWN_MAX_CHARS = 500_000;

type Conflict =
  | null
  | { kind: "changed"; sha256: string }
  | { kind: "missing" };

interface FileEditorProps {
  source: FileTargetSource;
  displayPath: string;
  copyPath: string | null;
  lineRange: FilePreviewLineRange | null;
  isPanelOpen: boolean;
  onOpenInEditor?: (path: string) => void;
  onSelectionAddToChat?: (text: string) => void;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function Notice({ children }: { children: ReactNode }) {
  return (
    <p className="px-4 py-2.5 text-sm text-muted-foreground">{children}</p>
  );
}

function isEditable(path: string, file: DiskFile): boolean {
  return file.encoding === "utf8" && !isImagePath(path);
}

function imageSource(file: DiskFile): string {
  return file.encoding === "base64"
    ? `data:${file.mimeType ?? "image/*"};base64,${file.content}`
    : `data:${file.mimeType ?? "application/octet-stream"};charset=utf-8,${encodeURIComponent(file.content)}`;
}

async function resolveRawUrl(
  rawSource: RawFileSource | null,
  sourcePath: string,
  location: FileLocation,
  download: boolean,
): Promise<string> {
  const rawUrl =
    rawSource === null
      ? null
      : buildRawFileUrl(rawSource, sourcePath, { download });
  if (rawUrl !== null) return rawUrl;
  const { name, rootPath } = splitAbsoluteHostFilePath(location.absolutePath);
  const lease = await sdk.files.createPreview({
    hostId: location.hostId,
    rootPath,
  });
  return `${lease.baseUrl}/${encodeURIComponent(name)}`;
}

async function copyText(value: string, success: string, failure: string) {
  try {
    await navigator.clipboard.writeText(value);
    appToast.success(success);
  } catch {
    appToast.error(failure);
  }
}

export function FileEditor(props: FileEditorProps) {
  const target = useFileTarget(props.source);
  if (target.status === "loading") return <FileSkeleton />;
  if (target.status === "unavailable") return <Notice>{target.message}</Notice>;
  return (
    <FileSession
      key={fileLocationKey(target.location)}
      location={target.location}
      rawSource={target.rawSource}
      {...props}
    />
  );
}

interface FileSessionProps extends FileEditorProps {
  location: FileLocation;
  rawSource: RawFileSource | null;
}

function FileSession({
  location,
  rawSource,
  source,
  displayPath,
  copyPath,
  lineRange,
  isPanelOpen,
  onOpenInEditor,
  onSelectionAddToChat,
}: FileSessionProps) {
  const store = useFileDocumentStore();
  const name = fileName(displayPath);
  const markdown = isMarkdownPath(displayPath);
  const root = useRef<HTMLDivElement>(null);
  const handle = useRef<FileEditorHandle | null>(null);
  const writer = useRef({});
  const [disk, setDisk] = useState<DiskState>(() => store.getState(location));
  const [base, setBase] = useState<DiskFile | null>(null);
  const [draft, setDraft] = useState("");
  const [revision, setRevision] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [conflict, setConflict] = useState<Conflict>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [deleted, setDeleted] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const [wrap, setWrap] = useState(false);
  const [sourceMode, setSourceMode] = useState(
    () => lineRange?.startLineNumber != null,
  );
  const baseRef = useRef<DiskFile | null>(null);
  const dirtyRef = useRef(false);
  const conflictRef = useRef<Conflict>(null);
  const savingRef = useRef(false);
  const deletedRef = useRef(false);
  const restoredDraft = useRef<Draft | null>(null);
  const autosaveTimer = useRef<number | null>(null);
  const saveRef = useRef<() => Promise<void>>(async () => undefined);
  const pendingWrite = useRef<Promise<void>>(Promise.resolve());

  const updateConflict = useCallback((next: Conflict) => {
    conflictRef.current = next;
    setConflict(next);
  }, []);

  const updateDirty = useCallback((next: boolean) => {
    dirtyRef.current = next;
    setDirty(next);
  }, []);

  const cancelAutosave = useCallback(() => {
    if (autosaveTimer.current === null) return;
    window.clearTimeout(autosaveTimer.current);
    autosaveTimer.current = null;
  }, []);

  const scheduleAutosave = useCallback(() => {
    cancelAutosave();
    autosaveTimer.current = window.setTimeout(() => {
      autosaveTimer.current = null;
      void saveRef.current();
    }, AUTOSAVE_DELAY_MS);
  }, [cancelAutosave]);

  const adopt = useCallback(
    (file: DiskFile) => {
      baseRef.current = file;
      setBase(file);
      setDraft(file.content);
      setRevision((current) => current + 1);
      updateDirty(false);
      updateConflict(null);
      setSaveError(null);
      setImageFailed(false);
      cancelAutosave();
    },
    [cancelAutosave, updateConflict, updateDirty],
  );

  const onDiskChange = useCallback(
    ({ state, writer: source }: DiskChange) => {
      setDisk(state);
      if (state.status === "missing") {
        const restored = restoredDraft.current;
        if (baseRef.current === null && restored !== null) {
          restoredDraft.current = null;
          adopt({
            content: "",
            encoding: "utf8",
            mimeType: null,
            sha256: restored.baseSha256,
            sizeBytes: 0,
          });
          setDraft(restored.text);
          updateDirty(true);
        }
        if (baseRef.current !== null && !deletedRef.current) {
          updateConflict({ kind: "missing" });
        }
        return;
      }
      if (state.status !== "ready") return;
      const file = state.file;
      const current = baseRef.current;
      if (source === writer.current) {
        baseRef.current = file;
        setBase(file);
        updateConflict(null);
        const live = handle.current?.getDoc() ?? file.content;
        updateDirty(live !== file.content);
        return;
      }
      if (current === null) {
        adopt(file);
        const restored = restoredDraft.current;
        restoredDraft.current = null;
        if (restored === null || restored.text === file.content) return;
        setDraft(restored.text);
        updateDirty(true);
        if (restored.baseSha256 !== file.sha256) {
          updateConflict({ kind: "changed", sha256: file.sha256 });
        } else {
          scheduleAutosave();
        }
        return;
      }
      if (current.sha256 === file.sha256) {
        if (conflictRef.current?.kind === "missing") updateConflict(null);
        return;
      }
      if (handle.current?.isComposing() ?? false) {
        updateConflict({ kind: "changed", sha256: file.sha256 });
        return;
      }
      if (
        !dirtyRef.current ||
        (handle.current?.getDoc() ?? current.content) === file.content
      ) {
        adopt(file);
        return;
      }
      updateConflict({ kind: "changed", sha256: file.sha256 });
    },
    [adopt, scheduleAutosave, updateConflict, updateDirty],
  );

  const onDiskChangeRef = useRef(onDiskChange);
  onDiskChangeRef.current = onDiskChange;
  const subscription = useRef<ReturnType<
    FileDocumentStore["subscribe"]
  > | null>(null);

  useLayoutEffect(() => {
    restoredDraft.current = store.takeDraft(location);
    const active = store.subscribe(location, (change) =>
      onDiskChangeRef.current(change),
    );
    subscription.current = active;
    onDiskChangeRef.current({ state: store.getState(location), writer: null });
    return () => {
      cancelAutosave();
      const current = baseRef.current;
      const text = handle.current?.getDoc() ?? null;
      if (
        current !== null &&
        dirtyRef.current &&
        !deletedRef.current &&
        text !== null &&
        text !== current.content
      ) {
        const pending = { text, baseSha256: current.sha256 };
        if (conflictRef.current !== null) {
          store.retainDraft(location, pending);
        } else {
          void store.flushDraft(location, pending, writer.current).then(
            (result) => {
              if (result.outcome === "conflict") {
                appToast.error(
                  `${fileName(location.absolutePath)}: ${FILES_COPY.diskConflict}`,
                );
              }
            },
            (error: unknown) => appToast.error(errorText(error)),
          );
        }
      }
      active.unsubscribe();
      subscription.current = null;
    };
  }, [cancelAutosave, location, store]);

  useEffect(() => {
    const node = root.current;
    if (node === null) return;
    let intersecting = false;
    const update = () =>
      subscription.current?.setActive(isPanelOpen && intersecting);
    const observer = new IntersectionObserver(([entry]) => {
      intersecting = entry?.isIntersecting ?? false;
      update();
    });
    observer.observe(node);
    update();
    return () => {
      observer.disconnect();
      subscription.current?.setActive(false);
    };
  }, [isPanelOpen]);

  useEffect(() => {
    setSourceMode(lineRange?.startLineNumber != null);
  }, [lineRange?.startLineNumber]);

  const markDirty = useCallback(
    (next: boolean) => {
      updateDirty(next);
      if (!next) {
        cancelAutosave();
        return;
      }
      store.touch(location);
      scheduleAutosave();
    },
    [cancelAutosave, location, scheduleAutosave, store, updateDirty],
  );

  const writeText = useCallback(
    (text: string, expectedSha256: string | null) => {
      const write = (async () => {
        cancelAutosave();
        savingRef.current = true;
        setSaving(true);
        setSaveError(null);
        try {
          const result = await store.write(
            location,
            text,
            expectedSha256,
            writer.current,
          );
          if (result.outcome === "conflict") {
            updateConflict(
              result.currentSha256 === null
                ? { kind: "missing" }
                : { kind: "changed", sha256: result.currentSha256 },
            );
          } else if (dirtyRef.current) {
            scheduleAutosave();
          }
        } catch (error) {
          setSaveError(errorText(error));
        } finally {
          savingRef.current = false;
          setSaving(false);
        }
      })();
      pendingWrite.current = write;
      return write;
    },
    [cancelAutosave, location, scheduleAutosave, store, updateConflict],
  );

  const save = useCallback(async () => {
    const current = baseRef.current;
    if (
      current === null ||
      !isEditable(displayPath, current) ||
      !dirtyRef.current ||
      conflictRef.current !== null ||
      deletedRef.current ||
      savingRef.current ||
      (handle.current?.isComposing() ?? false)
    ) {
      return;
    }
    const text = handle.current?.getDoc() ?? current.content;
    if (text === current.content) {
      markDirty(false);
      return;
    }
    await writeText(text, current.sha256);
  }, [displayPath, markDirty, writeText]);

  saveRef.current = save;
  const onSave = useCallback(() => void saveRef.current(), []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "s")
        return;
      if (
        event.defaultPrevented ||
        !root.current?.contains(document.activeElement)
      )
        return;
      event.preventDefault();
      void saveRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const overwrite = () => {
    const standing = conflictRef.current;
    if (standing === null || savingRef.current) return;
    const text = handle.current?.getDoc() ?? baseRef.current?.content ?? "";
    updateConflict(null);
    void writeText(text, standing.kind === "missing" ? null : standing.sha256);
  };

  const reload = () => {
    if (savingRef.current) return;
    const state = store.getState(location);
    if (state.status === "ready") {
      adopt(state.file);
      return;
    }
    void store.reload(location);
  };

  const remove = async () => {
    if (savingRef.current) return;
    cancelAutosave();
    deletedRef.current = true;
    setDeleted(true);
    try {
      await store.remove(location);
      setConfirmDelete(false);
    } catch (error) {
      deletedRef.current = false;
      setDeleted(false);
      setSaveError(errorText(error));
    }
  };

  const liveText = () => handle.current?.getDoc() ?? base?.content ?? "";
  const oversized =
    base !== null &&
    base.sizeBytes > TEXT_FILE_PREVIEW_MAX_BYTES &&
    !isImagePath(displayPath);
  const editable = base !== null && !oversized && isEditable(displayPath, base);
  const richMarkdown =
    markdown && editable && draft.length <= RICH_MARKDOWN_MAX_CHARS;
  const readOnly = deleted || conflict?.kind === "missing";

  const flushBeforeDownload = async (): Promise<boolean> => {
    await pendingWrite.current;
    if (readOnly || !dirtyRef.current) return true;
    await saveRef.current();
    return !dirtyRef.current;
  };

  const download = async () => {
    if (!(await flushBeforeDownload())) {
      appToast.error(FILES_COPY.downloadFailed);
      return;
    }
    try {
      downloadRawFile(
        await resolveRawUrl(rawSource, source.path, location, true),
        name,
      );
    } catch (error) {
      appToast.error(FILES_COPY.downloadFailed, {
        description: errorText(error),
      });
    }
  };

  const tooLargeUnread = base === null && disk.status === "too-large";
  const [tooLargeMetadata, setTooLargeMetadata] =
    useState<FileMetadataProbe | null>(null);
  useEffect(() => {
    setTooLargeMetadata(null);
    if (!tooLargeUnread) return;
    const controller = new AbortController();
    void resolveRawUrl(rawSource, source.path, location, false)
      .then((url) => probeFileMetadata(url, controller.signal))
      .then((metadata) => {
        if (!controller.signal.aborted) setTooLargeMetadata(metadata);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [location, rawSource, source.path, tooLargeUnread]);

  const tooLargeCard = (mimeType: string | null, sizeBytes: number | null) => (
    <FileUnavailableCard
      mimeType={mimeType}
      onDownload={() => void download()}
      onOpenExternally={
        onOpenInEditor ? () => onOpenInEditor(displayPath) : undefined
      }
      path={displayPath}
      reason="too-large"
      sizeBytes={sizeBytes}
    />
  );

  let banner: ReactNode = null;
  if (conflict?.kind === "changed") {
    banner = (
      <ConflictBanner message={FILES_COPY.diskConflict}>
        <Button
          type="button"
          variant="ghost"
          disabled={saving}
          className={COARSE_POINTER_TOOLBAR_ACTION_BUTTON_CLASS}
          onClick={overwrite}
        >
          {FILES_COPY.overwrite}
        </Button>
        <Button
          type="button"
          variant="ghost"
          disabled={saving}
          className={COARSE_POINTER_TOOLBAR_ACTION_BUTTON_CLASS}
          onClick={reload}
        >
          {FILES_COPY.reload}
        </Button>
      </ConflictBanner>
    );
  } else if (conflict?.kind === "missing" && !deleted) {
    banner = (
      <ConflictBanner message={FILES_COPY.deletedOnDisk}>
        <Button
          type="button"
          variant="ghost"
          disabled={saving}
          className={COARSE_POINTER_TOOLBAR_ACTION_BUTTON_CLASS}
          onClick={overwrite}
        >
          {FILES_COPY.recreate}
        </Button>
      </ConflictBanner>
    );
  } else if (saveError !== null) {
    banner = (
      <ConflictBanner message={saveError}>
        <Button
          type="button"
          variant="ghost"
          className={COARSE_POINTER_TOOLBAR_ACTION_BUTTON_CLASS}
          disabled={saving}
          onClick={() => {
            setSaveError(null);
            void saveRef.current();
          }}
        >
          {FILES_COPY.retry}
        </Button>
      </ConflictBanner>
    );
  }

  let body: ReactNode;
  if (deleted) {
    body = <Notice>{FILES_COPY.deleted(name)}</Notice>;
  } else if (tooLargeUnread) {
    body = tooLargeCard(
      tooLargeMetadata?.mimeType ?? null,
      tooLargeMetadata?.sizeBytes ?? null,
    );
  } else if (base === null) {
    body =
      disk.status === "loading" ? (
        <FileSkeleton />
      ) : disk.status === "error" ? (
        <ConflictBanner message={disk.message}>
          <Button
            type="button"
            variant="ghost"
            className={COARSE_POINTER_TOOLBAR_ACTION_BUTTON_CLASS}
            onClick={() => void store.reload(location)}
          >
            {FILES_COPY.retry}
          </Button>
        </ConflictBanner>
      ) : (
        <Notice>{FILES_COPY.unavailable}</Notice>
      );
  } else if (oversized) {
    body = tooLargeCard(base.mimeType, base.sizeBytes);
  } else if (isImagePath(displayPath)) {
    body = imageFailed ? (
      <Notice>{FILES_COPY.imageUnavailable}</Notice>
    ) : (
      <img
        alt={name}
        src={imageSource(base)}
        onError={() => setImageFailed(true)}
        className="h-full w-full object-contain p-4"
      />
    );
  } else if (!editable) {
    body = <Notice>{FILES_COPY.binaryFile(name)}</Notice>;
  } else if (richMarkdown && !sourceMode) {
    body = (
      <MarkdownEditor
        path={displayPath}
        value={draft}
        revision={revision}
        onDirty={markDirty}
        onAddToChat={onSelectionAddToChat}
        readOnly={readOnly}
        handleRef={handle}
      />
    );
  } else {
    body = (
      <CodeEditor
        path={displayPath}
        value={draft}
        cleanValue={base.content}
        revision={revision}
        onDirty={markDirty}
        onSave={onSave}
        onAddToChat={onSelectionAddToChat}
        readOnly={readOnly}
        wrap={wrap}
        startLine={lineRange?.startLineNumber}
        endLine={lineRange?.endLineNumber}
        handleRef={handle}
      />
    );
  }

  return (
    <div
      ref={root}
      data-file-editor=""
      className="flex h-full min-h-0 flex-col overflow-hidden"
    >
      <div className="flex shrink-0 items-center gap-1 px-4 pt-0.5 pb-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              aria-label={FILES_COPY.copyPath}
              className={cn(
                COARSE_POINTER_TOOLBAR_ACTION_BUTTON_CLASS,
                "min-w-0 max-w-full justify-start gap-1.5 font-normal text-muted-foreground",
              )}
              onMouseDown={preventOverlayTriggerSelection}
              onClick={() =>
                void copyText(
                  copyPath ?? displayPath,
                  FILES_COPY.pathCopied,
                  FILES_COPY.pathCopyFailed,
                )
              }
            >
              <FileGlyph path={displayPath} />
              <span className="min-w-0 truncate">{displayPath}</span>
              <span
                className={cn(
                  "size-1.5 shrink-0 rounded-full bg-primary",
                  !dirty && "invisible",
                )}
                aria-label={dirty ? FILES_COPY.unsaved : undefined}
                aria-hidden={!dirty}
              />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">{FILES_COPY.copyPath}</TooltipContent>
        </Tooltip>
        <div className="ml-auto flex shrink-0 items-center gap-1">
          <span
            aria-hidden={!saving}
            className={cn(
              "flex items-center gap-1.5 px-2 text-xs text-muted-foreground",
              !saving && "invisible",
            )}
          >
            <Icon
              name="Spinner"
              className="size-3.5 animate-spin"
              aria-hidden
            />
            {FILES_COPY.saving}
          </span>
          {editable && (!richMarkdown || sourceMode) ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-pressed={wrap}
                  aria-label={FILES_COPY.wrapLines}
                  className={COARSE_POINTER_COMPACT_ICON_BUTTON_CLASS}
                  onMouseDown={preventOverlayTriggerSelection}
                  onClick={() => setWrap((current) => !current)}
                >
                  <Icon name="TextWrap" aria-hidden />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                {FILES_COPY.wrapLines}
              </TooltipContent>
            </Tooltip>
          ) : null}
          {richMarkdown ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-pressed={sourceMode}
                  aria-label={FILES_COPY.source}
                  className={COARSE_POINTER_COMPACT_ICON_BUTTON_CLASS}
                  onMouseDown={preventOverlayTriggerSelection}
                  onClick={() => {
                    setDraft(
                      dirtyRef.current ? liveText() : (base?.content ?? ""),
                    );
                    setRevision((current) => current + 1);
                    setSourceMode((current) => !current);
                  }}
                >
                  <Icon name="Code" aria-hidden />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">{FILES_COPY.source}</TooltipContent>
            </Tooltip>
          ) : null}
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                disabled={
                  deleted || (base === null && disk.status !== "too-large")
                }
                aria-label={FILES_COPY.fileActions}
                className={COARSE_POINTER_COMPACT_ICON_BUTTON_CLASS}
                onMouseDown={(event) => {
                  preventOverlayTriggerSelection(event);
                  handle.current?.blur();
                }}
              >
                <Icon name="MoreHorizontal" aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" sideOffset={4}>
              {editable ? (
                <DropdownMenuItem
                  onSelect={() =>
                    void copyText(
                      liveText(),
                      FILES_COPY.contentsCopied,
                      FILES_COPY.contentsCopyFailed,
                    )
                  }
                >
                  <Icon name="Copy" aria-hidden />
                  {FILES_COPY.copyContents}
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuItem onSelect={() => void download()}>
                <Icon name="Download" aria-hidden />
                {FILES_COPY.download}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                onSelect={() => setConfirmDelete(true)}
              >
                <Icon name="Trash2" aria-hidden />
                {FILES_COPY.delete}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      {banner}
      <div
        className={cn(
          "min-h-0 flex-1",
          editable ? "overflow-hidden" : "overflow-auto",
        )}
      >
        <Suspense fallback={<FileSkeleton />}>{body}</Suspense>
      </div>
      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent hideCloseButton>
          <DialogHeader>
            <DialogTitle>{FILES_COPY.deleteTitle(name)}</DialogTitle>
            <DialogDescription>
              {FILES_COPY.deleteDescription}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setConfirmDelete(false)}
            >
              {FILES_COPY.cancel}
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={deleted}
              onClick={() => void remove()}
            >
              {FILES_COPY.delete}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ConflictBanner({
  message,
  children,
}: {
  message: string;
  children: ReactNode;
}) {
  return (
    <div
      role="alert"
      className="flex items-center gap-2 px-4 py-2 text-sm text-destructive"
    >
      <p className="min-w-0 flex-1">{message}</p>
      {children}
    </div>
  );
}
