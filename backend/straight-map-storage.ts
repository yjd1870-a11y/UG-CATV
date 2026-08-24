import fs from 'node:fs';
import path from 'node:path';
import { env } from './env';
import { deleteR2Prefix, signedR2DownloadUrl, usesR2Storage } from './object-storage';

// PDF v3 documents are uploaded directly by the Windows Agent to immutable R2 prefixes.
export const straightMapStorageRoot = path.join(env.privateStoragePath, 'straight-maps');

export const resolveLocalStraightMapObject = (key: string) => {
  const source = /^line-diagrams\/v3\/sources\/([a-f0-9]{64})\.xlsx$/i.exec(key);
  if (source) return path.join(straightMapStorageRoot, 'v3', 'sources', `${source[1].toLowerCase()}.xlsx`);
  const artifact = /^line-diagrams\/v3\/documents\/([a-f0-9-]{36})\/(.+)$/iu.exec(key);
  if (!artifact || artifact[2].split('/').some((part) => !part || part === '.' || part === '..' || /[\\:]/.test(part))) {
    throw new Error('유효하지 않은 로컬 직선도 객체 경로입니다.');
  }
  const root = path.resolve(straightMapStorageRoot, 'v3', 'documents', artifact[1]);
  const target = path.resolve(root, ...artifact[2].split('/'));
  if (!target.startsWith(root + path.sep)) throw new Error('유효하지 않은 로컬 직선도 객체 경로입니다.');
  return target;
};

export const resolveStraightMapPdf = (artifactSetId: string) => {
  if (!/^[a-f0-9-]{36}$/i.test(artifactSetId)) throw new Error('유효하지 않은 직선도 PDF 경로입니다.');
  return resolveLocalStraightMapObject(`line-diagrams/v3/documents/${artifactSetId}/map.pdf`);
};

const signedPdfCache = new Map<string, { url: string; expiresAt: number }>();
export const signedStraightMapPdfUrl = async (artifactSetId: string) => {
  if (!/^[a-f0-9-]{36}$/i.test(artifactSetId)) throw new Error('유효하지 않은 직선도 PDF 경로입니다.');
  const key = `line-diagrams/v3/documents/${artifactSetId}/map.pdf`;
  const now = Date.now();
  const cached = signedPdfCache.get(key);
  if (cached && cached.expiresAt > now + 15_000) return cached.url;
  const url = await signedR2DownloadUrl(key);
  signedPdfCache.set(key, { url, expiresAt: now + Math.max(30, env.r2SignedUrlTtlSeconds - 15) * 1000 });
  return url;
};
export const straightMapVersionRoot = (mapId: string, version: number) => {
  if (!/^[a-z0-9-]+$/i.test(mapId) || !Number.isSafeInteger(version) || version < 1) throw new Error('유효하지 않은 직선도 저장 경로입니다.');
  const root = path.resolve(straightMapStorageRoot);
  const target = path.resolve(root, mapId, String(version));
  if (!target.startsWith(root + path.sep)) throw new Error('유효하지 않은 직선도 저장 경로입니다.');
  return target;
};

export const removeStraightMapVersion = (mapId: string, version: number) => {
  fs.rmSync(straightMapVersionRoot(mapId, version), { recursive: true, force: true });
  if (usesR2Storage) void deleteR2Prefix(`line-diagrams/${mapId}/${version}/`).catch((error) => {
    console.warn('[R2_STRAIGHT_MAP_VERSION_DELETE_FAILED]', mapId, version, error);
  });
};

export const removeStraightMap = (mapId: string) => {
  if (!/^[a-z0-9-]+$/i.test(mapId)) throw new Error('유효하지 않은 직선도 지도 ID입니다.');
  const root = path.resolve(straightMapStorageRoot);
  const target = path.resolve(root, mapId);
  if (!target.startsWith(root + path.sep)) throw new Error('유효하지 않은 직선도 저장 경로입니다.');
  fs.rmSync(target, { recursive: true, force: true });
  if (usesR2Storage) void deleteR2Prefix(`line-diagrams/${mapId}/`).catch((error) => {
    console.warn('[R2_STRAIGHT_MAP_DELETE_FAILED]', mapId, error);
  });
};

export const removeStraightMapSource = (sourcePath: string) => {
  const sourceRoot = path.resolve(straightMapStorageRoot, 'sources');
  const target = path.resolve(sourcePath);
  if (!target.startsWith(sourceRoot + path.sep) || !/^[a-f0-9]{64}\.xlsx$/i.test(path.basename(target))) return;
  fs.rmSync(target, { force: true });
};
