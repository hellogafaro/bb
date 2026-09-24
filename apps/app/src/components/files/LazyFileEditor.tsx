import { lazy, Suspense, type ComponentProps } from "react";
import { FileSkeleton } from "./FileSkeleton";

const FileEditorChunk = lazy(() =>
  import("./FileEditor").then(({ FileEditor }) => ({ default: FileEditor })),
);

export function LazyFileEditor(
  props: ComponentProps<typeof FileEditorChunk>,
) {
  return (
    <Suspense fallback={<FileSkeleton />}>
      <FileEditorChunk {...props} />
    </Suspense>
  );
}
