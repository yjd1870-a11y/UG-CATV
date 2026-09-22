import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { projectRoot } from '../backend/env';

// 업무이관/일일업무는 2026-09-21 운영 배포 기준, DB/CELL 작업이력은 승인된 사진정책 변경 기준입니다.
// 변경 승인을 받기 전에는 이 목록이나 해시를 갱신하지 않습니다.
const protectedFiles: Record<string, string> = {
  'backend/db.ts': '5fd75170b8dfb240d2f61469385d944afd253dad',
  'backend/routes/cells.ts': '43cbfaaa136ac4ebbaeb4340b54c632e7216857f',
  'backend/routes/work-transfers.ts': '0c759f5f89f6c8cd4a6dd72189561830f5e4745f',
  'backend/routes/daily-work.ts': 'f65a22ebc2a030c9776b083161e05e8b7090c9de',
  'backend/daily-work-service.ts': 'db326b179cc04e7c2d1dc5e3e6f79512003e9149',
  'backend/work-transfer-photo-purge.ts': '842e9c2cc77d6950f0dd96ebafe7a1d6a712f945',
  'backend/mappers.ts': '99f9ad208c1477fe355b2b7e3ced817e7932c1b7',
  'backend/catv-store.ts': '9fb9a01e38c2d26d55902e6c79f1727ad24d299c',
  'backend/catv.ts': '62ae96a0c61646a0e1f980899746d8c703735a61',
  'backend/work-transfer-policy.ts': 'bc3263ae21fd842c9ef8784f19398cf19e5b62d7',
  'src/features/cells/api.ts': '12ce3d82750b9249cc61d7d39cd14758dad70e67',
  'src/features/transfers/api.ts': 'a93b0c7a023944203828d67f7eacfaaad91c2662',
  'src/features/daily-work/api.ts': '293ff7aeebe598616c241a055234b83a762fd970',
  'src/components/cell/CatvCellDetail.tsx': '56c9b69df25bb8498c16aa62d6f380e76a3dfc35',
  'src/components/cell/CatvCellHistorySection.tsx': '8f366e00915bc271a0de2704286c25a6f5215190',
  'src/components/cell/CellDetail.tsx': 'd87f76758fe8d428b825934d336926ea31629006',
  'src/components/cell/CellHistorySection.tsx': '6ef366466f73ac4751657b77878bee602a29f2e5',
  'src/components/cell/CellList.tsx': '3ad3e0a7d270f86d004d16d8dab96aeecc5e2c39',
  'src/components/cell/PhotoGalleryModal.tsx': '4c01f0e4f09d8c21fe386306d95a906a949fea5b',
  'src/components/daily/DailyWorkView.tsx': 'e4d3e046f3552d3cec1d1bf746ed42f2126ae1da',
  'src/components/transfer/TransferAnalytics.tsx': 'e82ab597e823309eff751c5e989fc6edd018f97a',
  'src/components/transfer/TransferDetail.tsx': 'ee93ca86ab038b41fa1cd15743a4857bff6e35a9',
  'src/components/transfer/TransferList.tsx': '7f6c67e7744b18efbbbea0efc0111481b1e104ea',
  'src/components/transfer/TransferPhotoViewer.tsx': '2918944fcdf269dbce5cec1a4f064d4e5ec3f514',
};

const gitBlobHash = (filePath: string) => {
  const normalized = fs.readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n');
  const contents = Buffer.from(normalized, 'utf8');
  return createHash('sha1')
    .update(Buffer.from(`blob ${contents.length}\0`, 'utf8'))
    .update(contents)
    .digest('hex');
};

const changed = Object.entries(protectedFiles).flatMap(([relativePath, expected]) => {
  const absolutePath = path.join(projectRoot, relativePath);
  if (!fs.existsSync(absolutePath)) return [`${relativePath}: 파일 없음`];
  const actual = gitBlobHash(absolutePath);
  return actual === expected ? [] : [`${relativePath}: ${expected} -> ${actual}`];
});

if (changed.length) {
  throw new Error(
    `보호된 운영 기능 또는 DB 파일이 변경되었습니다. 별도 승인 없이는 배포할 수 없습니다.\n${changed.join('\n')}`,
  );
}

console.log(`Protected release scope verified: ${Object.keys(protectedFiles).length} files unchanged.`);
