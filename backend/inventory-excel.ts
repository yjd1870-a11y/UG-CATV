import ExcelJS from 'exceljs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { db } from './db';
import { listFieldBalances, listSpareBalances } from './inventory-service';
import { readMaterialPhoto } from './material-photo-storage';

const headerFill = 'FF173B57';
const accentFill = 'FF2878B5';
const orangeFill = 'FFF28C28';
const exportGridBorder = 'FF9AA8B5';
const hsIssueLocationLabels = ['용인남부', '용인북부', '평택', '수원동부', '수원서부', '화성'];

const styleSheet = (sheet: ExcelJS.Worksheet, widths: number[]) => {
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: widths.length } };
  sheet.getRow(1).height = 28;
  sheet.getRow(1).eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: headerFill } };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = { bottom: { style: 'thin', color: { argb: accentFill } } };
  });
  widths.forEach((width, index) => { sheet.getColumn(index + 1).width = width; });
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    row.alignment = { vertical: 'middle', wrapText: true };
    row.eachCell((cell) => {
      cell.border = {
        bottom: { style: 'hair', color: { argb: exportGridBorder } },
        right: { style: 'hair', color: { argb: exportGridBorder } },
      };
    });
  });
  sheet.pageSetup = { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
};

const transactionLabel: Record<string, string> = {
  OPENING: '기준재고', RECEIPT: '입고', FIELD_USE: '현장사용', OTHER_COMPANY_ISSUE: '타 회사 분출',
  HS_ISSUE: 'H&S 분출', RECOVERED_GOOD: '철거품 회수', RECOVERED_BAD: '불량품 회수',
  REPAIR_OUT: '수리출고', DISPOSAL: '폐기', ADJUSTMENT: '재고조정', REVERSAL: '역분개',
  USE: '사용', DEFECT_CONVERSION: '불량전환', REPAIR_COMPLETE: '수리완료',
  REPAIR_UNREPAIRABLE: '수리불가', TRANSFER: '국사 이동',
};

const fieldDetailRows = (start: string, end: string, sourceReportYear?: number) => db.prepare(`
  SELECT t.id AS transactionId,t.effective_date AS effectiveDate, t.source_effective_date AS sourceEffectiveDate, t.transaction_number AS transactionNumber,
         t.transaction_type AS transactionType, COALESCE(NULLIF(e.category_name_snapshot,''),c.category_name) AS categoryName,
         m.id AS modelId, m.model_name AS modelName, m.manufacturer, e.stock_state AS stockState,
         e.signed_quantity AS signedQuantity, e.unit_snapshot AS unit,
         COALESCE(cell.cell_name, t.location_text, '') AS location,
         COALESCE(t.purpose, '') AS purpose, COALESCE(t.work_details, '') AS workDetails,
         COALESCE(t.company_name, '') AS companyName, COALESCE(t.memo, '') AS memo,
         COALESCE(t.source_worker_name,u.name) AS workerName, COALESCE(t.work_category,'') AS workCategory,
         t.region_id AS regionId, COALESCE(r.region_name,'') AS regionName,
         t.source_report_year AS sourceReportYear,t.source_sheet_name AS sourceSheetName,
         t.source_row_number AS sourceRowNumber,t.created_at AS createdAt
    FROM inventory_transactions t
    JOIN field_material_entries e ON e.transaction_id=t.id
    JOIN field_material_models m ON m.id=e.model_id AND m.active=1
    JOIN field_material_categories c ON c.id=m.category_id AND c.active=1
    JOIN users u ON u.id=t.created_by
    LEFT JOIN regions r ON r.id=t.region_id
    LEFT JOIN cells cell ON cell.id=t.cell_id
   WHERE t.domain='FIELD' AND t.status='POSTED'
     AND (t.effective_date BETWEEN ? AND ? ${sourceReportYear === undefined ? '' : 'OR t.source_report_year=?'})
   ORDER BY t.effective_date,t.created_at,e.created_at
`).all(...(sourceReportYear === undefined ? [start, end] : [start, end, sourceReportYear])) as Array<Record<string, unknown>>;

