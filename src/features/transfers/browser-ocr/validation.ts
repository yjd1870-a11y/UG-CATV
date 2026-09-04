import type { OcrFieldName, OcrFieldResult, OcrValidationStatus } from './types';

export const HNS_BRANCHES = [
  'HNS평택지점', 'HNS화성지점', 'HNS수원지점', 'HNS용인지점',
] as const;

export const HNS_BRANCH_REGION_HINTS: Record<(typeof HNS_BRANCHES)[number], string[]> = {
  HNS평택지점: ['평택안성', '평택', '안성'], HNS화성지점: ['오산화성', '화성', '오산'],
  HNS수원지점: ['수원'], HNS용인지점: ['용인'],
};

const OCR_SECTION = /^\[(지점|주소 후보 [A-C]) 영역 재검사\]$/;
const FIELD_LABEL = /^(?:지점|점검\s*요청일|고객\s*주\s*소|이관\s*사유|매체\s*구분|TAP\s*\/\s*RN|점검\s*작업업체|서비스\s*(?:관리번호|기술방식))\s*[:：]?\s*/i;
const ADDRESS_END_LABEL = /^(?:이관\s*사유|매체\s*구분|TAP\s*\/\s*RN|점검\s*작업업체|서비스\s*(?:관리번호|기술방식))\s*[:：]?/i;
const ADDRESS_CONTAMINATION = /(?:이관\s*사유|매체\s*구분|C\s*A\s*B\s*L\s*E|신호\s*점검|기타(?:\s|$)|TAP\s*\/\s*RN)/i;

const EMPTY_FIELD = (): OcrFieldResult => ({
  raw: '', value: '', confidence: 0, validationStatus: 'invalid',
  warnings: ['인식된 값이 없습니다.'], alternatives: [],
});

const valueResult = (
  raw: string, value: string, confidence: number, validationStatus: OcrValidationStatus,
  warnings: string[] = [], alternatives: string[] = [],
): OcrFieldResult => ({ raw, value, confidence, validationStatus, warnings, alternatives });

const cleanValue = (value: string) => value
  .replace(/^[|:：\-–—\s]+/, '').replace(/[|\s]+$/, '').replace(/[ \t]+/g, ' ').trim();
const compactText = (value: string) => value.toUpperCase().replace(/[^A-Z0-9가-힣]/g, '');
const LEGACY_BRANCH_ALIASES: Record<string, (typeof HNS_BRANCHES)[number]> = {
  HNS수원동부지점: 'HNS수원지점', HNS수원서부지점: 'HNS수원지점',
  HNS용인남부지점: 'HNS용인지점', HNS용인북부지점: 'HNS용인지점',
};

const editDistance = (left: string, right: string) => {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      current[rightIndex] = Math.min(
        current[rightIndex - 1] + 1,
        previous[rightIndex] + 1,
        previous[rightIndex - 1] + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
      );
    }
    previous.splice(0, previous.length, ...current);
  }
  return previous[right.length];
};

const branchMatch = (text: string) => {
  const source = compactText(text).replace(/^지점/, '');
  const legacy = Object.entries(LEGACY_BRANCH_ALIASES).find(([name]) => source.includes(name));
  if (legacy) return { value: legacy[1], fuzzy: false, legacy: true, alternatives: [] as string[] };
  const exact = HNS_BRANCHES.find((branch) => {
    const official = compactText(branch);
    return source.includes(official) || source.includes(official.replace(/^HNS/, ''));
  });
  if (exact) return { value: exact, fuzzy: false, legacy: false, alternatives: [] as string[] };

  const branchLike = source.match(/(?:HNS)?(?:평택|화성|수원|용인)(?:동부|서부|남부|북부)?지[점정검]/)?.[0] || source;
  const candidates = HNS_BRANCHES.map((branch) => ({
    branch,
    distance: Math.min(editDistance(branchLike, compactText(branch)), editDistance(branchLike, compactText(branch).replace(/^HNS/, ''))),
  })).filter(({ distance }) => distance <= 1);
  const minimum = Math.min(...candidates.map(({ distance }) => distance));
  const closest = candidates.filter(({ distance }) => distance === minimum).map(({ branch }) => branch);
  return closest.length === 1
    ? { value: closest[0], fuzzy: true, legacy: false, alternatives: [] as string[] }
    : { value: '', fuzzy: false, legacy: false, alternatives: closest };
};

