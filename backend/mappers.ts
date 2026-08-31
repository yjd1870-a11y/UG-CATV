import { db } from './db';

export const fromDbTransferStatus = (status: string) => {
  const mapping: Record<string, string> = {
    pending: '미완료',
    received: '미완료',
    working: '현장처리',
    transferred: '현장처리',
    completed: '완료',
  };
  return mapping[status] || '미완료';
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
  const attachments = db.prepare(`
    SELECT id, attachment_type, file_name, file_type, file_size, uploaded_by, created_at
      FROM work_transfer_attachments
     WHERE transfer_id = ? AND deleted_at IS NULL ORDER BY created_at, id
  `).all(String(row.id)) as Array<Record<string, unknown>>;
  const fieldActions = db.prepare(`
    SELECT id, action_text, processed_by, processed_by_name, processed_at, created_at
      FROM work_transfer_field_actions
     WHERE transfer_id = ? ORDER BY processed_at DESC, created_at DESC
  `).all(String(row.id)) as Array<Record<string, unknown>>;
  const workflowStatus = String(row.workflow_status || (String(row.status) === 'completed' ? 'completed' : 'registered'));
  const status = workflowStatus === 'completed' ? '완료' : workflowStatus === 'field_processed' ? '현장처리' : '미완료';

  return {
    ...saved,
    id: row.id,
    cellName: row.cell_name || saved.cellName || '',
    branchName: row.branch_name || saved.branchName || '',
    requesterName: row.requester_name || saved.requesterName || '',
    inspectionCompany: row.inspection_company || saved.inspectionCompany || saved.contractor || '유지텔레컴',
    contractor: row.inspection_company || saved.contractor || '유지텔레컴',
    inspectionRequestedDate: row.inspection_requested_date || saved.inspectionRequestedDate || row.transfer_date,
    requestDate: row.inspection_requested_date || row.transfer_date,
    customerAddress: row.customer_address || saved.customerAddress || saved.location || '',
    location: row.customer_address || saved.location || '',
    handoverReason: row.handover_reason || saved.handoverReason || row.title,
    transferReason: row.handover_reason || row.title,
    mediaType: row.media_type || saved.mediaType || 'CABLE',
    tapRnLocation: row.tap_rn_location || saved.tapRnLocation || '',
    poleNumber: row.pole_number || saved.poleNumber || '',
    leadInLength: row.lead_in_length || saved.leadInLength || '',
    preActionNotes: row.pre_action_notes || saved.preActionNotes || '',
    inspectionRequestDetails: row.inspection_request_details || saved.inspectionRequestDetails || row.description,
    requestDetails: row.inspection_request_details || row.description,
    createdAt: row.created_at,
    status,
    workflowStatus,
    regionId: row.region_id || saved.regionId || '',
    regionName: row.region_name || saved.regionName || '',
    isUrgent: Boolean(row.is_urgent),
    ocrStatus: row.ocr_status || 'pending',
    evidencePhotoCount: Number(row.evidence_photo_count || attachments.length),
    evidencePhotosDeletedAt: row.evidence_photos_deleted_at || undefined,
    fieldProcessedAt: row.field_processed_at || undefined,
    fieldProcessedBy: row.field_processed_by || undefined,
    fieldProcessedByName: row.field_processed_by_name || undefined,
    finalCompletedBy: row.final_completed_by || undefined,
    finalCompletedByName: row.final_completed_by_name || undefined,
    completedDate: row.completed_at || undefined,
    attachments: attachments.map((attachment) => ({
      id: attachment.id,
      attachmentType: attachment.attachment_type,
      fileName: attachment.file_name,
      fileType: attachment.file_type,
      fileSize: Number(attachment.file_size),
      uploadedBy: attachment.uploaded_by || undefined,
      createdAt: attachment.created_at,
      url: `/work-transfers/${row.id}/attachments/${attachment.id}/file`,
    })),
    fieldActions: fieldActions.map((action) => ({
      id: action.id,
      actionText: action.action_text,
      processedBy: action.processed_by || undefined,
      processedByName: action.processed_by_name,
      processedAt: action.processed_at,
      createdAt: action.created_at,
    })),
    fieldActionSummary: fieldActions[0]?.action_text || '',
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
