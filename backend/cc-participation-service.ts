import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { db } from './db';
import { env } from './env';
import { ApiError, optionalText } from './http';
import { usesR2Storage, putR2Object, deleteR2Object } from './object-storage';
import { CC_MAX_SECTIONS, CC_PHOTO_MAX_BYTES, CC_PARTICIPATION_TITLE, CC_INTRODUCTION_DEFAULT_COLOR, type CcParticipationDocument } from '../src/features/home/cc-participation-process';

type StoredSection = { id: string; title: string; description: string; photoId: string | null };
type StoredDocument = { introduction: string; introduction_color: string; sections_json: string; bottom_text: string; version: number };
export type CcPhotoRow = { id: string; object_key: string; uploaded_by: string; deleted_at: string | null };

export const initializeCcParticipation = () => {
  db.exec(`CREATE TABLE IF NOT EXISTS cc_participation_document (
    id INTEGER PRIMARY KEY CHECK(id = 1), introduction TEXT NOT NULL DEFAULT '', introduction_color TEXT NOT NULL DEFAULT '#475569',
    sections_json TEXT NOT NULL DEFAULT '[]', bottom_text TEXT NOT NULL DEFAULT '',
    version INTEGER NOT NULL DEFAULT 1, updated_by TEXT REFERENCES users(id), updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS cc_participation_photos (
    id TEXT PRIMARY KEY, object_key TEXT NOT NULL UNIQUE, uploaded_by TEXT NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, deleted_at TEXT, purged_at TEXT
  );
  INSERT OR IGNORE INTO cc_participation_document (id) VALUES (1);`);
  const columns = db.prepare('PRAGMA table_info(cc_participation_document)').all() as { name: string }[];
  if (!columns.some((column) => column.name === 'introduction_color')) {
    db.exec("ALTER TABLE cc_participation_document ADD COLUMN introduction_color TEXT NOT NULL DEFAULT '#475569'");
  }
};
const storedDocument = () => db.prepare('SELECT * FROM cc_participation_document WHERE id = 1').get() as StoredDocument;
const storedSections = () => JSON.parse(storedDocument().sections_json) as StoredSection[];
export const ccPhotoIsLinked = (id: string) => storedSections().some((section) => section.photoId === id);
export const getCcPhoto = (id: string) => {
  const photo = db.prepare('SELECT * FROM cc_participation_photos WHERE id = ? AND deleted_at IS NULL').get(id) as CcPhotoRow | undefined;
  if (!photo) throw new ApiError(404, '사진을 찾을 수 없습니다.', 'NOT_FOUND');
  return photo;
};
export const ccPhotoPath = (key: string) => {
  if (!/^cc-participation\/[a-f0-9-]+\.webp$/.test(key)) throw new ApiError(400, '사진 위치가 올바르지 않습니다.');
  return path.join(env.privateStoragePath, key);
};
export const readCcParticipation = (canManage: boolean): CcParticipationDocument => {
  const doc = storedDocument();
  return { title: CC_PARTICIPATION_TITLE, introduction: doc.introduction, introductionColor: doc.introduction_color, bottomText: doc.bottom_text, version: doc.version, canManage,
    sections: (JSON.parse(doc.sections_json) as StoredSection[]).map((section) => ({ id: section.id, title: section.title, description: section.description,
      photo: section.photoId ? { id: section.photoId, url: `/api/cc-participation/photos/${section.photoId}`, alt: section.title || 'CC 참여 프로세스 사진' } : null,
    })),
  };
};
export const saveCcParticipation = (input: Record<string, unknown>, userId: string) => {
  if (!Number.isInteger(input.version) || Number(input.version) < 1) throw new ApiError(400, '자료 버전을 확인해주세요.');
  if (!Array.isArray(input.sections) || input.sections.length > CC_MAX_SECTIONS) throw new ApiError(400, '사진·설명 항목은 최대 5개입니다.');
  const introduction = optionalText(input.introduction, 2000) || '';
  const requestedColor = input.introductionColor === undefined ? storedDocument().introduction_color || CC_INTRODUCTION_DEFAULT_COLOR : input.introductionColor;
  if (typeof requestedColor !== 'string' || !/^#[0-9a-f]{6}$/i.test(requestedColor)) throw new ApiError(400, '안내문구 색상을 올바르게 선택해주세요.');
  const introductionColor = requestedColor.toLowerCase();
  const bottomText = optionalText(input.bottomText, 20000) || '';
  const currentIds = new Set(storedSections().flatMap((section) => section.photoId ? [section.photoId] : []));
  const sections: StoredSection[] = input.sections.map((value, index) => {
    if (!value || typeof value !== 'object') throw new ApiError(400, '자료 항목을 확인해주세요.');
    const item = value as Record<string, unknown>;
    const title = optionalText(item.title, 120) || '';
    const description = optionalText(item.description, 10000) || '';
    const photoId = optionalText(item.photoId, 100);
    if (photoId) {
      const photo = getCcPhoto(photoId);
      if (!currentIds.has(photoId) && photo.uploaded_by !== userId) throw new ApiError(403, '다른 관리자의 미등록 사진은 사용할 수 없습니다.');
    }
    return { id: `cc-participation-${index + 1}`, title, description, photoId };
  }).filter((section) => section.title || section.description || section.photoId);
  const nextIds = new Set(sections.flatMap((section) => section.photoId ? [section.photoId] : []));
  db.exec('BEGIN IMMEDIATE');
  try {
    const saved = db.prepare('UPDATE cc_participation_document SET introduction = ?, introduction_color = ?, sections_json = ?, bottom_text = ?, version = version + 1, updated_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 1 AND version = ?')
      .run(introduction, introductionColor, JSON.stringify(sections), bottomText, userId, Number(input.version));
    if (!saved.changes) throw new ApiError(409, '다른 관리자가 먼저 수정했습니다. 작성한 글을 복사한 뒤 창을 다시 열어 최신 자료를 확인해주세요.', 'VERSION_CONFLICT');
    for (const id of currentIds) if (!nextIds.has(id)) db.prepare('UPDATE cc_participation_photos SET deleted_at = CURRENT_TIMESTAMP WHERE id = ?').run(id);
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
  return readCcParticipation(true);
};

let processingUploads = 0;
export const storeCcPhoto = async (bytes: Buffer, mime: string, userId: string) => {
  if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > CC_PHOTO_MAX_BYTES) throw new ApiError(413, '사진은 최대 10MB까지 등록할 수 있습니다.');
  if (processingUploads >= 2) throw new ApiError(429, '다른 사진을 처리 중입니다. 잠시 후 다시 시도해주세요.');
  const pending = db.prepare("SELECT COUNT(*) AS count FROM cc_participation_photos WHERE uploaded_by = ? AND deleted_at IS NULL AND id NOT IN (SELECT json_extract(value, '$.photoId') FROM cc_participation_document, json_each(sections_json) WHERE json_extract(value, '$.photoId') IS NOT NULL)").get(userId) as { count: number };
  if (pending.count >= 10) throw new ApiError(409, '저장하지 않은 사진이 많습니다. 자료를 저장하거나 잠시 후 다시 시도해주세요.');
  processingUploads++;
  try {
    let output: Buffer;
    try {
      const image = sharp(bytes, { limitInputPixels: 40_000_000 });
      const metadata = await image.metadata();
      if (!['jpeg', 'png', 'webp'].includes(metadata.format || '') || mime !== `image/${metadata.format}` || !metadata.width || !metadata.height || Math.max(metadata.width, metadata.height) > 16384 || (metadata.pages || 1) > 1) throw new Error('Invalid image');
      output = await image.rotate().resize({ width: 2000, height: 2000, fit: 'inside', withoutEnlargement: true }).webp({ quality: 88 }).toBuffer();
    } catch { throw new ApiError(400, '올바른 JPG·PNG·WebP 사진을 선택해주세요.'); }
    const id = randomUUID();
    const key = `cc-participation/${id}.webp`;
    db.prepare('INSERT INTO cc_participation_photos (id, object_key, uploaded_by) VALUES (?, ?, ?)').run(id, key, userId);
    try {
      if (usesR2Storage) await putR2Object(key, output, 'image/webp');
      else { const destination = ccPhotoPath(key); await fs.mkdir(path.dirname(destination), { recursive: true }); await fs.writeFile(destination, output, { flag: 'wx' }); }
    } catch (error) { db.prepare('UPDATE cc_participation_photos SET deleted_at = CURRENT_TIMESTAMP WHERE id = ?').run(id); throw error; }
    return { id, url: `/api/cc-participation/photos/${id}` };
  } finally { processingUploads--; }
};
export const discardCcPhoto = (id: string, userId: string) => {
  const photo = getCcPhoto(id);
  if (photo.uploaded_by !== userId || ccPhotoIsLinked(id)) throw new ApiError(409, '저장된 사진은 해당 자료를 수정하여 삭제해주세요.');
  db.prepare('UPDATE cc_participation_photos SET deleted_at = CURRENT_TIMESTAMP WHERE id = ?').run(id);
};
let purging = false;
export const purgeCcPhotos = async () => {
  if (purging) return;
  purging = true;
  try {
    db.prepare("UPDATE cc_participation_photos SET deleted_at = CURRENT_TIMESTAMP WHERE deleted_at IS NULL AND created_at < datetime('now', '-1 day') AND id NOT IN (SELECT json_extract(value, '$.photoId') FROM cc_participation_document, json_each(sections_json) WHERE json_extract(value, '$.photoId') IS NOT NULL)").run();
    const photos = db.prepare('SELECT * FROM cc_participation_photos WHERE deleted_at IS NOT NULL AND purged_at IS NULL LIMIT 50').all() as CcPhotoRow[];
    for (const photo of photos) {
      try {
        if (usesR2Storage) await deleteR2Object(photo.object_key);
        else await fs.rm(ccPhotoPath(photo.object_key), { force: true });
        db.prepare('UPDATE cc_participation_photos SET purged_at = CURRENT_TIMESTAMP WHERE id = ?').run(photo.id);
      } catch { /* Retry the persisted deletion ledger on the next cleanup. */ }
    }
  } finally { purging = false; }
};
