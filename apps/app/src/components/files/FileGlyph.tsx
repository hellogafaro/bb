import { cn } from "@bb/shared-ui/lib/utils";
import { FILE_ICON_SVGS } from "./file-icon-svgs";
import { fileIconToken } from "./file-paths";

const iconSources = new Map<string, string>();

function fileIconSource(token: string): string {
  const cached = iconSources.get(token);
  if (cached !== undefined) return cached;
  const svg = FILE_ICON_SVGS[token] ?? FILE_ICON_SVGS.default ?? "";
  const source = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  iconSources.set(token, source);
  return source;
}

export function FileGlyph({
  path,
  className,
}: {
  path: string;
  className?: string;
}) {
  return (
    <img
      alt=""
      src={fileIconSource(fileIconToken(path))}
      className={cn("size-4 shrink-0", className)}
      draggable={false}
    />
  );
}

export function FolderGlyph({
  open,
  className,
}: {
  open: boolean;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={cn("size-4 shrink-0 text-muted-foreground", className)}
    >
      {open ? (
        <>
          <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v1" />
          <path d="M3 10h16.5a2 2 0 0 1 1.94 2.5l-1.4 5.5A2 2 0 0 1 18.1 20H4a2 2 0 0 1-2-2V7" />
        </>
      ) : (
        <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      )}
    </svg>
  );
}
