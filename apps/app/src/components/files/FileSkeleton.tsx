import { Skeleton } from "@bb/shared-ui/skeleton";
import { FILES_COPY } from "./files-copy";

const LINE_WIDTHS = [
  72, 54, 88, 41, 63, 79, 36, 58, 91, 47, 70, 33, 85, 52, 66, 44, 77, 39, 60,
  83, 49, 68, 31, 74,
];

export function FileSkeleton() {
  return (
    <div
      className="flex h-full min-h-0 flex-col gap-2 overflow-hidden px-4 py-2.5"
      aria-busy="true"
      aria-label={FILES_COPY.loading}
    >
      {LINE_WIDTHS.map((width, index) => (
        <Skeleton
          key={index}
          className="h-3 rounded-sm"
          style={{ width: `${width}%` }}
        />
      ))}
    </div>
  );
}
