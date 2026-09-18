import { randomUUID } from 'node:crypto';
import { db } from './db';
import { ApiError } from './http';
import { removePrivatePhoto } from './photo-storage';

export type PurgeAttachment = {
  id: string;
  file_url: string;
  thumbnail_url: string | null;
};

export const workTransferAttachmentsForPurge = (transferId: string) => db.prepare(`
  SELECT id, file_url, thumbnail_url
    FROM work_transfer_attachments
   WHERE transfer_id = ?
`).all(transferId) as PurgeAttachment[];

export const purgeWorkTransferPhotosNow = async (
  transferId: string,
  requestedBy: string,
  operation: 'COMPLETE' | 'DELETE',
  attachments: PurgeAttachment[],
) => {
  const attemptId = randomUUID();
  const now = new Date().toISOString();
  const objectKeys = [...new Set(attachments.flatMap((attachment) => [attachment.file_url, attachment.thumbnail_url])
    .filter((key): key is string => Boolean(key)))];

  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare(`
      INSERT INTO work_transfer_photo_purge_attempts (
        id, transfer_id, requested_by, operation, status, object_count, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'PENDING', ?, ?, ?)
    `).run(attemptId, transferId, requestedBy, operation, objectKeys.length, now, now);
    const insertItem = db.prepare(`
      INSERT INTO work_transfer_photo_purge_items (attempt_id, object_key) VALUES (?, ?)
    `);
    for (const objectKey of objectKeys) insertItem.run(attemptId, objectKey);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }

  let deletedCount = 0;
  for (const objectKey of objectKeys) {
    try {
      // R2 DeleteObject and local force removal are idempotent, so a partial
      // prior attempt can safely resume by deleting every recorded key again.
      await removePrivatePhoto(objectKey);
      deletedCount += 1;
      db.prepare(`
        UPDATE work_transfer_photo_purge_items
           SET deleted_at = ?, last_error = NULL
         WHERE attempt_id = ? AND object_key = ?
      `).run(new Date().toISOString(), attemptId, objectKey);
      db.prepare(`
        UPDATE work_transfer_photo_purge_attempts
           SET deleted_count = ?, updated_at = ? WHERE id = ?
      `).run(deletedCount, new Date().toISOString(), attemptId);
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 1000) : 'unknown storage deletion error';
      const failedAt = new Date().toISOString();
      db.prepare(`
        UPDATE work_transfer_photo_purge_items SET last_error = ?
         WHERE attempt_id = ? AND object_key = ?
      `).run(message, attemptId, objectKey);
      db.prepare(`
        UPDATE work_transfer_photo_purge_attempts
           SET status = 'FAILED', deleted_count = ?, last_error = ?, updated_at = ?
         WHERE id = ?
      `).run(deletedCount, message, failedAt, attemptId);
      throw new ApiError(
        503,
        '첨부사진을 완전히 삭제하지 못해 완료 처리를 중단했습니다. 잠시 후 다시 시도해 주세요.',
        'PHOTO_PURGE_FAILED',
      );
    }
  }

  return { attemptId, objectCount: objectKeys.length, deletedCount };
};

export const markWorkTransferPurgeSucceeded = (attemptId: string, completedAt: string) => {
  const updated = db.prepare(`
    UPDATE work_transfer_photo_purge_attempts
       SET status = 'SUCCEEDED', last_error = NULL, updated_at = ?, completed_at = ?
     WHERE transfer_id = (
       SELECT transfer_id FROM work_transfer_photo_purge_attempts WHERE id = ?
     ) AND status = 'PENDING'
  `).run(completedAt, completedAt, attemptId);
  if (Number(updated.changes) < 1) throw new Error('업무이관 사진 삭제 시도 상태를 완료로 변경하지 못했습니다.');
};
