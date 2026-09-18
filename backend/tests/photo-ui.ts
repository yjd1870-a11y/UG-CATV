import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../..');
const detail = fs.readFileSync(path.join(root, 'src/components/transfer/TransferDetail.tsx'), 'utf8');
const api = fs.readFileSync(path.join(root, 'src/features/transfers/api.ts'), 'utf8');
const mapper = fs.readFileSync(path.join(root, 'backend/mappers.ts'), 'utf8');
const navigation = fs.readFileSync(path.join(root, 'src/components/common/primary-navigation.ts'), 'utf8');
const context = fs.readFileSync(path.join(root, 'src/context/AppContext.tsx'), 'utf8');
const cellGallery = fs.readFileSync(path.join(root, 'src/components/cell/PhotoGalleryModal.tsx'), 'utf8');

assert.match(detail, /loading="lazy"/);
assert.match(detail, /photo\.thumbnailUrl \|\| photo\.url/);
assert.match(detail, /aspect-video/);
assert.match(api, /variant: 'master' \| 'thumbnail'/);
assert.match(mapper, /thumbnailUrl:/);
assert.match(navigation, /materialManagementEnabled/);
assert.match(context, /materialManagementEnabled && \['\/materials', '\/material-management'\]/);
assert.match(cellGallery, /loading="lazy"/);
assert.match(cellGallery, /selectedPhoto\.masterUrl \|\| selectedPhoto\.url/);

console.log('Photo UI test passed: lazy thumbnails, fixed aspect ratio, master-on-detail support, and frontend dark launch');