const templatePath = (name: string) => fileURLToPath(new URL(`./templates/${name}`, import.meta.url));
const zeroBlankNumberFormat = '#,##0.##;-#,##0.##;;';
const blankWhenZero = (value: number) => Math.abs(value) < 0.000001 ? null : value;
const excelDate = (value: unknown) => {
  const matched = String(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return matched
    ? new Date(Number(matched[1]), Number(matched[2]) - 1, Number(matched[3]), 12)
    : new Date(String(value));
};
const twoDigitYear = (year: number) => String(year).slice(-2);
const normalizeMaterialName = (value: unknown) => String(value || '').normalize('NFKC').replace(/\s+/g, '').toLowerCase();
const officialCategoryKey = (value: unknown) => normalizeMaterialName(value).replace(/[()_]/g, '');

const removeInvalidDefinedNames = (buffer: Buffer) => {
  const files = unzipSync(buffer);
  const workbookXmlPath = 'xl/workbook.xml';
  const workbookXml = files[workbookXmlPath];
  if (!workbookXml) return buffer;
  const sanitized = strFromU8(workbookXml).replace(/<definedNames>[\s\S]*?<\/definedNames>/, '');
  files[workbookXmlPath] = strToU8(sanitized);
  return Buffer.from(zipSync(files, { level: 6 }));
};

const numericCellValue = (cell: ExcelJS.Cell) => {
  const value = cell.value;
  const raw = value && typeof value === 'object' && 'result' in value ? value.result : value;
  const number = Number(raw ?? 0);
  return Number.isFinite(number) ? number : 0;
};

const setCellResult = (cell: ExcelJS.Cell, result: number) => {
  const value = cell.value;
  if (value && typeof value === 'object' && 'formula' in value) {
    cell.value = { ...value, result } as ExcelJS.CellFormulaValue;
  } else {
    cell.value = blankWhenZero(result);
  }
};

const addCellResult = (cell: ExcelJS.Cell, delta: number) => {
  if (Math.abs(delta) < 0.000001) return;
  setCellResult(cell, numericCellValue(cell) + delta);
};

const copyRowFormatting = (source: ExcelJS.Row, target: ExcelJS.Row, lastColumn = 10) => {
  target.height = source.height;
  for (let column = 1; column <= lastColumn; column += 1) {
    target.getCell(column).style = { ...source.getCell(column).style };
  }
};

const forceOfficialDetailTextBlack = (row: ExcelJS.Row) => {
  for (let column = 1; column <= 10; column += 1) {
    const cell = row.getCell(column);
    cell.font = { ...cell.font, color: { argb: 'FF000000' } };
  }
};

const normalizeOfficialDetailTextCells = (sheet: ExcelJS.Worksheet) => {
  for (let rowNumber = 7; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    if (![4, 5, 6, 9].some((column) => row.getCell(column).value !== null)) continue;
    for (const column of [4, 6, 9]) {
      const cell = row.getCell(column);
      cell.style = {
        ...cell.style,
        font: { ...cell.font, color: { argb: 'FF000000' } },
        numFmt: 'General',
      };
    }
  }
};

const hasOfficialSheets = (workbook: ExcelJS.Workbook) => Boolean(
  workbook.getWorksheet('사급자재 사용내역')
  && Array.from({ length: 12 }, (_, index) => workbook.getWorksheet(`센터 자재 사용내역(${String(index + 1).padStart(2, '0')}월)`)).every(Boolean),
);

const loadTemplateWorkbook = async (name: string) => {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await readFile(templatePath(name)));
  workbook.creator = '유지텔레컴 CATV 업무관리';
  workbook.modified = new Date();
  workbook.calcProperties.fullCalcOnLoad = true;
  return workbook;
};

const monthlyReportLabel = (row: Record<string, unknown>) => {
  if (row.transactionType === 'RECOVERED_BAD') return '불량';
  if (['OTHER_COMPANY_ISSUE', 'HS_ISSUE'].includes(String(row.transactionType))) return '분출';
  return String(row.workCategory || '교체');
};

const officialUseFormula = (rowNumber: number, month: number) => {
  const mm = String(month).padStart(2, '0');
  return ['신규', '교체', '분출', '타사 분출', 'H&S 분출'].map((label) =>
    `SUMIFS('센터 자재 사용내역(${mm}월)'!G:G,'센터 자재 사용내역(${mm}월)'!E:E,'사급자재 사용내역'!C${rowNumber},'센터 자재 사용내역(${mm}월)'!F:F,"${label}")`).join('+');
};

const officialReportMonth = (row: Record<string, unknown>, year: number) => {
  if (Number(row.sourceReportYear) === year) {
    const sourceMonth = String(row.sourceSheetName || '').match(/^센터 자재 사용내역\((\d{2})월\)$/)?.[1];
    if (sourceMonth) return Number(sourceMonth);
  }
  return Number(String(row.effectiveDate).slice(5, 7));
};

const officialDetailOrder = (left: Record<string, unknown>, right: Record<string, unknown>, year: number) => {
  const leftImported = Number(left.sourceReportYear) === year && Number.isInteger(Number(left.sourceRowNumber));
  const rightImported = Number(right.sourceReportYear) === year && Number.isInteger(Number(right.sourceRowNumber));
  if (leftImported !== rightImported) return leftImported ? -1 : 1;
  if (leftImported && rightImported) return Number(left.sourceRowNumber) - Number(right.sourceRowNumber);
  return String(left.effectiveDate).localeCompare(String(right.effectiveDate)) || String(left.createdAt).localeCompare(String(right.createdAt));
};