export const normalizeHnsBranchName = (text: string) => branchMatch(text).value;

const sectionMap = (text: string) => {
  const sections = new Map<string, string[]>();
  let current = '전체';
  sections.set(current, []);
  for (const rawLine of text.replace(/\r/g, '').split('\n')) {
    const line = rawLine.trim();
    const marker = line.match(OCR_SECTION);
    if (marker) {
      current = marker[1];
      sections.set(current, []);
    } else if (line) sections.get(current)?.push(line);
  }
  return sections;
};

const labelledSingleValue = (lines: string[], label: RegExp) => {
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(label);
    if (!match) continue;
    const inline = cleanValue(match[1] || '');
    if (inline) return inline;
    const next = lines[index + 1];
    if (next && !FIELD_LABEL.test(next)) return cleanValue(next);
  }
  return '';
};

const branchField = (sections: Map<string, string[]>): OcrFieldResult => {
  const fullLines = sections.get('전체') || [];
  const focused = (sections.get('지점') || []).join(' ');
  const labelled = labelledSingleValue(fullLines, /^지점\s*[:：]?\s*(.*)$/i);
  const branchLine = fullLines.find((line) => /H\s*N\s*S|(?:평택|화성|수원|용인).{0,5}지[점정검]/i.test(line)) || '';
  const raw = focused || labelled || branchLine;
  if (!raw) return EMPTY_FIELD();
  const match = branchMatch(raw);
  if (!match.value) return valueResult(raw, '', 0.2, 'invalid', ['공식 HNS 지점명을 확인해 주세요.'], match.alternatives);
  return valueResult(
    raw, match.value, match.fuzzy ? 0.86 : 0.98, 'valid',
    match.legacy
      ? ['과거 지점명을 현재 HNS 지점명으로 통합했습니다.']
      : match.fuzzy ? ['지점명 한 글자 OCR 오류를 공식 목록과 대조해 보정했습니다.'] : [],
  );
};

const extractBoundedAddress = (lines: string[]) => {
  const start = lines.findIndex((line) => /^고객\s*주\s*소\s*[:：]?/i.test(line));
  if (start < 0) return '';
  const values: string[] = [];
  const inline = cleanValue(lines[start].replace(/^고객\s*주\s*소\s*[:：]?\s*/i, ''));
  if (inline) values.push(inline);
  for (let index = start + 1; index < lines.length; index += 1) {
    if (ADDRESS_END_LABEL.test(lines[index]) || FIELD_LABEL.test(lines[index])) break;
    values.push(cleanValue(lines[index]));
  }
  return values.filter(Boolean).join(' ');
};

const stripAddressContamination = (raw: string) => cleanValue(raw)
  .replace(/^고객\s*주\s*소\s*[:：]?\s*/i, '')
  .split(/\s+(?=이관\s*사유|매체\s*구분|C\s*A\s*B\s*L\s*E|신호\s*점검|기타(?:\s|$)|TAP\s*\/\s*RN)/i)[0]
  .replace(/\s+[A-Za-z]{2,8}[\]\\:;,.]*$/, '');

const reconcileLotLocality = (value: string) => {
  const lot = value.match(/\[([가-힣]{1,10}(?:동|리))\s*,?\s*\d/);
  if (!lot) return value;
  const parenthetical = value.match(/\(([^)]*)\)/)?.[1] || '';
  const candidates: string[] = parenthetical.match(/[가-힣]{1,10}(?:동|리)/g) ?? [];
  const closest = candidates.find((candidate: string) => (
    candidate[candidate.length - 1] === lot[1][lot[1].length - 1] && editDistance(candidate, lot[1]) <= 1
  ));
  return closest ? value.replace(`[${lot[1]}`, `[${closest}`) : value;
};

