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
const materialView = fs.readFileSync(path.join(root, 'src/components/material/MaterialView.tsx'), 'utf8');
const fieldStockTable = materialView.slice(materialView.indexOf('const FieldStockTable'), materialView.indexOf('const StationStockTable'));

assert.match(detail, /loading="lazy"/);
assert.match(detail, /photo\.thumbnailUrl \|\| photo\.url/);
assert.match(detail, /aspect-video/);
assert.match(api, /variant: 'master' \| 'thumbnail'/);
assert.match(mapper, /thumbnailUrl:/);
assert.match(navigation, /materialManagementEnabled/);
assert.match(context, /materialManagementEnabled && \['\/materials', '\/material-management'\]/);
assert.match(cellGallery, /loading="lazy"/);
assert.match(cellGallery, /selectedPhoto\.masterUrl \|\| selectedPhoto\.url/);
assert.doesNotMatch(materialView, /capture="environment"/);
assert.match(materialView, /갤러리에서 사진 선택/);
assert.match(materialView, /whitespace-nowrap[^>]*>[\s\S]*?추가 등록/);
assert.match(materialView, /불량품 회수등록/);
assert.match(materialView, /badFieldStockTypes/);
assert.doesNotMatch(materialView, /\{row\.transactionNumber\}/);
assert.match(materialView, /value=\{String\(filteredStationCount\)\}/);
assert.match(materialView, /\{stationOptions\.map\(\(item\)=>/);
assert.doesNotMatch(materialView, /new Set\(stationRows\.map\(\(row\) => row\.stationId\)\)\.size/);
assert.match(materialView, /aria-label="현장 자재 품명"/);
assert.match(materialView, /새 품명 직접 입력/);
assert.doesNotMatch(materialView, /field-material-category-options/);
assert.doesNotMatch(fieldStockTable, /제조사|row\.manufacturer/);
assert.match(fieldStockTable, /colSpan=\{6\}/);

console.log('Photo UI test passed: gallery selection, material recovery controls, field category selection, field stock columns, responsive actions, station filter counts, hidden station transaction number, lazy thumbnails, and frontend dark launch');
