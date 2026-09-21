import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const source = (relativePath: string) => fs.readFileSync(path.join(projectRoot, relativePath), 'utf8');

const operations = source('backend/modules/operations.ts');
const materialModule = source('backend/modules/material-management.ts');
const registry = source('backend/modules/registry.ts');

assert.doesNotMatch(operations, /routes\/(?:inventory|materials)/);
assert.doesNotMatch(operations, /\/api\/(?:materials|material-usage|material-management)/);
assert.match(materialModule, /\/api\/materials/);
assert.match(materialModule, /\/api\/material-usage/);
assert.match(materialModule, /\/api\/material-management/);
assert.match(registry, /materialManagementModule/);

const materialSources = [
  'backend/routes/inventory.ts',
  'backend/inventory-service.ts',
  'backend/inventory-excel.ts',
  'backend/material-photo-storage.ts',
];
const protectedTables = [
  'cells',
  'field_photos',
  'work_transfers',
  'work_transfer_attachments',
  'work_transfer_field_actions',
  'work_transfer_logs',
  'daily_work',
  'daily_work_history',
];
const protectedWrite = new RegExp(
  `\\b(?:INSERT\\s+INTO|UPDATE|DELETE\\s+FROM)\\s+(?:${protectedTables.join('|')})\\b`,
  'i',
);

for (const relativePath of materialSources) {
  assert.doesNotMatch(
    source(relativePath),
    protectedWrite,
    `${relativePath}에서 보호된 운영 테이블 쓰기가 감지되었습니다.`,
  );
}

console.log('Material module boundary test passed.');
