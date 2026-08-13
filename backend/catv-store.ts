import { randomUUID } from 'node:crypto';
import { db } from './db';
import { textValue } from './catv';

const pick = (source: Record<string, unknown>, ...keys: string[]) => {
  for (const key of keys) {
    if (source[key] !== undefined && source[key] !== null) return textValue(source[key]);
  }
  return '';
};

export const upsertCatvCellRecord = (source: Record<string, unknown>, preferredId?: string) => {
  const requestedId = preferredId || pick(source, 'id') || randomUUID();
  const keyNumber = pick(source, 'keyNumber', 'cellCode') || requestedId;
  const existing = db.prepare(`
    SELECT id, key_number AS keyNumber FROM catv_cells WHERE lower(key_number) = lower(?) LIMIT 1
  `).get(keyNumber) as { id: string; keyNumber: string } | undefined;
  const id = existing?.id || requestedId;
  const persistedKeyNumber = existing?.keyNumber || keyNumber;
  db.prepare(`
    INSERT INTO catv_cells (
      id, key_number, cell_name, station_name, station_address,
      otx_main, otx_line, orx_main, orx_line, backup_node, backup_line,
      otx_rack, otx_shelf, otx_port, otx_model,
      orx_rack, orx_shelf, orx_port, orx_model,
      onu_location, onu_maker, onu_model, onu_split, onu_cell_config,
      ups_location, ups_maker, ups_model, remarks
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(key_number) DO UPDATE SET
      cell_name = excluded.cell_name, station_name = excluded.station_name,
      station_address = excluded.station_address, otx_main = excluded.otx_main,
      otx_line = excluded.otx_line, orx_main = excluded.orx_main,
      orx_line = excluded.orx_line, backup_node = excluded.backup_node,
      backup_line = excluded.backup_line, otx_rack = excluded.otx_rack,
      otx_shelf = excluded.otx_shelf, otx_port = excluded.otx_port,
      otx_model = excluded.otx_model, orx_rack = excluded.orx_rack,
      orx_shelf = excluded.orx_shelf, orx_port = excluded.orx_port,
      orx_model = excluded.orx_model, onu_location = excluded.onu_location,
      onu_maker = excluded.onu_maker, onu_model = excluded.onu_model,
      onu_split = excluded.onu_split, onu_cell_config = excluded.onu_cell_config,
      ups_location = excluded.ups_location, ups_maker = excluded.ups_maker,
      ups_model = excluded.ups_model, remarks = excluded.remarks,
      updated_at = CURRENT_TIMESTAMP
  `).run(
    id, persistedKeyNumber, pick(source, 'cellName'), pick(source, 'stationName', 'stationInfo'),
    pick(source, 'stationAddress'), pick(source, 'otxMain', 'otxNode', 'nodeName'),
    pick(source, 'otxLine', 'otxLineNumber', 'lineCode'), pick(source, 'orxMain', 'orxNode'),
    pick(source, 'orxLine', 'orxLineNumber'), pick(source, 'backup', 'spareNode'),
    pick(source, 'backupLine', 'spareLineNumber'), pick(source, 'otxRack'), pick(source, 'otxShelf'),
    pick(source, 'otxPort'), pick(source, 'otxModel'), pick(source, 'orxRack'), pick(source, 'orxShelf'),
    pick(source, 'orxPort'), pick(source, 'orxModel'), pick(source, 'onuLocation', 'address'),
    pick(source, 'onuMaker', 'onuManufacturer'), pick(source, 'onuModel'), pick(source, 'onuSplit', 'onuDivision'),
    pick(source, 'onuCellConfig'), pick(source, 'upsLocation'), pick(source, 'upsMaker', 'upsManufacturer'),
    pick(source, 'upsModel'), pick(source, 'remarks', 'notes', 'memo')
  );
  return id;
};

export const deleteCatvCell = (id: string) => {
  db.prepare('DELETE FROM catv_cells WHERE id = ?').run(id);
};
