import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { db, initializeDatabase } from '../backend/db';

type ImportRow = Record<string, string>;

const source = process.argv[2];
if (!source) {
  throw new Error('Usage: npm run import:data -- <cells.csv|cells.json>');
}

const parseCsv = (text: string): ImportRow[] => {
  const rows: string[][] = [];
  let row: string[] = [];
  let value = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '"' && quoted && text[index + 1] === '"') {
      value += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === ',' && !quoted) {
      row.push(value.trim());
      value = '';
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && text[index + 1] === '\n') index += 1;
      row.push(value.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      value = '';
    } else {
      value += char;
    }
  }
  row.push(value.trim());
  if (row.some(Boolean)) rows.push(row);
  const [headers, ...data] = rows;
  return data.map((values) => Object.fromEntries(headers.map((header, index) => [header.trim(), values[index] || ''])));
};

const absoluteSource = path.resolve(source);
const raw = fs.readFileSync(absoluteSource, 'utf8').replace(/^\uFEFF/, '');
const rows = path.extname(absoluteSource).toLowerCase() === '.json'
  ? JSON.parse(raw) as ImportRow[]
  : parseCsv(raw);

await initializeDatabase();
const upsertSite = db.prepare(`
  INSERT INTO sites (id, site_name, site_code, address, floor, rack_info, memo)
  VALUES (?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(site_code) DO UPDATE SET
    site_name = excluded.site_name,
    address = excluded.address,
    floor = excluded.floor,
    rack_info = excluded.rack_info,
    memo = excluded.memo,
    updated_at = CURRENT_TIMESTAMP,
    deleted_at = NULL
`);
const findSite = db.prepare('SELECT id FROM sites WHERE site_code = ?');
const upsertCell = db.prepare(`
  INSERT INTO cells (
    id, cell_name, cell_code, node_name, site_id, line_code, address, region,
    status, memo, responsible_team, details_json
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(cell_code) DO UPDATE SET
    cell_name = excluded.cell_name,
    node_name = excluded.node_name,
    site_id = excluded.site_id,
    line_code = excluded.line_code,
    address = excluded.address,
    region = excluded.region,
    status = excluded.status,
    memo = excluded.memo,
    responsible_team = excluded.responsible_team,
    details_json = excluded.details_json,
    updated_at = CURRENT_TIMESTAMP,
    deleted_at = NULL
`);

let imported = 0;
db.exec('BEGIN IMMEDIATE');
try {
  for (const row of rows) {
    const cellCode = row.cell_code || row.cellCode;
    const cellName = row.cell_name || row.cellName || cellCode;
    const nodeName = row.node_name || row.nodeName;
    if (!cellCode || !cellName || !nodeName) {
      console.warn('Skipped row without cell_code/cell_name/node_name:', row);
      continue;
    }

    let siteId: string | null = null;
    const siteCode = row.site_code || row.siteCode;
    if (siteCode) {
      const current = findSite.get(siteCode) as { id: string } | undefined;
      siteId = current?.id || randomUUID();
      upsertSite.run(
        siteId,
        row.site_name || row.siteName || siteCode,
        siteCode,
        row.site_address || row.siteAddress || row.address || '주소 미입력',
        row.floor || null,
        row.rack_info || row.rackInfo || null,
        row.site_memo || null
      );
    }

    const currentCell = db.prepare('SELECT id FROM cells WHERE cell_code = ?').get(cellCode) as { id: string } | undefined;
    const id = currentCell?.id || randomUUID();
    const details = {
      id,
      cellName,
      region: row.region || '',
      lineCode: row.line_code || row.lineCode || cellCode,
      stationInfo: row.site_name || row.siteName || '',
      address: row.address || '주소 미입력',
      status: row.status || '정상',
      opticalNode: nodeName,
      responsibleTeam: row.responsible_team || row.responsibleTeam || '',
      remarks: row.memo || '',
      diagramData: { opticalRxLevel: '', rfOutLevel: '', returnLevel: '', freqBand: '', tbaList: [], tapList: [] },
      floorPlanData: { rackNumber: '', odfPosition: '', transmitter: '', edfa: '', cmtsPort: '', notes: '' },
      photos: [],
      history: [],
    };
    upsertCell.run(
      id,
      cellName,
      cellCode,
      nodeName,
      siteId,
      details.lineCode,
      details.address,
      details.region,
      details.status,
      details.remarks,
      details.responsibleTeam,
      JSON.stringify(details)
    );
    imported += 1;
  }
  db.exec('COMMIT');
} catch (error) {
  db.exec('ROLLBACK');
  throw error;
}

console.log(`Imported or updated ${imported} CELL rows from ${absoluteSource}`);
db.close();
