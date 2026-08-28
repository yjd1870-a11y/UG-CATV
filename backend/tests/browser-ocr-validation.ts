import assert from 'node:assert/strict';
import {
  criticalOcrFieldsNeedReview,
  HNS_BRANCHES,
  normalizeHnsBranchName,
  normalizeTechnicalTerms,
  parseAndValidateOcrText,
  TECHNICAL_TERMS,
} from '../../src/features/transfers/browser-ocr/validation';

for (const branch of HNS_BRANCHES) {
  assert.equal(normalizeHnsBranchName(branch), branch);
  assert.equal(normalizeHnsBranchName(branch.replace('HNS', 'H N S ').replace('지점', ' 지점')), branch);
}

const fields = parseAndValidateOcrText(`
지점: H N S 화성 지점
점검요청정보: 이창수 [010-2341-5865]
점검작업업체: (주)유지텔레컴
점검요청일: 2026.08.25
서비스관리번호: 7410089422
서비스기술방식: [TC002]Btv(CATV_QAM_HD)
고객주소: 경기 화성시 만세구 송산면 육일길 42
이관사유: 신호점검
매체구분: cable
TAP/RN 위치: tap 3번
전주번호: 12-34
인입선길이: 45m
사전조치내용: onu 7c rfog 확인
점검요청내용: 1. 측정주파수 485 mhz\n2. 상하향 레벨 3 dbmv\n3. mer / ber
`);

assert.equal(fields.branchName.value, 'HNS화성지점');
assert.equal(fields.inspectionRequestedDate.value, '2026-08-25');
assert.equal(fields.requesterName.value, '이창수 [010-2341-5865]');
assert.equal(fields.inspectionCompany.value, '유지텔레컴');
assert.equal(fields.mediaType.value, 'CABLE');
assert.equal(fields.customerAddress.validationStatus, 'valid');
assert.equal(fields.handoverReason.value, '신호점검');
assert.match(fields.tapRnLocation.value, /TAP/);
assert.match(fields.preActionNotes.value, /ONU 7C RFOG/);
assert.match(fields.inspectionRequestDetails.value, /485 MHz/);
assert.match(fields.inspectionRequestDetails.value, /3 dBmV/);
assert.match(fields.inspectionRequestDetails.value, /MER \/ BER/);
assert.equal(criticalOcrFieldsNeedReview(fields), false);

const corrected = normalizeTechnicalTerms(TECHNICAL_TERMS.map((term) => term.toLowerCase()).join(' '));
for (const term of TECHNICAL_TERMS) assert.match(corrected, new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));

const uncertain = parseAndValidateOcrText('점검요청내용: OFD L2 확인');
assert.equal(uncertain.inspectionRequestDetails.value, 'OFD L2 확인');
assert.equal(criticalOcrFieldsNeedReview(uncertain), true);

const screenPhoto = parseAndValidateOcrText(`
HNS용인북부지점
경기 용인시 수지구 상현로 88 285동 703호 [상현동,855]
1.측정주파수: 2번 78번
[사전조치 영역 재검사]
|이병일 매니저 현장 확인 / 인입 7¢ 신호 저하 / 800Mhz 이상 Mer 저하
`);
assert.equal(
  screenPhoto.preActionNotes.value,
  '이병일 매니저 현장 확인 / 인입 7C 신호 저하 / 800MHz 이상 MER 저하',
);

const fuzzyPreAction = parseAndValidateOcrText(`
사전 조치 내옹: ONU 12C 교체 / 800 Mhz 이상 Mer 저하
점검 요청 내용: BER 확인
`);
assert.equal(fuzzyPreAction.preActionNotes.value, 'ONU 12C 교체 / 800 MHz 이상 MER 저하');

const focusedRows = parseAndValidateOcrText(`
고객주소 경기 수원시 팔달구 중부대로 165
이관사유 신호점검
CABLE

[주소 영역 재검사]
고객주소 경기 수원시 팔달구 중부대로 165 (우만동,동수원병원) [우만동,157-7]
이관사유 신호점검

[사전조치 영역 재검사]
00
00
00
옥상탭 점검
1. 측정주파수: 2-69 78-55
2. 상/하향 레벨: 하향 신호 점검
3. MER: 36
`);
assert.equal(
  focusedRows.customerAddress.value,
  '경기 수원시 팔달구 중부대로 165 (우만동,동수원병원) [우만동,157-7]',
);
assert.equal(focusedRows.preActionNotes.value, '옥상탭 점검');

const noFalsePreAction = parseAndValidateOcrText('이관사유 신호점검\n매체구분 CABLE');
assert.equal(noFalsePreAction.preActionNotes.value, '');

const actualPhotoShape = parseAndValidateOcrText(`
고객주소
경기 수원시 팔달구 중부대로 165 (우만동,동수원병원) [우만동,157-7]
이관사유
신호점검

[주소 영역 재검사]
고객주소
경기 수원시 팔달구 중부대로 165 (우
마동
브이
으마동
동수원병원) [
는 기는. 시
157-7]
이관사유
신호점검

[사전조치 영역 재검사]
위치
천주번호
인입선길이
00
00
00
사전
옥상템 점검
조치내용
점검
1. 측정주파수: 2-69 78-55
요청내용
2. 상/하향 레벨: 하향 신호 점검
3. MER: 36
`);
assert.equal(
  actualPhotoShape.customerAddress.value,
  '경기 수원시 팔달구 중부대로 165 (우만동,동수원병원) [우만동,157-7]',
);
assert.equal(actualPhotoShape.preActionNotes.value, '옥상탭 점검');

const deployedPhotoShape = parseAndValidateOcrText(`
HNS평택지점
고객주소
경기 평택시 포승읍 서동대로 784 101동 905호(56친오애아파트) [만호리,646-]
이관사유
신호점검
매체구분 CABLE

[주소 영역 재검사]
경기 평택시 포승읍 서동대로 784 101동 905호(56친오애아파트) [만호리,646-1]
신호점검

[사전조치 영역 재검사]
.라인전체 하향신호불량 점검요정합니다
셋업박스 일부채널시청 불가
*축정주파수:
2 삼/하향 러빌:

[점검요청 영역 재검사]
*축정주파수:
2 삼/하향 레벨 :
`);
assert.equal(
  deployedPhotoShape.customerAddress.value,
  '경기 평택시 포승읍 서동대로 784 101동 905호(SR친오애아파트) [만호리,646-1]',
);
assert.equal(
  deployedPhotoShape.preActionNotes.value,
  '라인전체 하향신호불량 점검요청합니다\n셋업박스 일부채널시청불가',
);
assert.equal(
  deployedPhotoShape.inspectionRequestDetails.value,
  '1. 측정주파수:\n2. 상/하향 레벨:\n3. MER:',
);

console.log('Browser OCR validation test passed: HNS normalization, kor+eng terms, date and structured fields');
