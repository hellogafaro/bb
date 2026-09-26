import { type ReactNode, useState } from "react";
import mammoth from "mammoth";
import { MarkdownPreview } from "@/components/ui/markdown-preview.js";
import { SecondaryPanelSelectionActions } from "./SecondaryPanelSelectionActions.js";
import { OfficeDocumentStatus, useOfficeDocument } from "./office-document";

interface DocxFilePreviewProps {
  fallback: ReactNode;
  onSelectionAddToChat?: (text: string) => void;
  url: string;
}

const IMAGE_TAG_PATTERN = /<img\b[^>]*>/giu;

async function convertDocxToHtml(bytes: ArrayBuffer): Promise<string> {
  const result = await mammoth.convertToHtml({ arrayBuffer: bytes });
  return result.value.replace(IMAGE_TAG_PATTERN, "");
}

export default function DocxFilePreview({
  fallback,
  onSelectionAddToChat,
  url,
}: DocxFilePreviewProps) {
  const [reloadKey, setReloadKey] = useState(0);
  const state = useOfficeDocument(url, convertDocxToHtml, reloadKey);

  if (state.status !== "ready") {
    return (
      <OfficeDocumentStatus
        fallback={fallback}
        onRetry={() => setReloadKey((current) => current + 1)}
        state={state}
      />
    );
  }

  return (
    <SecondaryPanelSelectionActions onSelectionAddToChat={onSelectionAddToChat}>
      <div className="flex-auto bg-background px-4 py-4">
        <MarkdownPreview allowHtml content={state.value} />
      </div>
    </SecondaryPanelSelectionActions>
  );
}