const buildFieldOfficialWorkbookFromStored = async (year: number, source: Buffer, fieldAuditRowId: number) => {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(source);
  if (!hasOfficialSheets(workbook)) return undefined;
  workbook.creator = '유지텔레컴 CATV 업무관리';
  workbook.modified = new Date();
  workbook.calcProperties.fullCalcOnLoad = true;

  const changedRows = db.prepare(`
    SELECT DISTINCT t.id AS transactionId,e.model_id AS modelId
      FROM inventory_audit_logs a
      JOIN inventory_transactions t ON t.id=a.transaction_id
      JOIN field_material_entries e ON e.transaction_id=t.id
     WHERE a.rowid>? AND t.domain='FIELD'
  `).all(fieldAuditRowId) as Array<{ transactionId: string; modelId: string }>;
  const changedTransactionIds = new Set(changedRows.map((row) => row.transactionId));
  const changedModelIds = new Set(changedRows.map((row) => row.modelId));
  const deltaDetails = fieldDetailRows(`${year}-01-01`, `${year}-12-31`)
    .filter((row) => changedTransactionIds.has(String(row.transactionId)) && Number(row.sourceReportYear) !== year);
  const balances = listFieldBalances(`${year}-12-31`) as Array<Record<string, unknown>>;
  const balanceByName = new Map(balances.map((row) => [normalizeMaterialName(row.modelName), row]));
  const deltaByModel = new Map<string, Array<Record<string, unknown>>>();
  for (const detail of deltaDetails) {
    const modelId = String(detail.modelId);
    deltaByModel.set(modelId, [...(deltaByModel.get(modelId) || []), detail]);
  }

  const summary = workbook.getWorksheet('사급자재 사용내역');
  if (!summary) return undefined;
  let summaryLastRow = 153;
  let currentCategory = '';
  const summaryRowByModel = new Map<string, number>();
  const availableRowsByCategory = new Map<string, number[]>();
  for (let rowNumber = 4; rowNumber <= summaryLastRow; rowNumber += 1) {
    const category = summary.getRow(rowNumber).getCell(2).text.trim();
    if (category) currentCategory = category;
    const modelName = summary.getRow(rowNumber).getCell(3).text.trim();
    if (modelName) summaryRowByModel.set(normalizeMaterialName(modelName), rowNumber);
    else if (currentCategory) {
      const categoryKey = officialCategoryKey(currentCategory);
      availableRowsByCategory.set(categoryKey, [...(availableRowsByCategory.get(categoryKey) || []), rowNumber]);
    }
  }

  const initializeSummaryRow = (rowNumber: number) => {
    const row = summary.getRow(rowNumber);
    for (let column = 5; column <= 56; column += 1) row.getCell(column).value = null;
    row.getCell(9).value = { formula: `(F${rowNumber}+BC${rowNumber})-(G${rowNumber}+H${rowNumber})`, result: 0 };
    row.getCell(10).value = { formula: `Y${rowNumber}`, result: 0 };
    row.getCell(11).value = { formula: `AN${rowNumber}`, result: 0 };
    row.getCell(12).value = { formula: `E${rowNumber}-J${rowNumber}+K${rowNumber}`, result: 0 };
    for (let month = 1; month <= 12; month += 1) {
      const mm = String(month).padStart(2, '0');
      row.getCell(12 + month).value = { formula: officialUseFormula(rowNumber, month), result: 0 };
      row.getCell(42 + month).value = { formula: `SUMIFS('센터 자재 사용내역(${mm}월)'!G:G,'센터 자재 사용내역(${mm}월)'!E:E,'사급자재 사용내역'!C${rowNumber},'센터 자재 사용내역(${mm}월)'!F:F,"불량")`, result: 0 };
    }
    row.getCell(25).value = { formula: `SUM(M${rowNumber}:X${rowNumber})`, result: 0 };
    row.getCell(40).value = { formula: `SUM(AB${rowNumber}:AM${rowNumber})`, result: 0 };
    row.getCell(55).value = { formula: `SUM(AQ${rowNumber}:BB${rowNumber})`, result: 0 };
    for (let column = 5; column <= 55; column += 1) row.getCell(column).numFmt = zeroBlankNumberFormat;
  };

  for (const balance of balances) {
    const modelId = String(balance.modelId);
    const modelKey = normalizeMaterialName(balance.modelName);
    if (!changedModelIds.has(modelId) || summaryRowByModel.has(modelKey) || String(balance.notes || '') === '공식 월간보고 일괄등록') continue;
    const categoryKey = officialCategoryKey(balance.categoryName);
    let targetRowNumber = availableRowsByCategory.get(categoryKey)?.shift();
    if (!targetRowNumber) {
      summaryLastRow += 1;
      targetRowNumber = summaryLastRow;
      copyRowFormatting(summary.getRow(summaryLastRow - 1), summary.getRow(summaryLastRow), 56);
      summary.getRow(targetRowNumber).getCell(2).value = String(balance.categoryName || '기타');
    }
    const targetRow = summary.getRow(targetRowNumber);
    targetRow.getCell(3).value = String(balance.modelName || '');
    targetRow.getCell(4).value = String(balance.unit || 'EA');
    initializeSummaryRow(targetRowNumber);
    summaryRowByModel.set(modelKey, targetRowNumber);
  }

  for (const [modelKey, rowNumber] of summaryRowByModel) {
    const balance = balanceByName.get(modelKey);
    if (!balance || !changedModelIds.has(String(balance.modelId))) continue;
    const row = summary.getRow(rowNumber);
    const modelRows = deltaByModel.get(String(balance.modelId)) || [];
    for (let month = 1; month <= 12; month += 1) {
      const useCell = row.getCell(12 + month);
      useCell.value = { formula: officialUseFormula(rowNumber, month), result: numericCellValue(useCell) };
    }
    const repairs = modelRows.filter((item) => item.transactionType === 'REPAIR_OUT').reduce((sum, item) => sum + Math.abs(Number(item.signedQuantity)), 0);
    const disposals = modelRows.filter((item) => item.transactionType === 'DISPOSAL').reduce((sum, item) => sum + Math.abs(Number(item.signedQuantity)), 0);
    const monthlyUse = Array.from({ length: 12 }, (_, month) => modelRows.filter((item) =>
      officialReportMonth(item, year) === month + 1 && ['FIELD_USE', 'OTHER_COMPANY_ISSUE', 'HS_ISSUE'].includes(String(item.transactionType)))
      .reduce((sum, item) => sum + Math.abs(Number(item.signedQuantity)), 0));
    const monthlyReceipt = Array.from({ length: 12 }, (_, month) => modelRows.filter((item) =>
      officialReportMonth(item, year) === month + 1 && ['RECEIPT', 'RECOVERED_GOOD'].includes(String(item.transactionType)))
      .reduce((sum, item) => sum + Math.max(0, Number(item.signedQuantity)), 0));
    const monthlyBad = Array.from({ length: 12 }, (_, month) => modelRows.filter((item) =>
      officialReportMonth(item, year) === month + 1 && item.transactionType === 'RECOVERED_BAD')
      .reduce((sum, item) => sum + Math.max(0, Number(item.signedQuantity)), 0));
    addCellResult(row.getCell(7), repairs);
    addCellResult(row.getCell(8), disposals);
    monthlyUse.forEach((quantity, month) => addCellResult(row.getCell(13 + month), quantity));
    monthlyReceipt.forEach((quantity, month) => addCellResult(row.getCell(28 + month), quantity));
    monthlyBad.forEach((quantity, month) => addCellResult(row.getCell(43 + month), quantity));
    addCellResult(row.getCell(10), monthlyUse.reduce((sum, value) => sum + value, 0));
    addCellResult(row.getCell(11), monthlyReceipt.reduce((sum, value) => sum + value, 0));
    addCellResult(row.getCell(25), monthlyUse.reduce((sum, value) => sum + value, 0));
    addCellResult(row.getCell(40), monthlyReceipt.reduce((sum, value) => sum + value, 0));
    addCellResult(row.getCell(55), monthlyBad.reduce((sum, value) => sum + value, 0));
    setCellResult(row.getCell(9), Number(balance.badQuantity || 0));
    setCellResult(row.getCell(12), Number(balance.normalQuantity || 0));
  }

  for (let month = 1; month <= 12; month += 1) {
    const sheet = workbook.getWorksheet(`센터 자재 사용내역(${String(month).padStart(2, '0')}월)`);
    if (!sheet) continue;
    const detailRows = deltaDetails
      .filter((row) => officialReportMonth(row, year) === month && ['FIELD_USE', 'OTHER_COMPANY_ISSUE', 'HS_ISSUE', 'RECOVERED_BAD'].includes(String(row.transactionType)))
      .filter((row) => summaryRowByModel.has(normalizeMaterialName(row.modelName)))
      .sort((left, right) => officialDetailOrder(left, right, year));
    if (!detailRows.length) {
      normalizeOfficialDetailTextCells(sheet);
      continue;
    }
    let lastDataRow = 6;
    let lastSequence = 0;
    for (let rowNumber = 7; rowNumber <= sheet.rowCount; rowNumber += 1) {
      if (sheet.getRow(rowNumber).getCell(5).text.trim()) lastDataRow = rowNumber;
      const sequence = Number(sheet.getRow(rowNumber).getCell(1).value);
      if (Number.isFinite(sequence)) lastSequence = Math.max(lastSequence, sequence);
    }
    detailRows.forEach((item, index) => {
      const rowNumber = lastDataRow + index + 1;
      const previousRowCount = sheet.rowCount;
      const row = sheet.getRow(rowNumber);
      if (rowNumber > previousRowCount) copyRowFormatting(sheet.getRow(Math.max(7, rowNumber - 1)), row);
      const values = [lastSequence + index + 1, String(item.location || ''), excelDate(item.effectiveDate), String(item.categoryName || ''), String(item.modelName || ''), monthlyReportLabel(item), Math.abs(Number(item.signedQuantity)), String(item.workDetails || item.purpose || ''), String(item.workerName || ''), String(item.companyName || 'CATV 사업부')];
      values.forEach((value, columnIndex) => { row.getCell(columnIndex + 1).value = value as ExcelJS.CellValue; });
      row.getCell(3).numFmt = 'yyyy-mm-dd';
      row.getCell(7).numFmt = zeroBlankNumberFormat;
      forceOfficialDetailTextBlack(row);
    });
    const newLastDataRow = lastDataRow + detailRows.length;
    const currentFormula = String((sheet.getCell('G5').value as { formula?: string } | null)?.formula || '');
    const formulaEnd = Number(currentFormula.match(/G7:G(\d+)/)?.[1] || 6);
    const updatedFormula = formulaEnd < newLastDataRow
      ? currentFormula.replace(/G7:G\d+/, `G7:G${newLastDataRow}`)
      : currentFormula;
    sheet.getCell('G5').value = { formula: updatedFormula || `SUBTOTAL(3,G7:G${newLastDataRow})`, result: lastSequence + detailRows.length };
    normalizeOfficialDetailTextCells(sheet);
  }

  const generated = Buffer.from(await workbook.xlsx.writeBuffer());
  return removeInvalidDefinedNames(generated);
};

