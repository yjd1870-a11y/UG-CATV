import assert from 'node:assert/strict';
import { buildB2CSearchValue, normalizeB2CSearchText } from '../b2c-search';
import { parseB2CLineBookMatrix } from '../../src/utils/b2c-workbook';

const matrix: unknown[][] = [
  [],
  [],
  ['국사', '랙번호', 'FDF번호', '노드명', '노드번호', '규격', '유니트', '코어', '자산구분', '사용여부', '주/예비코어여부', '서비스회선번호', '서비스회선명', '서비스구분', '서비스타입', '비고'],
  ['송탄', '', '', '고덕신도시향 432C', '', '', '', 208, '', '', '', ' 123 45 ', '고덕 여염6길112', 'B2C', 'RN', 'TB23M RN1:2'],
  ['송탄', '', '', '검색값 없는 행', '', '', '', 209],
];

const records = parseB2CLineBookMatrix('선번장(송탄)', matrix);
assert.equal(records.length, 1);
assert.deepEqual(parseB2CLineBookMatrix('고덕신도시향432c', matrix), []);
assert.deepEqual(records[0], {
  node: '고덕신도시향 432C',
  core: '208',
  serviceLineNumber: '123 45',
  serviceName: '고덕 여염6길112',
  b2cName: '고덕 여염6길112',
  serviceCategory: 'B2C',
  serviceType: 'RN',
  memo: 'TB23M RN1:2',
  searchValues: ['123 45', '고덕 여염6길112', 'B2C', 'RN', 'TB23M RN1:2'],
  sheetName: '선번장(송탄)',
  rowNumber: 4,
});

assert.equal(normalizeB2CSearchText(' 고덕 여염6길 '), '고덕여염6길');
assert.equal(buildB2CSearchValue(records[0].searchValues), '12345\u001f고덕여염6길112\u001fb2c\u001frn\u001ftb23mrn1:2');
assert.equal(normalizeB2CSearchText('평택 시'), '평택시');
assert.ok(buildB2CSearchValue(records[0].searchValues).includes(normalizeB2CSearchText('고덕')));

console.log('B2C linebook test passed: D/H/L:P mapping and CELL-style partial matching verified.');
