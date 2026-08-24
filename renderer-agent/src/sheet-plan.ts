export type ExcelAnalysisSheet = {
  name: string;
  visible: boolean;
  empty: boolean;
};

export type RendererSheetSelection = {
  sheetName: string;
  sourceSheetName: string;
  sourceSheetIndex: number;
};

export const selectRendererSheets = (sheets: ExcelAnalysisSheet[]): RendererSheetSelection[] => {
  const selected = sheets
    .map((sheet, index) => ({
      sheetName: sheet.name.trim(),
      sourceSheetName: sheet.name,
      sourceSheetIndex: index + 1,
      visible: sheet.visible,
      empty: sheet.empty,
    }))
    .filter((sheet) => sheet.visible && !sheet.empty && !sheet.sourceSheetName.includes('선번장') && sheet.sheetName.length > 0);

  const seen = new Set<string>();
  for (const sheet of selected) {
    if (seen.has(sheet.sheetName)) {
      throw new Error(`공백을 정리한 뒤 이름이 중복되는 직선도 시트가 있습니다: ${sheet.sheetName}`);
    }
    seen.add(sheet.sheetName);
  }

  return selected.map(({ sheetName, sourceSheetName, sourceSheetIndex }) => ({
    sheetName,
    sourceSheetName,
    sourceSheetIndex,
  }));
};

export const canonicalSheetHashes = (
  sheets: RendererSheetSelection[],
  sourceHashes: Record<string, string>,
) => Object.fromEntries(sheets.flatMap((sheet) => {
  const hash = sourceHashes[sheet.sourceSheetName];
  return hash ? [[sheet.sheetName, hash]] : [];
}));