export const buildFieldOfficialWorkbook = async (year: number) => {
  const stored = db.prepare(`
    SELECT workbook_blob AS workbookBlob,field_audit_rowid AS fieldAuditRowId
      FROM inventory_official_workbooks
     WHERE report_year=?
  `).get(year) as { workbookBlob: Uint8Array; fieldAuditRowId: number } | undefined;
  const currentFieldAuditRowId = Number((db.prepare(`
    SELECT COALESCE(MAX(a.rowid),0) AS rowId
      FROM inventory_audit_logs a
      JOIN inventory_transactions t ON t.id=a.transaction_id
     WHERE t.domain='FIELD'
  `).get() as { rowId: number }).rowId);
  if (stored) {
    if (currentFieldAuditRowId === Number(stored.fieldAuditRowId)) return Buffer.from(stored.workbookBlob);
    try {
      const updated = await buildFieldOfficialWorkbookFromStored(year, Buffer.from(stored.workbookBlob), Number(stored.fieldAuditRowId));
      if (updated) return updated;
    } catch {
      // 오래된 비표준 업로드 파일은 기존 정식 템플릿 재생성 경로로 안전하게 대체한다.
    }
  }
  const workbook = await loadTemplateWorkbook('field-official-template.xlsx');
  const loadedDetails = fieldDetailRows(`${year}-01-01`, `${year}-12-31`, year);
  const balances = listFieldBalances(`${year}-12-31`) as Array<Record<string, unknown>>;
  const openingBalances = listFieldBalances(`${year - 1}-12-31`) as Array<Record<string, unknown>>;
  const openingByModel = new Map(openingBalances.map((row) => [String(row.modelId), row]));
  const balanceByModel = new Map(balances.map((row) => [normalizeMaterialName(row.modelName), row]));
  const summary = workbook.getWorksheet('사급자재 사용내역');
  if (!summary) throw new Error('공식 보고 템플릿에서 사급자재 사용내역 시트를 찾을 수 없습니다.');
  summary.unMergeCells('B68:B84');
  const passiveCategoryStyle = { ...summary.getCell('B68').style };
  summary.mergeCells('B68:B79');
  summary.getCell('B68').value = '수동소자(옥외용)';
  summary.getCell('B68').style = passiveCategoryStyle;
  summary.mergeCells('B80:B84');
  summary.getCell('B80').value = '수동소자(옥내용)';
  summary.getCell('B80').style = passiveCategoryStyle;
  summary.getCell('E2').value = `${twoDigitYear(year - 1)}년 자재`;
  summary.getCell('G2').value = `${twoDigitYear(year)}년 불량자재 (누적)`;
  summary.getCell('J2').value = `${twoDigitYear(year)}년 자재 사용`;

  let summaryLastRow = 153;
  const summaryModelKeys = new Set<string>();
  const availableRowsByCategory = new Map<string, number[]>();
  for (let rowNumber = 4; rowNumber <= summaryLastRow; rowNumber += 1) {
    const row = summary.getRow(rowNumber);
    const modelName = String(row.getCell(3).value || '').trim();
    const categoryKey = officialCategoryKey(row.getCell(2).value);
    if (modelName) summaryModelKeys.add(normalizeMaterialName(modelName));
    else if (categoryKey) availableRowsByCategory.set(categoryKey, [...(availableRowsByCategory.get(categoryKey) || []), rowNumber]);
  }
  for (const balance of balances) {
    const modelKey = normalizeMaterialName(balance.modelName);
    if (summaryModelKeys.has(modelKey) || String(balance.notes || '') === '공식 월간보고 일괄등록') continue;
    const categoryKey = officialCategoryKey(balance.categoryName);
    let targetRowNumber = availableRowsByCategory.get(categoryKey)?.shift();
    if (!targetRowNumber) {
      summary.duplicateRow(summaryLastRow, 1, true);
      summaryLastRow += 1;
      targetRowNumber = summaryLastRow;
      summary.getRow(targetRowNumber).getCell(2).value = String(balance.categoryName || '기타');
    }
    const targetRow = summary.getRow(targetRowNumber);
    targetRow.getCell(3).value = String(balance.modelName || '');
    targetRow.getCell(4).value = String(balance.unit || 'EA');
    summaryModelKeys.add(modelKey);
  }
  const all = loadedDetails.filter((row) => summaryModelKeys.has(normalizeMaterialName(row.modelName)));

  for (let rowNumber = 4; rowNumber <= summaryLastRow; rowNumber += 1) {
    const row = summary.getRow(rowNumber);
    const templateModelName = String(row.getCell(3).value || '').trim();
    for (let column = 5; column <= 56; column += 1) row.getCell(column).value = null;
    if (!templateModelName) continue;
    const balance = balanceByModel.get(normalizeMaterialName(templateModelName));
    const modelRows = balance ? all.filter((item) => item.modelId === balance.modelId) : [];
    const opening = balance ? openingByModel.get(String(balance.modelId)) : undefined;
    const openingNormal = Number(opening?.normalQuantity || 0);
    const openingBad = Number(opening?.badQuantity || 0);
    const repairs = modelRows.filter((row) => row.transactionType === 'REPAIR_OUT').reduce((sum, row) => sum + Math.abs(Number(row.signedQuantity)), 0);
    const disposals = modelRows.filter((row) => row.transactionType === 'DISPOSAL').reduce((sum, row) => sum + Math.abs(Number(row.signedQuantity)), 0);
    const monthlyUse = Array.from({ length: 12 }, (_, month) => modelRows.filter((row) =>
      officialReportMonth(row, year) === month + 1 && ['FIELD_USE', 'OTHER_COMPANY_ISSUE', 'HS_ISSUE'].includes(String(row.transactionType)))
      .reduce((sum, row) => sum + Math.abs(Number(row.signedQuantity)), 0));
    const monthlyReceipt = Array.from({ length: 12 }, (_, month) => modelRows.filter((row) =>
      String(row.effectiveDate).slice(5,7) === String(month + 1).padStart(2,'0') && ['RECEIPT','RECOVERED_GOOD'].includes(String(row.transactionType)))
      .reduce((sum,row) => sum + Math.max(0,Number(row.signedQuantity)),0));
    const monthlyBad = Array.from({ length: 12 }, (_, month) => modelRows.filter((row) =>
      officialReportMonth(row, year) === month + 1 && row.transactionType === 'RECOVERED_BAD')
      .reduce((sum, row) => sum + Math.max(0, Number(row.signedQuantity)), 0));
    row.getCell(5).value = blankWhenZero(openingNormal);
    row.getCell(6).value = blankWhenZero(openingBad);
    row.getCell(7).value = blankWhenZero(repairs);
    row.getCell(8).value = blankWhenZero(disposals);
    row.getCell(9).value = { formula: `(F${rowNumber}+BC${rowNumber})-(G${rowNumber}+H${rowNumber})`, result: Number(balance?.badQuantity || 0) };
    row.getCell(10).value = { formula: `Y${rowNumber}`, result: monthlyUse.reduce((sum, value) => sum + value, 0) };
    row.getCell(11).value = { formula: `AN${rowNumber}`, result: monthlyReceipt.reduce((sum, value) => sum + value, 0) };
    row.getCell(12).value = { formula: `E${rowNumber}-J${rowNumber}+K${rowNumber}`, result: Number(balance?.normalQuantity || 0) };
    for (let month = 1; month <= 12; month += 1) {
      const mm = String(month).padStart(2,'0');
      row.getCell(12 + month).value = { formula: officialUseFormula(rowNumber, month), result: monthlyUse[month - 1] };
      row.getCell(27 + month).value = blankWhenZero(monthlyReceipt[month - 1]);
      row.getCell(42 + month).value = { formula: `SUMIFS('센터 자재 사용내역(${mm}월)'!G:G,'센터 자재 사용내역(${mm}월)'!E:E,'사급자재 사용내역'!C${rowNumber},'센터 자재 사용내역(${mm}월)'!F:F,"불량")`, result: monthlyBad[month - 1] };
    }
    row.getCell(25).value = { formula: `SUM(M${rowNumber}:X${rowNumber})`, result: monthlyUse.reduce((sum, value) => sum + value, 0) };
    row.getCell(40).value = { formula: `SUM(AB${rowNumber}:AM${rowNumber})`, result: monthlyReceipt.reduce((sum, value) => sum + value, 0) };
    row.getCell(55).value = { formula: `SUM(AQ${rowNumber}:BB${rowNumber})`, result: monthlyBad.reduce((sum, value) => sum + value, 0) };
    for (let column = 5; column <= 55; column += 1) row.getCell(column).numFmt = zeroBlankNumberFormat;
  }

  for (let month = 1; month <= 12; month += 1) {
    const sheet = workbook.getWorksheet(`센터 자재 사용내역(${String(month).padStart(2, '0')}월)`);
    if (!sheet) throw new Error(`${month}월 공식 보고 시트를 찾을 수 없습니다.`);
    const endDate=new Date(Date.UTC(year,month,0)).getUTCDate();
    sheet.getCell('A3').value=`기간 : ${year}년 ${String(month).padStart(2,'0')}월 01일 ~ ${year}년 ${String(month).padStart(2,'0')}월 ${endDate}일`;
    const detailRows=all
      .filter((row)=>officialReportMonth(row, year) === month && ['FIELD_USE','OTHER_COMPANY_ISSUE','HS_ISSUE','RECOVERED_BAD'].includes(String(row.transactionType)))
      .sort((left,right)=>officialDetailOrder(left,right,year));
    const formula = String((sheet.getCell('G5').value as { formula?: string } | null)?.formula || '');
    const templateLastRow = Number(formula.match(/G7:G(\d+)/)?.[1] || Math.max(7, sheet.rowCount));
    if (detailRows.length > templateLastRow - 6) sheet.duplicateRow(templateLastRow, detailRows.length - (templateLastRow - 6), true);
    const lastDataRow = Math.max(templateLastRow, detailRows.length + 6);
    for (let rowNumber = 7; rowNumber <= lastDataRow; rowNumber += 1) {
      for (let column = 1; column <= 10; column += 1) sheet.getRow(rowNumber).getCell(column).value = null;
    }
    sheet.getCell('G5').value={formula:`SUBTOTAL(3,G7:G${lastDataRow})`};
    detailRows.forEach((item,index)=>{
      const row=sheet.getRow(index+7);
      const values = [index+1,String(item.location||''),excelDate(item.sourceEffectiveDate||item.effectiveDate),String(item.categoryName||''),String(item.modelName||''),monthlyReportLabel(item),Math.abs(Number(item.signedQuantity)),String(item.workDetails||item.purpose||''),String(item.workerName||''),String(item.companyName||'CATV 사업부')];
      values.forEach((value, columnIndex) => { row.getCell(columnIndex + 1).value = value as ExcelJS.CellValue; });
      row.getCell(3).numFmt='yyyy-mm-dd';row.getCell(7).numFmt=zeroBlankNumberFormat;
      forceOfficialDetailTextBlack(row);
    });
    normalizeOfficialDetailTextCells(sheet);
  }
  return removeInvalidDefinedNames(Buffer.from(await workbook.xlsx.writeBuffer()));
};

