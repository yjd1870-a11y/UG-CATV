export type B2CWorkbookRecord = {
  node: string;
  core: string;
  serviceLineNumber: string;
  serviceName: string;
  b2cName: string;
  serviceCategory: string;
  serviceType: string;
  memo: string;
  searchValues: string[];
  sheetName: string;
  rowNumber: number;
};

const clean = (value: unknown) => String(value ?? '').replace(/_x000D_/gi, '').trim();
const header = (value: unknown) => clean(value).replace(/\s+/g, '');

export const parseB2CLineBookMatrix = (sheetName: string, matrix: unknown[][]): B2CWorkbookRecord[] => {
  if (!sheetName.replace(/\s+/g, '').includes('선번장')) return [];
  const headerIndex = matrix.findIndex((row) => (
    header(row[3]) === '노드명'
    && header(row[7]) === '코어'
    && header(row[12]) === '서비스회선명'
    && header(row[15]) === '비고'
  ));
  if (headerIndex < 0) return [];
  const records: B2CWorkbookRecord[] = [];
  for (let index = headerIndex + 1; index < matrix.length; index += 1) {
    const row = matrix[index] || [];
    const searchValues = row.slice(11, 16).map(clean).filter(Boolean);
    const node = clean(row[3]);
    const core = clean(row[7]);
    if (!searchValues.length || (!node && !core)) continue;
    const serviceName = clean(row[12]);
    records.push({
      node,
      core,
      serviceLineNumber: clean(row[11]),
      serviceName,
      b2cName: serviceName || searchValues[0] || node,
      serviceCategory: clean(row[13]),
      serviceType: clean(row[14]),
      memo: clean(row[15]),
      searchValues,
      sheetName,
      rowNumber: index + 1,
    });
  }
  return records;
};
