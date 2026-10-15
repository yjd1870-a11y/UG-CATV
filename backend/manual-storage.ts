import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import type { Request, Response } from 'express';
import sharp from 'sharp';
import { db } from './db';
import { env } from './env';
import { ApiError } from './http';
import { deleteR2Object, headR2Object, putR2ObjectStream, signedR2DownloadUrl, usesR2Storage } from './object-storage';
import { getManualAsset } from './manual-service';

const root = path.resolve(env.privateStoragePath, 'manuals');
const activeUploads = new Set<string>();
const localPath = (key: string) => {
  if (!/^manuals\/[a-zA-Z0-9-]+\/[a-f0-9-]+\.(mp4|pdf|jpg|png|webp)$/.test(key)) throw new ApiError(400, '파일 위치가 올바르지 않습니다.');
  const resolved = path.resolve(root, key.slice('manuals/'.length));
  if (!resolved.startsWith(root + path.sep)) throw new ApiError(400, '파일 위치가 올바르지 않습니다.');
  return resolved;
};

const validateFile = async (file: string, mime: string, size: number) => {
  const handle = await fs.promises.open(file, 'r');
  try {
    const head = Buffer.alloc(32); await handle.read(head, 0, head.length, 0);
    if (mime === 'application/pdf') {
      const tail = Buffer.alloc(Math.min(size, 2048)); await handle.read(tail, 0, tail.length, size - tail.length);
      if (!head.subarray(0, 5).equals(Buffer.from('%PDF-')) || !tail.includes(Buffer.from('%%EOF'))) throw new ApiError(400, '유효한 PDF 파일이 아닙니다.');
    } else if (mime === 'video/mp4') {
      if (head.toString('ascii', 4, 8) !== 'ftyp') throw new ApiError(400, '유효한 MP4 영상이 아닙니다.');
      let offset = 0; let media = false; let movie = false;
      while (offset + 8 <= size) {
        const box = Buffer.alloc(16); await handle.read(box, 0, Math.min(16, size - offset), offset);
        const type = box.toString('ascii', 4, 8); let length = box.readUInt32BE(0); let headerSize = 8;
        if (length === 1) { const big = box.readBigUInt64BE(8); if (big > BigInt(Number.MAX_SAFE_INTEGER)) throw new ApiError(400, 'MP4 크기가 올바르지 않습니다.'); length = Number(big); headerSize = 16; }
        if (length === 0) length = size - offset;
        if (length < headerSize || offset + length > size) throw new ApiError(400, '손상된 MP4 파일입니다.');
        if (type === 'mdat') media = true;
        if (type === 'moov') {
          if (length > 16 * 1024 * 1024) throw new ApiError(400, '영상 메타데이터가 너무 큽니다. 다시 압축해주세요.');
          const moov = Buffer.alloc(length); await handle.read(moov, 0, length, offset);
          if (!moov.includes(Buffer.from('avc1')) && !moov.includes(Buffer.from('avc3'))) throw new ApiError(400, 'H.264 형식의 MP4로 변환해주세요.');
          movie = true;
        }
        offset += length;
      }
      if (!media || !movie || offset !== size) throw new ApiError(400, '재생 가능한 MP4 파일이 아닙니다.');
    } else {
      try {
        // Images are capped at 10MB. Buffer input prevents libvips' file cache
        // from holding the temporary file open across rename/delete on Windows.
        const image = await fs.promises.readFile(file);
        const meta = await sharp(image, { limitInputPixels: 40_000_000 }).metadata();
        const expected = mime.split('/')[1];
        if (meta.format !== expected || !meta.width || !meta.height || Math.max(meta.width, meta.height) > 16384 || (meta.pages || 1) > 1) throw new Error('Invalid image');
        await sharp(image, { limitInputPixels: 40_000_000 }).resize(1, 1).toBuffer();
      } catch { throw new ApiError(400, '올바른 JPG·PNG·WebP 사진을 선택해주세요.'); }
    }
  } finally { await handle.close(); }
};

