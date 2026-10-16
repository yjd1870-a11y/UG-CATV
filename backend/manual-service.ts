import { randomUUID } from 'node:crypto';
import { db } from './db';
import { ApiError, asText, optionalText } from './http';
import { MANUAL_LIMITS, type ManualKind, type ManualModel, type ManualAsset } from '../src/features/manual/types';

export const manualAssetUrl = (id: string) => `/api/manual/assets/${encodeURIComponent(id)}/content`;
const modelSelect = `SELECT m.*, c.name AS category_name FROM manual_models m JOIN manual_categories c ON c.id = m.category_id
  WHERE m.deleted_at IS NULL AND c.deleted_at IS NULL`;
type Row = Record<string, any>;
const imageUrl = (modelId: string) => {
  const photo = db.prepare("SELECT id FROM manual_assets WHERE model_id = ? AND purpose = 'model-cover' AND status = 'ready' AND id = (SELECT image_asset_id FROM manual_models WHERE id = ?)").get(modelId, modelId) as { id: string } | undefined;
  return photo ? manualAssetUrl(photo.id) : null;
};
const mapModel = (row: Row): ManualModel => ({ id: row.id, categoryId: row.category_id, categoryName: row.category_name,
  name: row.name, manufacturer: row.manufacturer, description: row.description, body: row.body, tips: row.tips,
  version: row.version, imageUrl: imageUrl(row.id) });

