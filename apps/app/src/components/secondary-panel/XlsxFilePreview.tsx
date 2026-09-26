import { type ReactNode, useState } from "react";
import { read, utils, type WorkSheet } from "xlsx";
import { Button } from "@bb/shared-ui/button";
import { COARSE_POINTER_TEXT_SM_CLASS } from "@bb/shared-ui/coarse-pointer-sizing";
import { cn } from "@bb/shared-ui/lib/utils";
import {
  CSV_PREVIEW_MAX_ROWS,
  CsvTablePreview,
  buildTablePreviewData,
  type CsvPreviewData,
} from "./CsvTablePreview";
import { OfficeDocumentStatus, useOfficeDocument } from "./office-document";

interface XlsxFilePreviewProps {
  fallback: ReactNode;
  name: string;
  onSelectionAddToChat?: (text: string) => void;
  url: string;
}

interface XlsxSheetPreview {
  name: string;
  preview: CsvPreviewData;
}

function isSheetTruncated(sheet: WorkSheet): boolean {
  const fullRef = sheet["!fullref"];
  const ref = sheet["!ref"];
  if (fullRef === undefined || ref === undefined) {
    return false;
  }
  return utils.decode_range(fullRef).e.r > utils.decode_range(ref).e.r;
}

export function parseXlsxSheets(bytes: ArrayBuffer): XlsxSheetPreview[] {
  const workbook = read(bytes, {
    type: "array",
    dense: true,
    sheetRows: CSV_PREVIEW_MAX_ROWS + 1,
  });
  return workbook.SheetNames.flatMap((name) => {
    const sheet = workbook.Sheets[name];
    if (sheet === undefined) {
      return [];
    }
    const rows = utils
      .sheet_to_json<unknown[]>(sheet, {
        blankrows: false,
        defval: "",
        header: 1,
        raw: false,
      })
      .map((row) => row.map((cell) => (cell == null ? "" : String(cell))));
    return [
      {
        name,
        preview: buildTablePreviewData(rows, isSheetTruncated(sheet)),
      },
    ];
  });
}

export default function XlsxFilePreview({
  fallback,
  name,
  onSelectionAddToChat,
  url,
}: XlsxFilePreviewProps) {
  const [reloadKey, setReloadKey] = useState(0);
  const [activeSheetIndex, setActiveSheetIndex] = useState(0);
  const state = useOfficeDocument(url, parseXlsxSheets, reloadKey);

  if (state.status !== "ready") {
    return (
      <OfficeDocumentStatus
        fallback={fallback}
        onRetry={() => setReloadKey((current) => current + 1)}
        state={state}
      />
    );
  }

  const sheets = state.value;
  const activeSheet = sheets[activeSheetIndex] ?? sheets[0];
  if (activeSheet === undefined) {
    return fallback;
  }

  return (
    <CsvTablePreview
      label={`${name} ${activeSheet.name} sheet preview`}
      onSelectionAddToChat={onSelectionAddToChat}
      preview={activeSheet.preview}
      toolbar={
        sheets.length > 1 ? (
          <div
            className="mb-2 flex shrink-0 gap-0.5 overflow-x-auto"
            role="tablist"
            aria-label="Sheets"
          >
            {sheets.map((sheet, index) => (
              <Button
                key={sheet.name}
                type="button"
                variant="ghost"
                size="sm"
                role="tab"
                aria-selected={sheet === activeSheet}
                className={cn(
                  "h-6 shrink-0 rounded-sm px-2 text-muted-foreground aria-selected:bg-state-active aria-selected:text-foreground",
                  COARSE_POINTER_TEXT_SM_CLASS,
                )}
                onClick={() => setActiveSheetIndex(index)}
              >
                {sheet.name}
              </Button>
            ))}
          </div>
        ) : null
      }
    />
  );
}