const normalizeAddressText = (raw: string) => {
  const normalized = stripAddressContamination(raw)
    .replace(/\s*\n\s*/g, ' ').replace(/[ \t]+/g, ' ')
    .trim()
    .replace(/^.*?(?=경\s*기(?:\s*도)?\s)/, '')
    .replace(/^경\s*기(?:\s*도)?(?=\s*[^\s])/i, (value) => value.replace(/\s/g, '') === '경기도' ? '경기도 ' : '경기 ')
    .replace(/(용\s*인|수\s*원|화\s*성|오\s*산|평\s*택|안\s*성)\s*시/g, (value) => value.replace(/\s/g, ''))
    .replace(/^(?:[가-힣?·.]{1,4}\s+)?(수지구|기흥구|처인구)(?=\s)/, '경기 용인시 $1')
    .replace(/^(?:[가-힣?·.]{1,4}\s+)?(장안구|팔달구|권선구|영통구)(?=\s)/, '경기 수원시 $1')
    .replace(/^(?:[가-힣?·.]{1,4}\s+)?(평택시)(?=\s)/, '경기 $1')
    .replace(/(\d+)\s*번\s*길/g, '$1번길')
    .replace(/([가-힣]+(?:대로|로))\s+(\d+번길)/g, '$1$2')
    .replace(/(\d)\s*-\s*(\d)/g, '$1-$2')
    .replace(/\[([가-힣]{1,12})(\d+(?:-\d+)?)\]/g, '[$1,$2]')
    .replace(/\s*[\[(]\s*,\s*\d+(?:-\d+)?\s*[\])]/g, '')
    .replace(/\s+([)\]])/g, '$1').replace(/([(\[])\s+/g, '$1')
    .replace(/[ \t]+/g, ' ').trim();
  const closingBracket = normalized.lastIndexOf(']');
  const bounded = closingBracket >= 0 ? normalized.slice(0, closingBracket + 1) : normalized;
  return reconcileLotLocality(bounded);
};

export const branchFromCustomerAddress = (address: string): (typeof HNS_BRANCHES)[number] | '' => {
  const compact = address.replace(/\s/g, '');
  if (compact.includes('용인시')) return 'HNS용인지점';
  if (compact.includes('수원시')) return 'HNS수원지점';
  if (compact.includes('화성시') || compact.includes('오산시')) return 'HNS화성지점';
  if (compact.includes('평택시') || compact.includes('안성시')) return 'HNS평택지점';
  return '';
};

const delimiterBalanced = (value: string) => (
  (value.match(/\(/g) || []).length === (value.match(/\)/g) || []).length
  && (value.match(/\[/g) || []).length === (value.match(/\]/g) || []).length
);

const addressParts = (value: string) => {
  const road = value.match(/([가-힣A-Za-z0-9·.]+(?:대로|로|번길|길))\s*(\d+(?:-\d+)?)/);
  const lot = value.match(/\[([가-힣]{1,12}\s*,\s*\d+(?:-\d+)?)\s*\]/)?.[1] || '';
  return { road: road?.[1] || '', building: road?.[2] || '', lot };
};

export const addressCandidateScore = (raw: string) => {
  const value = normalizeAddressText(raw);
  if (!value) return -1_000;
  const parts = addressParts(value);
  let score = Math.min(value.length, 80);
  if (/^(?:경기(?:도)?|서울|인천|강원|충[북남]|전[북남]|경[북남]|제주|세종)/.test(value)) score += 20;
  if (/(?:시|군)\s+.*(?:구|읍|면|동)(?:\s|$)/.test(value)) score += 12;
  if (parts.road) score += 18;
  if (parts.building) score += 18;
  if (delimiterBalanced(value)) score += 10; else score -= 25;
  if (ADDRESS_CONTAMINATION.test(value)) score -= 50;
  return score;
};

const addressField = (sections: Map<string, string[]>): OcrFieldResult => {
  const rawFocusedCandidates = ['주소 후보 A', '주소 후보 B', '주소 후보 C']
    .map((name) => (sections.get(name) || []).join(' ')).filter(Boolean);
  const hadContamination = rawFocusedCandidates.some((candidate) => ADDRESS_CONTAMINATION.test(candidate));
  const candidates = rawFocusedCandidates.map(normalizeAddressText).filter(Boolean);
  const boundedRaw = extractBoundedAddress(sections.get('전체') || []);
  const bounded = normalizeAddressText(boundedRaw);
  if (bounded) candidates.push(bounded);
  const unique = [...new Set(candidates)];
  if (unique.length === 0) return EMPTY_FIELD();
  const counts = new Map(unique.map((candidate) => [candidate, candidates.filter((item) => item === candidate).length]));
  const ranked = [...unique].sort((left, right) => (
    (counts.get(right) || 0) - (counts.get(left) || 0) || addressCandidateScore(right) - addressCandidateScore(left)
  ));
  const value = ranked[0];
  const parts = addressParts(value);
  const competingSignatures = new Set(ranked.slice(0, 3).map((candidate) => {
    const candidateParts = addressParts(candidate);
    return candidateParts.road && candidateParts.building && candidateParts.lot
      ? `${candidateParts.road}|${candidateParts.building}|${candidateParts.lot}`
      : '';
  }).filter(Boolean));
  const warnings: string[] = [];
  if (!/^경기(?:도)?\s/.test(value)) warnings.push('주소가 경기 또는 경기도로 시작하는지 확인해 주세요.');
  if (!/\]$/.test(value)) warnings.push('주소가 지번 대괄호(])로 끝나는지 확인해 주세요.');
  if (value.length < 12) warnings.push('주소가 너무 짧습니다.');
  if (!parts.road) warnings.push('도로명을 확인해 주세요.');
  if (!parts.building) warnings.push('건물번호를 확인해 주세요.');
  if (!parts.lot) warnings.push('마지막 지번을 [한글 동·리, 숫자] 형식으로 확인해 주세요.');
  if (!delimiterBalanced(value)) warnings.push('주소의 괄호 또는 대괄호가 완전하지 않습니다.');
  if (/\s+[A-Za-z]{2,8}[\]\\:;,.]*$/.test(value)) warnings.push('주소 끝에 영문 OCR 잡음이 포함되어 있습니다.');
  if (hadContamination || ADDRESS_CONTAMINATION.test(value)) warnings.push('다음 업무 항목이 주소 영역에 섞여 있어 확인이 필요합니다.');
  if (competingSignatures.size > 1) warnings.push('OCR 후보마다 도로명·건물번호 또는 지번이 달라 확인이 필요합니다.');
  const valid = warnings.length === 0;
  return valueResult(
    candidates.join('\n'), value, valid ? ((counts.get(value) || 0) >= 2 ? 0.95 : 0.88) : 0.58,
    valid ? 'valid' : 'warning', warnings, ranked.slice(1, 4),
  );
};