export const getManualModel = (id: string) => {
  const row = db.prepare(`${modelSelect} AND m.id = ?`).get(id) as Row | undefined;
  if (!row) throw new ApiError(404, '모델 정보를 찾을 수 없습니다.', 'NOT_FOUND');
  return mapModel(row);
};
export const listManualCategories = () => (db.prepare('SELECT * FROM manual_categories WHERE deleted_at IS NULL ORDER BY created_at, name').all() as Row[]).map((row) => {
  const photo = db.prepare(`SELECT a.id FROM manual_assets a JOIN manual_models m ON m.id = a.model_id
    WHERE m.category_id = ? AND m.deleted_at IS NULL AND a.kind = 'photo' AND a.status = 'ready' ORDER BY a.created_at, a.rowid LIMIT 1`).get(row.id) as { id: string } | undefined;
  return { id: row.id, name: row.name, description: row.description, imageUrl: photo ? manualAssetUrl(photo.id) : null };
});
export const listManualModels = (categoryId: string) => {
  if (!db.prepare('SELECT id FROM manual_categories WHERE id = ? AND deleted_at IS NULL').get(categoryId)) throw new ApiError(404, '장비 종류를 찾을 수 없습니다.');
  return (db.prepare(`${modelSelect} AND m.category_id = ? ORDER BY m.name, m.manufacturer`).all(categoryId) as Row[]).map(mapModel);
};
export const saveManualCategory = (id: string | null, input: Row) => {
  const name = asText(input.name, '장비명', 80); const description = optionalText(input.description, 200) || '';
  if (id && !db.prepare('SELECT id FROM manual_categories WHERE id = ? AND deleted_at IS NULL').get(id)) throw new ApiError(404, '장비 종류를 찾을 수 없습니다.');
  const duplicate = db.prepare('SELECT id, deleted_at FROM manual_categories WHERE name = ? AND id <> ?').get(name, id || '') as { id: string; deleted_at: string | null } | undefined;
  if (duplicate) {
    if (id || !duplicate.deleted_at) throw new ApiError(409, '이미 등록된 장비명입니다.');
    // Reuse the reserved name without reviving deleted models or their attachments.
    db.prepare('UPDATE manual_categories SET description = ?, deleted_at = NULL WHERE id = ?').run(description, duplicate.id);
    return { id: duplicate.id };
  }
  const key = id || randomUUID();
  if (id) db.prepare('UPDATE manual_categories SET name = ?, description = ? WHERE id = ?').run(name, description, id);
  else db.prepare('INSERT INTO manual_categories (id, name, description) VALUES (?, ?, ?)').run(key, name, description);
  return { id: key };
};
export const saveManualModel = (id: string | null, input: Row) => {
  const categoryId = asText(input.categoryId, '장비 종류', 100); listManualModels(categoryId);
  const name = asText(input.name, '모델명', 100); const manufacturer = optionalText(input.manufacturer, 100) || '';
  const description = optionalText(input.description, 200) || '';
  if (id) getManualModel(id);
  if (db.prepare('SELECT id FROM manual_models WHERE category_id = ? AND name = ? AND manufacturer = ? AND id <> ? AND deleted_at IS NULL').get(categoryId, name, manufacturer, id || '')) throw new ApiError(409, '같은 모델이 이미 등록되어 있습니다.');
  const key = id || randomUUID();
  if (id) db.prepare('UPDATE manual_models SET category_id = ?, name = ?, manufacturer = ?, description = ?, updated_at = CURRENT_TIMESTAMP, version = version + 1 WHERE id = ?').run(categoryId, name, manufacturer, description, id);
  else db.prepare('INSERT INTO manual_models (id, category_id, name, manufacturer, description) VALUES (?, ?, ?, ?, ?)').run(key, categoryId, name, manufacturer, description);
  return getManualModel(key);
};
export const saveManualText = (id: string, input: Row) => {
  getManualModel(id);
  const body = optionalText(input.body, 20000) || ''; const tips = optionalText(input.tips, 10000) || '';
  if (!Number.isInteger(input.version) || input.version < 1) throw new ApiError(400, '본문 버전을 확인해주세요.');
  const changed = db.prepare('UPDATE manual_models SET body = ?, tips = ?, version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND version = ? AND deleted_at IS NULL').run(body, tips, id, input.version);
  if (!changed.changes) throw new ApiError(409, '다른 사용자가 수정했습니다. 입력한 글을 복사한 후 새로고침해주세요.', 'VERSION_CONFLICT');
  return getManualModel(id);
};
export const getManualAsset = (id: string, readyOnly = true): Row => {
  const asset = db.prepare(`SELECT a.* FROM manual_assets a JOIN manual_models m ON m.id = a.model_id JOIN manual_categories c ON c.id = m.category_id
    WHERE a.id = ? AND m.deleted_at IS NULL AND c.deleted_at IS NULL ${readyOnly ? "AND a.status = 'ready'" : ''}`).get(id) as Row | undefined;
  if (!asset) throw new ApiError(404, '첨부자료를 찾을 수 없습니다.', 'NOT_FOUND');
  return asset;
};
export const saveManualModelImage = (modelId: string, assetId: unknown) => {
  getManualModel(modelId);
  const photo = getManualAsset(asText(assetId, '장비 사진', 100));
  if (photo.model_id !== modelId || photo.kind !== 'photo' || photo.purpose !== 'model-cover') throw new ApiError(400, '이 모델의 목록 썸네일만 선택할 수 있습니다.');
  const previous = db.prepare('SELECT image_asset_id FROM manual_models WHERE id = ?').get(modelId) as { image_asset_id: string | null };
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare('UPDATE manual_models SET image_asset_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(photo.id, modelId);
    if (previous.image_asset_id && previous.image_asset_id !== photo.id) deleteManualAssetRecord(previous.image_asset_id);
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
  return getManualModel(modelId);
};
const validPoster = (id: unknown, modelId: string) => {
  if (!id) return null;
  const poster = getManualAsset(asText(id, '썸네일', 100));
  if (poster.model_id !== modelId || poster.kind !== 'thumbnail') throw new ApiError(400, '같은 모델의 동영상 썸네일을 선택해주세요.');
  return poster.id as string;
};
export const listManualAssets = (id: string): ManualAsset[] => {
  getManualModel(id);
  return (db.prepare("SELECT a.*, p.id AS available_poster FROM manual_assets a LEFT JOIN manual_assets p ON p.id = a.poster_id AND p.status = 'ready' WHERE a.model_id = ? AND a.status = 'ready' ORDER BY a.created_at, a.rowid").all(id) as Row[]).map((a) => ({
    id: a.id, modelId: a.model_id, kind: a.kind, purpose: a.purpose, title: a.title, fileName: a.file_name, mime: a.mime, bytes: a.bytes,
    url: manualAssetUrl(a.id), posterId: a.available_poster || null, posterUrl: a.available_poster ? manualAssetUrl(a.available_poster) : null,
  }));
};
export const reserveManualUpload = (modelId: string, input: Row, userId: string) => {
  getManualModel(modelId);
  const kind = input.kind as ManualKind; const limit = MANUAL_LIMITS[kind];
  const purpose = input.purpose || 'manual';
  if (!['manual', 'model-cover'].includes(purpose) || (purpose === 'model-cover' && kind !== 'photo')) throw new ApiError(400, '파일 용도가 올바르지 않습니다.');
  if (!Object.hasOwn(MANUAL_LIMITS, kind)) throw new ApiError(400, '지원하지 않는 자료 유형입니다.');
  const mime = asText(input.mime, '파일 형식', 100);
  if (!(limit.mime as readonly string[]).includes(mime)) throw new ApiError(400, '지원하지 않는 파일 형식입니다.');
  const bytes = input.bytes;
  if (!Number.isSafeInteger(bytes) || bytes <= 0 || bytes > limit.bytes) throw new ApiError(413, '파일이 비어 있거나 허용 용량을 초과했습니다.');
  const title = asText(input.title, '자료 제목', 120); const fileName = asText(input.fileName, '파일명', 200).replace(/[\x00-\x1f\x7f/\\]/g, '_');
  const extension = mime === 'video/mp4' ? '.mp4' : mime === 'application/pdf' ? '.pdf' : mime === 'image/png' ? '.png' : mime === 'image/webp' ? '.webp' : '.jpg';
  if (!fileName.toLowerCase().endsWith(extension) && !(mime === 'image/jpeg' && /\.jpeg$/i.test(fileName))) throw new ApiError(400, '파일 확장자와 형식이 일치하지 않습니다.');
  const posterId = kind === 'video' ? validPoster(input.posterId, modelId) : null;
  const id = randomUUID(); const objectKey = `manuals/${modelId}/${id}${extension}`;
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  db.exec('BEGIN IMMEDIATE');
  try {
    const count = db.prepare("SELECT COUNT(*) AS n FROM manual_assets WHERE model_id = ? AND kind = ? AND purpose = ? AND (status IN ('ready','uploading') OR status = 'pending' AND expires_at > ?)").get(modelId, kind, purpose, new Date().toISOString()) as { n: number };
    const max = purpose === 'model-cover' ? 2 : limit.count;
    if (count.n >= max) throw new ApiError(409, `이 모델의 ${kind === 'video' ? '영상' : '첨부자료'}은 최대 ${max}개까지 등록할 수 있습니다.`);
    db.prepare("INSERT INTO manual_assets (id,model_id,kind,title,file_name,mime,bytes,object_key,poster_id,status,uploaded_by,expires_at) VALUES (?,?,?,?,?,?,?,?,?,'pending',?,?)").run(id, modelId, kind, title, fileName, mime, bytes, objectKey, posterId, userId, expiresAt);
    db.prepare('UPDATE manual_assets SET purpose = ? WHERE id = ?').run(purpose, id);
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
  return { id, uploadUrl: `/api/manual/assets/${id}/upload`, expiresAt };
};
export const editManualAsset = (id: string, input: Row) => {
  const a = getManualAsset(id); const title = asText(input.title, '자료 제목', 120);
  // Retain previously linked posters while preventing new links to manual photos.
  const posterId = a.kind === 'video' ? (input.posterId && input.posterId === a.poster_id ? a.poster_id : validPoster(input.posterId, a.model_id)) : null;
  db.prepare('UPDATE manual_assets SET title = ?, poster_id = ? WHERE id = ? AND status = ?').run(title, posterId, id, 'ready');
};
export const deleteManualAssetRecord = (id: string) => {
  const a = getManualAsset(id, false);
  if (a.status === 'uploading') throw new ApiError(409, '업로드 중입니다. 완료 후 다시 시도해주세요.');
  db.prepare("UPDATE manual_assets SET status = 'deleted' WHERE id = ?").run(id);
  db.prepare('UPDATE manual_assets SET poster_id = NULL WHERE poster_id = ?').run(id);
  db.prepare('UPDATE manual_models SET image_asset_id = NULL WHERE image_asset_id = ?').run(id);
};
export const deleteManualModel = (id: string) => {
  getManualModel(id);
  if (db.prepare("SELECT id FROM manual_assets WHERE model_id = ? AND status = 'uploading'").get(id)) throw new ApiError(409, '첨부파일 업로드 완료 후 다시 시도해주세요.');
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare('UPDATE manual_models SET deleted_at = CURRENT_TIMESTAMP WHERE id = ?').run(id);
    db.prepare("UPDATE manual_assets SET status = 'deleted' WHERE model_id = ?").run(id);
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
};
export const deleteManualCategory = (id: string) => {
  if (listManualModels(id).length) throw new ApiError(409, '모델을 먼저 삭제해주세요.');
  db.prepare('UPDATE manual_categories SET deleted_at = CURRENT_TIMESTAMP WHERE id = ?').run(id);
};
