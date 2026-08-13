export const textValue = (value: unknown) => String(value ?? '').replace(/_x000D_/gi, '').trim();

export const normalizeStationName = (value: unknown) => {
  let key = textValue(value)
    .toLowerCase()
    .replace(/\.(xlsx|xls|png|jpe?g|webp)$/i, '')
    .replace(/[()[\]{}]/g, '')
    .replace(/평면도/g, '')
    .replace(/\s+/g, '')
    .replace(/[_/\\:>]+$/g, '');
  if (key.endsWith('국사') && key.length > 2) key = key.slice(0, -2);
  const segments = key.split(/[_/\\:>]+/).filter(Boolean);
  return segments.at(-1) || key;
};

export const normalizeLookupValue = (value: unknown) => textValue(value)
  .toLowerCase()
  .replace(/rack|랙|렉/g, '')
  .replace(/[^0-9a-z가-힣#]/g, '');

const field = (row: Record<string, unknown>, snake: string) => row[snake];

export const mapCatvCellRow = (row: Record<string, unknown>) => ({
  id: textValue(field(row, 'id')),
  keyNumber: textValue(field(row, 'key_number')),
  cellName: textValue(field(row, 'cell_name')),
  stationName: textValue(field(row, 'station_name')),
  stationAddress: textValue(field(row, 'station_address')),
  otxMain: textValue(field(row, 'otx_main')),
  otxLine: textValue(field(row, 'otx_line')),
  orxMain: textValue(field(row, 'orx_main')),
  orxLine: textValue(field(row, 'orx_line')),
  backup: textValue(field(row, 'backup_node')),
  backupLine: textValue(field(row, 'backup_line')),
  otxRack: textValue(field(row, 'otx_rack')),
  otxShelf: textValue(field(row, 'otx_shelf')),
  otxPort: textValue(field(row, 'otx_port')),
  otxModel: textValue(field(row, 'otx_model')),
  orxRack: textValue(field(row, 'orx_rack')),
  orxShelf: textValue(field(row, 'orx_shelf')),
  orxPort: textValue(field(row, 'orx_port')),
  orxModel: textValue(field(row, 'orx_model')),
  onuLocation: textValue(field(row, 'onu_location')),
  onuMaker: textValue(field(row, 'onu_maker')),
  onuModel: textValue(field(row, 'onu_model')),
  onuSplit: textValue(field(row, 'onu_split')),
  onuCellConfig: textValue(field(row, 'onu_cell_config')),
  upsLocation: textValue(field(row, 'ups_location')),
  upsMaker: textValue(field(row, 'ups_maker')),
  upsModel: textValue(field(row, 'ups_model')),
  remarks: textValue(field(row, 'remarks')),
});

export const mapB2CRow = (row: Record<string, unknown>, stationAddress = '') => ({
  id: textValue(row.id),
  stationName: textValue(row.station_name),
  stationAddress,
  serviceName: textValue(row.service_name),
  b2cName: textValue(row.b2c_name),
  node: textValue(row.node),
  line: textValue(row.line),
  core: textValue(row.core || row.line),
  serviceLineNumber: textValue(row.service_line_number),
  serviceCategory: textValue(row.service_category),
  serviceType: textValue(row.service_type),
  sheetName: textValue(row.sheet_name),
  rowNumber: row.row_number == null ? null : Number(row.row_number),
  memo: textValue(row.memo),
  searchValues: (() => {
    try {
      const values = JSON.parse(textValue(row.search_values) || '[]');
      return Array.isArray(values) ? values.map(textValue).filter(Boolean) : [];
    } catch {
      return [];
    }
  })(),
  sourceFile: textValue(row.source_file),
});

export const stationAddressQuery = `
  SELECT station_address
    FROM catv_cells
   WHERE station_name = ? OR station_name LIKE ? OR station_name LIKE ?
   ORDER BY CASE WHEN station_name = ? THEN 0 ELSE 1 END, updated_at DESC
   LIMIT 1
`;
