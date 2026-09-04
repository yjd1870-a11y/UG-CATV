import assert from 'node:assert/strict';
import {
  branchFromCustomerAddress,
  criticalOcrFieldsNeedReview,
  HNS_BRANCHES,
  normalizeHnsBranchName,
  parseAndValidateOcrText,
} from '../../src/features/transfers/browser-ocr/validation';

assert.deepEqual(HNS_BRANCHES, ['HNS평택지점', 'HNS화성지점', 'HNS수원지점', 'HNS용인지점']);
for (const branch of HNS_BRANCHES) {
  assert.equal(normalizeHnsBranchName(branch), branch);
  assert.equal(normalizeHnsBranchName(branch.replace('HNS', 'h n s ').replace('지점', ' 지점')), branch);
}
assert.equal(normalizeHnsBranchName('HNS수원동부지점'), 'HNS수원지점');
assert.equal(normalizeHnsBranchName('HNS수원서부지점'), 'HNS수원지점');
assert.equal(normalizeHnsBranchName('HNS용인남부지점'), 'HNS용인지점');
assert.equal(normalizeHnsBranchName('HNS용인북부지점'), 'HNS용인지점');
assert.equal(normalizeHnsBranchName('임의지점'), '');

for (const [address, expected] of [
  ['경기 용인시 처인구 고진로59번길 16-1', 'HNS용인지점'],
  ['경기도수원시장안구 송정로76번길 58', 'HNS수원지점'],
  ['화성시 동탄대로 12', 'HNS화성지점'],
  ['경기 오산시 성호대로 10', 'HNS화성지점'],
  ['평 택 시 장안웃길 23', 'HNS평택지점'],
  ['경기 안성시 중앙로 1', 'HNS평택지점'],
] as const) assert.equal(branchFromCustomerAddress(address), expected);

const fields = parseAndValidateOcrText(`
지점: H N S 수원 지점
점검요청일: 2026-09-01
고객주소: 경기 수원시 장안구 송정로76번길 58(정자동) [정자동,68-25]
이관사유: 기타
`);
assert.deepEqual(Object.keys(fields).sort(), ['branchName', 'customerAddress']);
assert.equal(fields.branchName.value, 'HNS수원지점');
assert.equal(fields.customerAddress.value, '경기 수원시 장안구 송정로76번길 58(정자동) [정자동,68-25]');
assert.equal(fields.customerAddress.validationStatus, 'valid');
assert.equal(criticalOcrFieldsNeedReview(fields), false);

const addressWins = parseAndValidateOcrText(`
[지점 영역 재검사]
HNS수원지점
[주소 후보 B 영역 재검사]
경기 용인시 처인구 고진로59번길 16-1 (고림동) [고림동,770-26]
`);
assert.equal(addressWins.branchName.value, 'HNS용인지점');
assert.match(addressWins.branchName.warnings.join(' '), /고객주소 기준/);
assert.deepEqual(addressWins.branchName.alternatives, ['HNS수원지점']);

const ocrFallback = parseAndValidateOcrText(`
[지점 영역 재검사]
HNS화성지점
[주소 후보 B 영역 재검사]
서울 강남구 테헤란로 1
`);
assert.equal(ocrFallback.branchName.value, 'HNS화성지점');
assert.equal(ocrFallback.branchName.validationStatus, 'warning');
assert.match(ocrFallback.branchName.warnings.join(' '), /임시 적용/);
assert.equal(criticalOcrFieldsNeedReview(ocrFallback), true);

const noBracket = parseAndValidateOcrText(`
고객주소
경기도 평택시 장안웃길 23 (장안동)
이관사유
신호점검
`);
assert.equal(noBracket.branchName.value, 'HNS평택지점');
assert.equal(noBracket.customerAddress.validationStatus, 'warning');
assert.match(noBracket.customerAddress.warnings.join(' '), /대괄호/);

const wrapped = parseAndValidateOcrText(`
고객 주 소
경 기 도 수 원 시 팔달구 중부대로 165
(우만동, 동수원병원) [우만동, 157 - 7]
이관 사유
신호점검
`);
assert.equal(wrapped.branchName.value, 'HNS수원지점');
assert.equal(wrapped.customerAddress.value, '경기도 수원시 팔달구 중부대로 165 (우만동, 동수원병원) [우만동, 157-7]');
assert.doesNotMatch(wrapped.customerAddress.value, /이관|신호점검/);

const noFields = parseAndValidateOcrText('점검요청일: 2026-08-25');
assert.equal(noFields.branchName.value, '');
assert.equal(noFields.customerAddress.value, '');

console.log('Browser OCR validation test passed: two OCR fields, four current branches, address-first mapping and safe fallbacks');