export const buildHsWorkbook = async (start: string, end: string) => {
  const workbook = await loadTemplateWorkbook('hs-issue-template.xlsx');
  const sheet = workbook.getWorksheet('구내증폭기 분출현황(H&S)');
  if (!sheet) throw new Error('H&S 분출현황 템플릿 시트를 찾을 수 없습니다.');
  const rows = fieldDetailRows(start, end).filter((row) => row.transactionType === 'HS_ISSUE');
  const hsExportNote = (row: Record<string, unknown>) => {
    for (const candidate of [row.workDetails, row.purpose, row.memo]) {
      const text = String(candidate || '').trim();
      if (!text || text === 'H&S 분출내역 업로드' || /^원본: .+ \/ .+ \d+행$/.test(text)) continue;
      return text;
    }
    return null;
  };
  const templateCapacity = 49;
  let totalRowNumber = 65;
  if (rows.length > templateCapacity) {
    sheet.unMergeCells('B65:E65');
    sheet.duplicateRow(64, rows.length - templateCapacity, true);
    totalRowNumber += rows.length - templateCapacity;
    sheet.mergeCells(`B${totalRowNumber}:E${totalRowNumber}`);
  }
  for (let rowNumber = 16; rowNumber < totalRowNumber; rowNumber += 1) {
    for (let column = 2; column <= 9; column += 1) sheet.getRow(rowNumber).getCell(column).value = null;
  }
  for (let index = 0; index < 7; index += 1) sheet.getRow(index + 5).getCell(3).value = hsIssueLocationLabels[index] || null;
  rows.forEach((item, index) => {
    const row = sheet.getRow(index + 16);
    const year = Number(String(item.effectiveDate).slice(0, 4));
    const hsLocation = String(item.location || item.regionName || '').trim().replace(/지점$/, '');
    const values = ['H&S', hsLocation, String(item.categoryName || ''), String(item.modelName || ''),
      Math.abs(Number(item.signedQuantity)), `${year}년`, excelDate(item.effectiveDate), hsExportNote(item)];
    values.forEach((value, columnIndex) => { row.getCell(columnIndex + 2).value = value as ExcelJS.CellValue; });
    row.getCell(8).numFmt = 'yyyy-mm-dd';
  });
  const rowYears = rows.map((row) => Number(String(row.effectiveDate).slice(0, 4))).filter(Number.isInteger);
  const reportYear = rowYears.length ? Math.max(...rowYears) : Number(new Date().toISOString().slice(0, 4));
  [reportYear - 1, reportYear, reportYear + 1].forEach((year, index) => { sheet.getRow(4).getCell(index + 6).value = `${year}년`; });
  for (let index = 0; index < 7; index += 1) {
    const rowNumber = index + 5;
    for (let column = 6; column <= 8; column += 1) {
      const yearCell = sheet.getRow(4).getCell(column).address;
      const summaryYear = reportYear + column - 7;
      const location = String(sheet.getRow(rowNumber).getCell(3).value || '').trim();
      const result = rows
        .filter((row) => Number(String(row.effectiveDate).slice(0, 4)) === summaryYear)
        .filter((row) => String(row.location || row.regionName || '').trim().replace(/지점$/, '') === location)
        .reduce((sum, row) => sum + Math.abs(Number(row.signedQuantity)), 0);
      sheet.getRow(rowNumber).getCell(column).value = { formula: `SUMIFS($F$16:$F$${totalRowNumber - 1},$G$16:$G$${totalRowNumber - 1},${yearCell},$C$16:$C$${totalRowNumber - 1},C${rowNumber})`, result };
    }
  }
  for (let column = 6; column <= 8; column += 1) {
    const result = Array.from({ length: 7 }, (_, index) => numericCellValue(sheet.getRow(index + 5).getCell(column))).reduce((sum, value) => sum + value, 0);
    sheet.getRow(12).getCell(column).value = { formula: `SUM(${sheet.getRow(5).getCell(column).address}:${sheet.getRow(11).getCell(column).address})`, result };
  }
  sheet.getCell(`B${totalRowNumber}`).value = '합계';
  sheet.getCell(`F${totalRowNumber}`).value = { formula: `SUM(F16:F${totalRowNumber - 1})`, result: rows.reduce((sum, row) => sum + Math.abs(Number(row.signedQuantity)), 0) };
  return removeInvalidDefinedNames(Buffer.from(await workbook.xlsx.writeBuffer()));
};

