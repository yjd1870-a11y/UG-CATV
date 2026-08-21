import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { strToU8, zipSync } from 'fflate';
import { sheetContentHashes } from '../../renderer-agent/src/sheet-fingerprint';

const runtimeRoot = process.env.PRIVATE_STORAGE_PATH || path.join(process.cwd(), '.tmp');
const workbook = (secondValue: string) => Buffer.from(zipSync({
  'xl/workbook.xml': strToU8('<workbook xmlns:r="r"><sheets><sheet name="A" sheetId="1" r:id="rId1"/><sheet name="B" sheetId="2" r:id="rId2"/></sheets></workbook>'),
  'xl/_rels/workbook.xml.rels': strToU8('<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Target="worksheets/sheet2.xml" Id="rId2"/></Relationships>'),
  'xl/worksheets/sheet1.xml': strToU8('<worksheet><sheetData><row><c r="A1" t="inlineStr"><is><t>unchanged</t></is></c></row></sheetData></worksheet>'),
  'xl/worksheets/sheet2.xml': strToU8(`<worksheet><sheetData><row><c r="A1" t="inlineStr"><is><t>${secondValue}</t></is></c></row></sheetData></worksheet>`),
  'xl/styles.xml': strToU8('<styleSheet/>'),
  'xl/theme/theme1.xml': strToU8('<theme/>'),
}));
const firstPath = path.join(runtimeRoot, 'first.xlsx');
const secondPath = path.join(runtimeRoot, 'second.xlsx');
fs.writeFileSync(firstPath, workbook('before'));
fs.writeFileSync(secondPath, workbook('after'));
const first = await sheetContentHashes(firstPath, ['A', 'B']);
const second = await sheetContentHashes(secondPath, ['A', 'B']);
assert.equal(first.A, second.A, 'unrelated worksheet edit must keep the cache key');
assert.notEqual(first.B, second.B, 'edited worksheet must invalidate its cache key');
assert.match(first.A, /^[a-f0-9]{64}$/);
console.log('Straight-map sheet cache test passed: unrelated sheet edits are reusable, changed sheet is invalidated.');