export const parseAndValidateOcrText = (text: string): Record<OcrFieldName, OcrFieldResult> => {
  const sections = sectionMap(text);
  let branchName = branchField(sections);
  const customerAddress = addressField(sections);
  const addressBranch = branchFromCustomerAddress(customerAddress.value);
  if (addressBranch) {
    const ocrBranch = branchName.value;
    branchName = valueResult(
      branchName.raw, addressBranch, customerAddress.validationStatus === 'valid' ? 0.99 : 0.92, 'valid',
      ocrBranch && ocrBranch !== addressBranch
        ? [`문서의 지점명과 고객주소가 달라 고객주소 기준으로 ${addressBranch}을 적용했습니다.`]
        : ['고객주소의 시·군을 기준으로 최종 지점을 적용했습니다.'],
      ocrBranch && ocrBranch !== addressBranch ? [ocrBranch] : [],
    );
  } else if (branchName.value) {
    branchName = valueResult(
      branchName.raw, branchName.value, branchName.confidence, 'warning',
      [...branchName.warnings, '고객주소에서 관할 시·군을 확인하지 못해 OCR 지점명을 임시 적용했습니다. 지점을 확인해 주세요.'],
      branchName.alternatives,
    );
  }
  return {
    branchName, customerAddress,
  };
};

export const criticalOcrFieldsNeedReview = (fields: Record<OcrFieldName, OcrFieldResult>) => (
  fields.branchName.validationStatus !== 'valid'
  || fields.customerAddress.validationStatus !== 'valid'
);