export const buildFieldPhotoWorkbook = async (start: string, end: string, periodKey = start.slice(0, 7)) => {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'CATV 업무관리';
  const sheet = workbook.addWorksheet('능동자재 사진자료');
  sheet.addRow([`${Number(periodKey.slice(5, 7))}월 능동자재 사진자료`]);
  sheet.mergeCells('A1:K1');
  sheet.addRow(['순번', '일자', '지역', '품목', '모델', '수량', '위치', '작업자', '작업내용', '전 사진', '후 사진']);
  const rows = db.prepare(`
    SELECT t.id, t.effective_date AS effectiveDate, COALESCE(r.region_name,'') AS regionName,
           c.category_name AS categoryName, m.model_name AS modelName,
           ABS(e.signed_quantity) AS quantity, COALESCE(cell.cell_name,t.location_text,'') AS location,
           u.name AS workerName, COALESCE(t.work_details,t.purpose,'') AS workDetails
      FROM inventory_transactions t
      JOIN field_material_entries e ON e.transaction_id=t.id
      JOIN field_material_models m ON m.id=e.model_id AND m.material_kind='ACTIVE'
      JOIN field_material_categories c ON c.id=m.category_id
      JOIN users u ON u.id=t.created_by LEFT JOIN cells cell ON cell.id=t.cell_id
      LEFT JOIN regions r ON r.id=t.region_id
     WHERE t.domain='FIELD' AND t.status='POSTED' AND t.transaction_type='FIELD_USE'
       AND t.effective_date BETWEEN ? AND ? ORDER BY t.effective_date,t.created_at
  `).all(start, end) as Array<Record<string, unknown>>;
  for (const [index, row] of rows.entries()) {
    const excelRow = sheet.addRow([index + 1, row.effectiveDate, row.regionName, row.categoryName, row.modelName,
      row.quantity, row.location, row.workerName, row.workDetails, '', '']);
    excelRow.height = 190;
    const photos = db.prepare(`
      SELECT photo_slot AS slot,object_key AS objectKey,width,height
        FROM material_photo_assets
       WHERE transaction_id=? AND archive_status<>'DELETED' AND deleted_at IS NULL
       ORDER BY photo_slot
    `).all(String(row.id)) as Array<{ slot: string; objectKey: string; width: number; height: number }>;
    for (const photo of photos) {
      const image = await readMaterialPhoto(photo.objectKey);
      const imageId = workbook.addImage({ buffer: image, extension: 'jpeg' });
      const column = photo.slot === 'BEFORE' ? 9 : 10;
      const scale = Math.min(260 / Math.max(1, Number(photo.width)), 180 / Math.max(1, Number(photo.height)));
      const width = Math.max(1, Number(photo.width) * scale);
      const height = Math.max(1, Number(photo.height) * scale);
      sheet.addImage(imageId, {
        tl: { col: column + (260 - width) / 260 / 2, row: excelRow.number - 1 + (180 - height) / 180 / 2 },
        ext: { width, height }, editAs: 'oneCell',
      });
    }
  }
  const widths = [8, 13, 13, 18, 24, 10, 18, 14, 34, 38, 38];
  widths.forEach((width, index) => { sheet.getColumn(index + 1).width = width; });
  sheet.views = [{ state: 'frozen', ySplit: 2 }];
  sheet.autoFilter = { from: { row: 2, column: 1 }, to: { row: 2, column: 11 } };
  sheet.getRow(1).height = 34;
  sheet.getCell('A1').font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 18 };
  sheet.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: headerFill } };
  sheet.getCell('A1').alignment = { vertical: 'middle', horizontal: 'center' };
  sheet.getRow(2).height = 28;
  sheet.getRow(2).eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: accentFill } };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  });
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber < 3) return;
    row.alignment = { vertical: 'middle', wrapText: true };
    row.eachCell((cell) => {
      cell.border = {
        bottom: { style: 'hair', color: { argb: exportGridBorder } },
        right: { style: 'hair', color: { argb: exportGridBorder } },
      };
    });
  });
  sheet.pageSetup = { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
  sheet.getColumn(2).numFmt = 'yyyy-mm-dd';
  sheet.getColumn(6).numFmt = '#,##0.##';
  return Buffer.from(await workbook.xlsx.writeBuffer());
};

