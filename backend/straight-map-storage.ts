import fs from 'node:fs';
import path from 'node:path';
import { env } from './env';
import { deleteR2Prefix, signedR2DownloadUrl, usesR2Storage } from './object-storage';

// Legacy local artifacts remain readable during rollout. V2 artifacts are
// uploaded directly by the Windows Agent to immutable R2 prefixes.
export const straightMapStorageRoot = path.join(env.privateStoragePath, 'straight-maps');

export const resolveLocalStraightMapObject = (key: string) => {
  const source = /^line-diagrams\/sources\/([a-f0-9]{64})\.xlsx$/i.exec(key);
  if (source) return path.join(straightMapStorageRoot, 'sources', `${source[1].toLowerCase()}.xlsx`);
  const artifact = /^line-diagrams\/artifacts\/([a-f0-9-]{36})\/(.+)$/iu.exec(key);
  if (!artifact || artifact[2].split('/').some((part) => !part || part === '.' || part === '..' || /[\\:]/.test(part))) {
    throw new Error('유효하지 않은 로컬 직선도 객체 경로입니다.');
  }
  const root = path.resolve(straightMapStorageRoot, 'artifacts', artifact[1]);
  const target = path.resolve(root, ...artifact[2].split('/'));
  if (!target.startsWith(root + path.sep)) throw new Error('유효하지 않은 로컬 직선도 객체 경로입니다.');
  return target;
};

export const resolveStraightMapArtifactTile = (artifactSetId: string, level: number, tileName: string) => {
  if (!/^[a-f0-9-]{36}$/i.test(artifactSetId) || !Number.isSafeInteger(level) || level < 0 || !/^\d+_\d+\.webp$/.test(tileName)) {
    throw new Error('유효하지 않은 직선도 artifact 타일 경로입니다.');
  }
  return resolveLocalStraightMapObject(`line-diagrams/artifacts/${artifactSetId}/tiles/${level}/${tileName}`);
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

export const resolveStraightMapTile = (mapId: string, version: number, level: number, tileName: string) => {
  if (!Number.isSafeInteger(level) || level < 0 || !/^\d+_\d+\.webp$/.test(tileName)) throw new Error('유효하지 않은 직선도 타일 경로입니다.');
  const root = straightMapVersionRoot(mapId, version);
  const target = path.resolve(root, 'tiles', String(level), tileName);
  if (!target.startsWith(root + path.sep)) throw new Error('유효하지 않은 직선도 타일 경로입니다.');
  return target;
};

const signedTileCache = new Map<string, { url: string; expiresAt: number }>();

export const signedStraightMapTileUrl = async (
  mapId: string,
  version: number,
  level: number,
  tileName: string,
  artifactSetId?: string | null,
) => {
  resolveStraightMapTile(mapId, version, level, tileName);
  const key = artifactSetId
    ? `line-diagrams/artifacts/${artifactSetId}/tiles/${level}/${tileName}`
    : `line-diagrams/${mapId}/${version}/tiles/${level}/${tileName}`;
  const now = Date.now();
  const cached = signedTileCache.get(key);
  if (cached && cached.expiresAt > now + 15_000) return cached.url;
  const url = await signedR2DownloadUrl(key);
  signedTileCache.set(key, { url, expiresAt: now + Math.max(30, env.r2SignedUrlTtlSeconds - 15) * 1000 });
  if (signedTileCache.size > 1000) {
    for (const [cacheKey, value] of signedTileCache) {
      if (value.expiresAt <= now || signedTileCache.size > 900) signedTileCache.delete(cacheKey);
    }
  }
  return url;
};
