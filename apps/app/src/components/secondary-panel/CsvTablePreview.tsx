import { type ReactNode, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { SecondaryPanelSelectionActions } from "./SecondaryPanelSelectionActions.js";

export interface CsvPreviewData {
  columnCount: number;
  rows: string[][];
  truncatedColumns: boolean;
  truncatedRows: boolean;
}

interface CsvTablePreviewProps {
  label: string;
  onSelectionAddToChat?: (text: string) => void;
  preview: CsvPreviewData;
  toolbar?: ReactNode;
}

export const CSV_PREVIEW_MAX_COLUMNS = 100;
export const CSV_PREVIEW_MAX_ROWS = 500;
const CSV_PREVIEW_ROW_HEIGHT_PX = 29;
const CSV_PREVIEW_OVERSCAN_ROWS = 8;

export function buildTablePreviewData(
  rows: string[][],
  truncatedRows: boolean,
): CsvPreviewData {
  const columnCount = rows.reduce(
    (maximum, row) => Math.max(maximum, row.length),
    0,
  );

  return {
    columnCount: Math.min(columnCount, CSV_PREVIEW_MAX_COLUMNS),
    rows,
    truncatedColumns: columnCount > CSV_PREVIEW_MAX_COLUMNS,
    truncatedRows,
  };
}

export function getCsvTruncationNote(
  preview: CsvPreviewData,
  dataRowCount: number,
): string | null {
  const limits: string[] = [];
  if (preview.truncatedRows) {
    limits.push(`${dataRowCount.toLocaleString()} rows`);
  }
  if (preview.truncatedColumns) {
    limits.push(`${preview.columnCount.toLocaleString()} columns`);
  }
  if (limits.length === 0) {
    return null;
  }
  return `Showing the first ${limits.join(" and ")}.`;
}

export function CsvTablePreview({
  label,
  onSelectionAddToChat,
  preview,
  toolbar,
}: CsvTablePreviewProps) {
  const headerRow = preview.rows[0] ?? [];
  const bodyRows = preview.rows.slice(1);
  const columns = Array.from({ length: preview.columnCount }, (_, index) => ({
    index,
    label: headerRow[index] ?? "",
  }));
  const tableWidth = `max(100%, ${3 + columns.length * 18}rem)`;
  const truncationNote = getCsvTruncationNote(preview, bodyRows.length);

  const scrollRef = useRef<HTMLDivElement>(null);
  const rowVirtualizer = useVirtualizer({
    count: bodyRows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => CSV_PREVIEW_ROW_HEIGHT_PX,
    overscan: CSV_PREVIEW_OVERSCAN_ROWS,
  });
  const virtualRows = rowVirtualizer.getVirtualItems();
  const totalRowsHeight = rowVirtualizer.getTotalSize();
  const firstVirtualRow = virtualRows[0];
  const lastVirtualRow = virtualRows[virtualRows.length - 1];
  const spacerTopHeight = firstVirtualRow?.start ?? 0;
  const spacerBottomHeight =
    lastVirtualRow === undefined
      ? totalRowsHeight
      : totalRowsHeight - lastVirtualRow.end;

  return (
    <SecondaryPanelSelectionActions onSelectionAddToChat={onSelectionAddToChat}>
      <div className="flex min-h-0 flex-auto flex-col bg-surface-raised px-4 py-4">
        {toolbar}
        <div
          ref={scrollRef}
          className="persistent-scrollbar min-h-0 overflow-auto overscroll-contain rounded-md border border-border bg-background"
        >
          <table
            className="min-w-full table-fixed border-separate border-spacing-0 font-mono text-xs leading-5"
            aria-label={label}
            style={{ width: tableWidth }}
          >
            <colgroup>
              <col className="w-12" />
              {columns.map((column) => (
                <col key={column.index} className="w-72" />
              ))}
            </colgroup>
            <thead>
              <tr>
                <th
                  scope="col"
                  className="sticky left-0 top-0 z-30 w-12 min-w-12 border-b border-r border-border bg-surface-recessed-solid px-2 py-1 text-right font-medium text-muted-foreground"
                >
                  #
                </th>
                {columns.map((column) => (
                  <th
                    key={column.index}
                    scope="col"
                    className="sticky top-0 z-20 w-72 max-w-72 border-b border-r border-border bg-surface-recessed-solid px-2 py-1 text-left font-medium text-foreground"
                    title={column.label}
                  >
                    <span className="block max-w-full truncate">
                      {column.label || `Column ${column.index + 1}`}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {spacerTopHeight > 0 ? (
                <tr aria-hidden style={{ height: spacerTopHeight }}>
                  <td colSpan={columns.length + 1} className="p-0" />
                </tr>
              ) : null}
              {virtualRows.map((virtualRow) => {
                const rowIndex = virtualRow.index;
                const row = bodyRows[rowIndex] ?? [];
                return (
                  <tr
                    key={virtualRow.key}
                    data-index={rowIndex}
                    ref={rowVirtualizer.measureElement}
                  >
                    <th
                      scope="row"
                      className="sticky left-0 z-10 w-12 min-w-12 border-b border-r border-border bg-surface-recessed-solid px-2 py-1 text-right font-medium text-muted-foreground"
                    >
                      {rowIndex + 2}
                    </th>
                    {columns.map((column) => {
                      const cell = row[column.index] ?? "";
                      return (
                        <td
                          key={column.index}
                          className="w-72 max-w-72 overflow-hidden border-b border-r border-border px-2 py-1 align-top text-foreground"
                          title={cell}
                        >
                          <span className="block max-w-full truncate">
                            {cell}
                          </span>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
              {spacerBottomHeight > 0 ? (
                <tr aria-hidden style={{ height: spacerBottomHeight }}>
                  <td colSpan={columns.length + 1} className="p-0" />
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        {truncationNote === null ? null : (
          <p className="mt-2 shrink-0 text-xs leading-5 text-muted-foreground">
            {truncationNote}
          </p>
        )}
      </div>
    </SecondaryPanelSelectionActions>
  );
}