export const buildStationWorkbook = async (asOf: string) => {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'CATV 업무관리';
  const balances = listSpareBalances(asOf) as Array<Record<string, unknown>>;
  const current = workbook.addWorksheet('국사별 현재고');
  current.addRow(['기준일', '권역', '국사', '제조사', '품목', '모델명', '신품', '양품', '불량', '수리중', '사용가능', '전체보유', '단위']);
  balances.forEach((row) => current.addRow([asOf, row.regionName, row.stationName, row.manufacturer, row.itemType, row.modelName,
    row.newQuantity, row.serviceableQuantity,
    row.defectiveQuantity, row.inRepairQuantity, Number(row.newQuantity) + Number(row.serviceableQuantity),
    Number(row.newQuantity) + Number(row.serviceableQuantity) + Number(row.defectiveQuantity) + Number(row.inRepairQuantity), row.unit]));
  styleSheet(current, [13, 12, 15, 16, 18, 24, 10, 10, 10, 10, 12, 12, 8]);

  const ledger = workbook.addWorksheet('입출고 원장');
  ledger.addRow(['일자', '거래유형', '권역', '국사', '제조사', '품목', '모델명', '상태', '증가', '감소', '처리자', '사유', '비고']);
  const entries = db.prepare(`
    SELECT t.effective_date AS effectiveDate,t.transaction_type AS transactionType,
           s.region_name AS regionName,s.station_name AS stationName,m.manufacturer,m.item_type AS itemType,m.model_name AS modelName,
           e.stock_state AS stockState,e.signed_quantity AS signedQuantity,u.name AS workerName,t.reason,t.memo
      FROM spare_entries e JOIN inventory_transactions t ON t.id=e.transaction_id
      JOIN spare_stations s ON s.id=e.station_id JOIN spare_models m ON m.id=e.model_id JOIN users u ON u.id=t.created_by
     WHERE t.status='POSTED' AND t.effective_date<=? ORDER BY t.effective_date,t.created_at,e.created_at
  `).all(asOf) as Array<Record<string, unknown>>;
  entries.forEach((row) => ledger.addRow([row.effectiveDate,transactionLabel[String(row.transactionType)] || row.transactionType,
    row.regionName,row.stationName,row.manufacturer,row.itemType,row.modelName,row.stockState,
    Math.max(0,Number(row.signedQuantity)),Math.max(0,-Number(row.signedQuantity)),row.workerName,row.reason,row.memo]));
  styleSheet(ledger, [13,15,12,15,16,18,24,14,10,10,14,24,24]);

  const repairs = workbook.addWorksheet('불량수리 현황');
  repairs.addRow(['수리출고일', '국사', '제조사', '품목', '모델명', '수리수량', '처리수량', '미처리', '수리업체', '불량증상', '상태']);
  const repairRows = db.prepare(`
    SELECT t.effective_date AS outboundDate,s.station_name AS stationName,m.manufacturer,m.item_type AS itemType,m.model_name AS modelName,
           r.outbound_quantity AS outboundQuantity,r.resolved_quantity AS resolvedQuantity,r.vendor_name AS vendorName,
           r.fault_details AS faultDetails,r.status
      FROM spare_repair_cases r JOIN inventory_transactions t ON t.id=r.outbound_transaction_id
      JOIN spare_stations s ON s.id=r.station_id JOIN spare_models m ON m.id=r.model_id
     ORDER BY t.effective_date DESC
  `).all() as Array<Record<string, unknown>>;
  repairRows.forEach((row) => repairs.addRow([row.outboundDate,row.stationName,row.manufacturer,row.itemType,row.modelName,
    row.outboundQuantity,row.resolvedQuantity,Number(row.outboundQuantity)-Number(row.resolvedQuantity),row.vendorName,row.faultDetails,row.status]));
  styleSheet(repairs, [13,15,16,18,24,11,11,11,20,32,12]);

  const models = workbook.addWorksheet('모델목록');
  models.addRow(['제조사', '품목', '모델명', '단위', '사용여부', '비고']);
  (db.prepare('SELECT * FROM spare_models ORDER BY item_type,manufacturer,model_name').all() as Array<Record<string, unknown>>).forEach((row) => {
    models.addRow([row.manufacturer,row.item_type,row.model_name,row.unit,row.active ? '사용' : '중지',row.notes]);
  });
  styleSheet(models, [18,18,26,8,10,32]);
  ['G', 'H', 'I', 'J', 'K', 'L'].forEach((column) => { current.getColumn(column).numFmt = '#,##0'; });
  ['I', 'J'].forEach((column) => { ledger.getColumn(column).numFmt = '#,##0'; });
  ['F', 'G', 'H'].forEach((column) => { repairs.getColumn(column).numFmt = '#,##0'; });
  return Buffer.from(await workbook.xlsx.writeBuffer());
};

