import { describe, expect, it } from "vitest";
import { utils, write } from "xlsx";
import { CSV_PREVIEW_MAX_ROWS } from "./CsvTablePreview";
import { parseXlsxSheets } from "./XlsxFilePreview";

function workbookBytes(sheets: Record<string, unknown[][]>): ArrayBuffer {
  const workbook = utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) {
    utils.book_append_sheet(workbook, utils.aoa_to_sheet(rows), name);
  }
  return write(workbook, { type: "array", bookType: "xlsx" });
}

describe("parseXlsxSheets", () => {
  it("returns string rows per sheet in workbook order", () => {
    const sheets = parseXlsxSheets(
      workbookBytes({
        Budget: [
          ["Team", "Q3"],
          ["Design", 1200],
          ["Infra", null],
        ],
        Notes: [["Owner"], ["Sam"]],
      }),
    );

    expect(sheets.map((sheet) => sheet.name)).toEqual(["Budget", "Notes"]);
    expect(sheets[0]?.preview.rows).toEqual([
      ["Team", "Q3"],
      ["Design", "1200"],
      ["Infra", ""],
    ]);
    expect(sheets[0]?.preview.columnCount).toBe(2);
    expect(sheets[0]?.preview.truncatedRows).toBe(false);
  });

  it("caps parsed rows like the CSV preview and reports truncation", () => {
    const rows = Array.from(
      { length: CSV_PREVIEW_MAX_ROWS + 50 },
      (_, index) => [`row ${index}`],
    );
    const [sheet] = parseXlsxSheets(workbookBytes({ Big: rows }));

    expect(sheet?.preview.rows).toHaveLength(CSV_PREVIEW_MAX_ROWS + 1);
    expect(sheet?.preview.truncatedRows).toBe(true);
  });
});