export const receiveManualUpload = async (req: Request, id: string, userId: string) => {
  if (activeUploads.size >= 2) throw new ApiError(429, '다른 파일을 전송 중입니다. 완료 후 다시 시도해주세요.');
  const a = getManualAsset(id, false);
  if (a.uploaded_by !== userId) throw new ApiError(403, '업로드를 요청한 관리자만 파일을 전송할 수 있습니다.');
  if (a.status !== 'pending' || Date.parse(a.expires_at) <= Date.now()) throw new ApiError(409, '업로드 요청이 만료되었거나 이미 처리되었습니다.');
  if (req.get('content-type')?.split(';')[0] !== a.mime) throw new ApiError(400, '요청한 파일 형식과 실제 전송 형식이 다릅니다.');
  const length = req.get('content-length');
  if (length && Number(length) !== a.bytes) throw new ApiError(400, '파일 크기가 일치하지 않습니다.');
  const claim = db.prepare("UPDATE manual_assets SET status = 'uploading' WHERE id = ? AND status = 'pending'").run(id);
  if (!claim.changes) throw new ApiError(409, '이미 업로드 중입니다.');
  activeUploads.add(id);
  const destination = localPath(a.object_key); const temporary = destination + '.part';
  try {
    await fs.promises.mkdir(path.dirname(destination), { recursive: true });
    let bytes = 0;
    const limiter = new Transform({ transform(chunk, _encoding, callback) {
      bytes += chunk.length;
      callback(bytes > a.bytes ? new ApiError(413, '허용된 파일 크기를 초과했습니다.') : null, bytes > a.bytes ? undefined : chunk);
    } });
    await pipeline(req, limiter, fs.createWriteStream(temporary, { flags: 'wx' }));
    if (bytes !== a.bytes) throw new ApiError(400, '파일이 완전히 전송되지 않았습니다.');
    await validateFile(temporary, a.mime, bytes);
    if (usesR2Storage) await putR2ObjectStream(a.object_key, fs.createReadStream(temporary), bytes, a.mime);
    else await fs.promises.rename(temporary, destination);
    // Keep the ledger until storage succeeds, and claim only this upload's record.
    const committed = db.prepare("UPDATE manual_assets SET status = 'ready' WHERE id = ? AND status = 'uploading'").run(id);
    if (!committed.changes) throw new ApiError(409, '파일 등록 상태가 변경되었습니다.');
  } catch (error) {
    db.prepare("UPDATE manual_assets SET status = 'deleted' WHERE id = ?").run(id);
    throw error;
  } finally {
    activeUploads.delete(id);
    await fs.promises.rm(temporary, { force: true }).catch(() => {});
    await purgeManualStorage();
  }
};

let purging = false;
/** Failed deletions remain in SQLite and are retried; never delete a live upload. */
export const purgeManualStorage = async () => {
  if (purging) return;
  purging = true;
  try {
    const stale = db.prepare("SELECT id FROM manual_assets WHERE status IN ('pending','uploading') AND expires_at < ?").all(new Date().toISOString()) as { id: string }[];
    for (const a of stale) if (!activeUploads.has(a.id)) db.prepare("UPDATE manual_assets SET status = 'deleted' WHERE id = ?").run(a.id);
    const rows = db.prepare("SELECT id,object_key FROM manual_assets WHERE status = 'deleted' AND purged_at IS NULL LIMIT 50").all() as { id: string; object_key: string }[];
    for (const a of rows) {
      if (activeUploads.has(a.id)) continue;
      try {
        const file = localPath(a.object_key);
        if (usesR2Storage) await deleteR2Object(a.object_key);
        await fs.promises.rm(file, { force: true }); await fs.promises.rm(file + '.part', { force: true });
        db.prepare('UPDATE manual_assets SET purged_at = CURRENT_TIMESTAMP WHERE id = ?').run(a.id);
      } catch { db.prepare('UPDATE manual_assets SET purge_attempts = purge_attempts + 1 WHERE id = ?').run(a.id); }
    }
  } finally { purging = false; }
};

export const serveManualAsset = async (id: string, req: Request, res: Response) => {
  const a = getManualAsset(id);
  res.setHeader('Cache-Control', 'private, no-store');
  if (usesR2Storage) {
    if (req.method === 'HEAD') {
      const head = await headR2Object(a.object_key).catch(() => null);
      if (!head) throw new ApiError(404, '파일을 불러올 수 없습니다. 관리자에게 문의해주세요.');
      res.setHeader('Content-Type', head.contentType); res.setHeader('Content-Length', head.size); res.setHeader('Accept-Ranges', 'bytes'); res.end(); return;
    }
    res.redirect(302, await signedR2DownloadUrl(a.object_key, { fileName: a.file_name, attachment: req.query.download === '1' })); return;
  }
  const file = localPath(a.object_key);
  const stat = await fs.promises.stat(file).catch(() => null);
  if (!stat) throw new ApiError(404, '파일을 불러올 수 없습니다. 관리자에게 문의해주세요.');
  const size = stat.size; let start = 0; let end = size - 1;
  const range = req.get('range');
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match || (!match[1] && !match[2])) { res.setHeader('Content-Range', `bytes */${size}`); res.sendStatus(416); return; }
    if (!match[1]) { const suffix = Number(match[2]); start = Math.max(0, size - suffix); if (suffix <= 0) start = size; }
    else { start = Number(match[1]); end = match[2] ? Math.min(Number(match[2]), size - 1) : end; }
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= size || start > end) { res.setHeader('Content-Range', `bytes */${size}`); res.sendStatus(416); return; }
    res.status(206); res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
  }
  res.setHeader('Accept-Ranges', 'bytes'); res.setHeader('Content-Type', a.mime); res.setHeader('Content-Length', end - start + 1);
  res.setHeader('Content-Disposition', `${req.query.download === '1' ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(a.file_name).replace(/'/g, '%27')}`);
  if (req.method === 'HEAD') { res.end(); return; }
  await pipeline(fs.createReadStream(file, { start, end }), res).catch((error) => { if (!res.destroyed) throw error; });
};