export const markPhotosExported = (start: string, end: string) => {
  db.prepare(`
    UPDATE material_photo_assets SET archive_status='EXPORTED', exported_at=CURRENT_TIMESTAMP,
           delete_after=NULL
     WHERE transaction_id IN (
       SELECT id FROM inventory_transactions WHERE domain='FIELD' AND transaction_type='FIELD_USE'
         AND status='POSTED' AND effective_date BETWEEN ? AND ?
     ) AND archive_status='PENDING'
  `).run(start,end);
};

export const fieldPhotoExportCounts = (start: string, end: string) => db.prepare(`
  SELECT COUNT(DISTINCT t.id) AS rowCount,COUNT(p.id) AS photoCount
    FROM inventory_transactions t
    JOIN field_material_entries e ON e.transaction_id=t.id
    JOIN field_material_models m ON m.id=e.model_id AND m.material_kind='ACTIVE'
    LEFT JOIN material_photo_assets p ON p.transaction_id=t.id AND p.archive_status<>'DELETED' AND p.deleted_at IS NULL
   WHERE t.domain='FIELD' AND t.status='POSTED' AND t.transaction_type='FIELD_USE'
     AND t.effective_date BETWEEN ? AND ?
`).get(start, end) as { rowCount: number; photoCount: number };
