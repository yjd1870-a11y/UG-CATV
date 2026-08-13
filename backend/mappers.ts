import { db } from './db';

export const fromDbTransferStatus = (status: string) => {
  const mapping: Record<string, string> = {
    pending: '대기',
    received: '대기',
    working: '작업중',
    transferred: '업무이관',
    completed: '완료',
  };
  return mapping[status] || '대기';
};

export const mapCellRow = (row: Record<string, unknown>): Record<string, any> => {
  const saved = JSON.parse(String(row.details_json || '{}')) as Record<string, unknown>;
  return {
    ...saved,
    id: row.id,
    cellName: row.cell_name,
    region: row.region,
    lineCode: row.line_code || row.cell_code,
    address: row.address,
    status: row.status,
    opticalNode: row.node_name,
    responsibleTeam: row.responsible_team || saved.responsibleTeam || '',
    remarks: row.memo || '',
  };
};

export const mapTransferRow = (row: Record<string, unknown>) => {
  const saved = JSON.parse(String(row.extra_json || '{}')) as Record<string, unknown>;
  const logs = db.prepare(`
    SELECT author_name, from_status, to_status, comment, created_at
      FROM work_transfer_logs
     WHERE transfer_id = ? ORDER BY created_at DESC, id DESC
  `).all(String(row.id)) as Array<Record<string, unknown>>;

  return {
    ...saved,
    id: row.id,
    cellName: row.cell_name || saved.cellName || '',
    transferReason: row.title,
    requestDetails: row.description,
    requestDate: row.transfer_date,
    status: fromDbTransferStatus(String(row.status)),
    completedDate: row.completed_at || undefined,
    logs: logs.map((log) => ({
      timestamp: log.created_at,
      author: log.author_name,
      fromStatus: log.from_status ? fromDbTransferStatus(String(log.from_status)) : undefined,
      toStatus: fromDbTransferStatus(String(log.to_status)),
      comment: log.comment,
    })),
  };
};

export const mapDailyWorkRow = (row: Record<string, unknown>) => ({
  id: row.id,
  date: row.work_date,
  workerName: row.worker_name,
  team: row.department,
  counts: JSON.parse(String(row.counts_json || '{}')),
  memo: row.memo || undefined,
  updatedAt: row.updated_at,
});

export const mapMaterialUsageRow = (row: Record<string, unknown>) => ({
  id: row.id,
  workDate: row.usage_date,
  workerName: row.worker_name,
  cellName: row.cell_name || '',
  materialName: row.material_name,
  spec: row.specification || '',
  quantity: row.quantity,
  unit: row.unit,
  purpose: row.purpose,
  workDetails: row.work_details || '',
  remarks: row.memo || undefined,
  createdAt: row.created_at,
});
