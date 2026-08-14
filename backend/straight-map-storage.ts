import fs from 'node:fs';
import path from 'node:path';
import { env } from './env';
import { deleteR2Prefix, putR2Object, readR2Object, usesR2Storage } from './object-storage';

// Render work files belong on the configured private storage root. In
// production this is the persistent disk; completed artifacts are also copied
// to R2 by publishStraightMapArtifacts.
export const straightMapStorageRoot = path.join(env.privateStoragePath, 'straight-maps');

export const straightMapVersionRoot = (mapId: string, version: number) => {
  if (!/^[a-z0-9-]+$/i.test(mapId) || !Number.isSafeInteger(version) || version < 1) throw new Error('유효하지 않은 직선도 저장 경로입니다.');
  const root = path.resolve(straightMapStorageRoot);
  const target = path.resolve(root, mapId, String(version));
  if (!target.startsWith(root + path.sep)) throw new Error('유효하지 않은 직선도 저장 경로입니다.');
  return target;
};

export const saveStraightMapSource = (mapId: string, version: number, source: Buffer) => {
  const root = straightMapVersionRoot(mapId, version);
  const directory = path.join(root, 'original');
  fs.mkdirSync(directory, { recursive: true });
  const filePath = path.join(directory, 'source.xlsx');
  fs.writeFileSync(filePath, source);
  return filePath;
};

export const saveStraightMapSharedSource = (sourceHash: string, source: Buffer) => {
  if (!/^[a-f0-9]{64}$/i.test(sourceHash)) throw new Error('유효하지 않은 직선도 원본 해시입니다.');
  const directory = path.resolve(straightMapStorageRoot, 'sources');
  const root = path.resolve(straightMapStorageRoot);
  if (!directory.startsWith(root + path.sep)) throw new Error('유효하지 않은 직선도 원본 경로입니다.');
  fs.mkdirSync(directory, { recursive: true });
  const filePath = path.join(directory, `${sourceHash}.xlsx`);
  if (!fs.existsSync(filePath)) fs.writeFileSync(filePath, source);
  return filePath;
};

const linkDirectory = (source: string, target: string) => {
  fs.mkdirSync(target, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const sourceEntry = path.join(source, entry.name);
    const targetEntry = path.join(target, entry.name);
    if (entry.isDirectory()) {
      linkDirectory(sourceEntry, targetEntry);
      continue;
    }
    try { fs.linkSync(sourceEntry, targetEntry); }
    catch { fs.copyFileSync(sourceEntry, targetEntry); }
  }
};

export const cloneStraightMapVersion = (mapId: string, sourceVersion: number, targetVersion: number) => {
  const source = straightMapVersionRoot(mapId, sourceVersion);
  const target = straightMapVersionRoot(mapId, targetVersion);
  if (!fs.existsSync(source)) throw new Error('재사용할 직선도 타일을 찾을 수 없습니다.');
  fs.rmSync(target, { recursive: true, force: true });
  linkDirectory(source, target);
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

const filesBelow = (directory: string): string[] => fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
  const target = path.join(directory, entry.name);
  return entry.isDirectory() ? filesBelow(target) : [target];
});

export const publishStraightMapArtifacts = async (mapId: string, version: number, originalFilePath: string) => {
  if (!usesR2Storage) return;
  const root = straightMapVersionRoot(mapId, version);
  for (const filePath of filesBelow(root)) {
    const relative = path.relative(root, filePath).split(path.sep).join('/');
    const contentType = relative.endsWith('.webp') ? 'image/webp'
      : relative.endsWith('.png') ? 'image/png'
        : relative.endsWith('.xlsx') ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
          : 'application/octet-stream';
    await putR2Object(`line-diagrams/${mapId}/${version}/${relative}`, fs.readFileSync(filePath), contentType);
  }
  if (fs.existsSync(originalFilePath)) {
    await putR2Object(
      `line-diagrams/${mapId}/${version}/original/source.xlsx`,
      fs.readFileSync(originalFilePath),
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
  }
};

export const readStraightMapTile = (mapId: string, version: number, level: number, tileName: string) => {
  resolveStraightMapTile(mapId, version, level, tileName);
  return readR2Object(`line-diagrams/${mapId}/${version}/tiles/${level}/${tileName}`);
};
