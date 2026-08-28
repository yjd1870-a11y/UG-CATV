import type { OcrFieldName, OcrFieldResult, OcrValidationStatus } from './types';

export const HNS_BRANCHES = [
  'HNS평택지점', 'HNS화성지점', 'HNS수원동부지점',
  'HNS수원서부지점', 'HNS용인남부지점', 'HNS용인북부지점',
] as const;

export const HNS_BRANCH_REGION_HINTS: Record<(typeof HNS_BRANCHES)[number], string[]> = {
  HNS평택지점: ['평택'],
  HNS화성지점: ['화성', '오산화성'],
  HNS수원동부지점: ['수원동부', '수원'],
  HNS수원서부지점: ['수원서부', '수원'],
  HNS용인남부지점: ['용인남부', '용인'],
  HNS용인북부지점: ['용인북부', '용인'],
};

export const TECHNICAL_TERMS = [
  'MHz', 'dB', 'dBmV', 'MER', 'BER', 'ONU', 'TBA', 'EA', 'PS', 'UPS', 'row', 'hi',
  'RFOG', '5C', '7C', '12C', 'OFD', 'RACK', 'L2', 'TAP', 'RN', 'CABLE',
] as const;

const EMPTY_FIELD = (): OcrFieldResult => ({
  raw: '', value: '', confidence: 0, validationStatus: 'invalid',
  warnings: ['인식된 값이 없습니다.'], alternatives: [],
});

const valueResult = (
  raw: string,
  value: string,
  confidence: number,
  validationStatus: OcrValidationStatus,
  warnings: string[] = [],
): OcrFieldResult => ({ raw, value, confidence, validationStatus, warnings, alternatives: [] });

const FIELD_LABEL = /^(?:지점|점검요청정보|요청자|점검작업업체|점검요청일|서비스관리번호|서비스기술방식|고객주소|이관사유|매체구분|TAP\s*\/\s*RN\s*위치|전주번호|인입선길이|사전\s*조치\s*내[용옹]|점검\s*요청\s*내[용옹]|완료처리|작업상태)\s*[:：]?\s*/i;

const cleanValue = (value: string) => value
  .replace(/^[|:：\-–—\s]+/, '')
  .replace(/[|\s]+$/, '')
  .replace(/[ \t]+/g, ' ')
  .trim();

const labelledValue = (lines: string[], label: RegExp, multiline = false) => {
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(label);
    if (!match) continue;
    const values: string[] = [];
    const inline = cleanValue(match[1] || '');
    if (inline) values.push(inline);
    for (let cursor = index + 1; cursor < lines.length && (multiline || values.length === 0); cursor += 1) {
      if (FIELD_LABEL.test(lines[cursor])) break;
      const next = cleanValue(lines[cursor]);
      if (next) values.push(next);
      if (!multiline && values.length > 0) break;
    }
    return values.join('\n').trim();
  }
  return '';
};

export const normalizeHnsBranchName = (text: string) => {
  const compact = text.toUpperCase().replace(/[^A-Z0-9가-힣]/g, '');
  for (const branch of HNS_BRANCHES) {
    const official = branch.toUpperCase().replace(/[^A-Z0-9가-힣]/g, '');
    if (compact.includes(official) || compact.includes(official.replace(/^HNS/, ''))) return branch;
  }
  return '';
};

const termPatterns: Array<[RegExp, string | ((substring: string) => string)]> = [
  [/옥상\s*(?:팀|템|텝)\s*점검/g, '옥상탭 점검'],
  [/점검\s*요정\s*합니다/g, '점검요청합니다'],
  [/시청\s*불가/g, '시청불가'],
  [/M\s*H\s*Z\b/gi, 'MHz'], [/D\s*B\s*M\s*V\b/gi, 'dBmV'], [/D\s*B\b/gi, 'dB'],
  [/\bM\s*E\s*R\b/gi, 'MER'], [/\bB\s*E\s*R\b/gi, 'BER'], [/\bO\s*N\s*U\b/gi, 'ONU'],
  [/\bT\s*B\s*A\b/gi, 'TBA'], [/\bU\s*P\s*S\b/gi, 'UPS'], [/\bR\s*F\s*O\s*G\b/gi, 'RFOG'],
  [/\bO\s*F\s*D\b/gi, 'OFD'], [/\bR\s*A\s*C\s*K\b/gi, 'RACK'], [/\bT\s*A\s*P\b/gi, 'TAP'],
  [/\bC\s*A\s*B\s*L\s*E\b/gi, 'CABLE'],
  [/\b(?:5|7|12)\s*[¢©]/gi, (match) => match.replace(/[¢©]/, 'C').replace(/\s/g, '')],
  [/\b1\s*2\s*C\b/gi, '12C'],
  [/\b[57]\s*C\b/gi, (match) => match.replace(/\s/g, '').toUpperCase()],
  [/\bL\s*2\b/gi, 'L2'], [/\bR\s*N\b/gi, 'RN'], [/\bE\s*A\b/gi, 'EA'], [/\bP\s*S\b/gi, 'PS'],
  [/\bROW\b/gi, 'row'], [/\bHI\b/gi, 'hi'],
];

export const normalizeTechnicalTerms = (text: string) => {
  let value = text;
  for (const [pattern, replacement] of termPatterns) {
    value = typeof replacement === 'string'
      ? value.replace(pattern, replacement)
      : value.replace(pattern, replacement);
  }
  return value;
};

const normalizeDigits = (value: string) => value.replace(/[Oo]/g, '0').replace(/[Il|]/g, '1').replace(/[^0-9]/g, '');

const dateField = (text: string): OcrFieldResult => {
  const match = text.match(/(?:19|20)\d{2}[.\-/년\s]+[0-1Oo]?\d[.\-/월\s]+[0-3Oo]?\d/);
  if (!match) return EMPTY_FIELD();
  const digits = normalizeDigits(match[0]);
  if (digits.length !== 8) return valueResult(match[0], '', 0.35, 'invalid', ['날짜 형식을 확인해 주세요.']);
  const value = `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
  const [year, month, day] = [Number(digits.slice(0, 4)), Number(digits.slice(4, 6)), Number(digits.slice(6, 8))];
  const parsed = new Date(Date.UTC(year, month - 1, day));
  const valid = parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
  return valueResult(match[0], value, valid ? 0.96 : 0.4, valid ? 'valid' : 'invalid', valid ? [] : ['실제 존재하는 날짜인지 확인해 주세요.']);
};

const textField = (raw: string, options: { min?: number; fixed?: string; technical?: boolean } = {}) => {
  if (options.fixed) return valueResult(raw || options.fixed, options.fixed, 1, 'valid');
  if (!raw) return EMPTY_FIELD();
  const value = options.technical ? normalizeTechnicalTerms(cleanValue(raw)) : cleanValue(raw);
  const valid = value.length >= (options.min || 1);
  return valueResult(raw, value, valid ? 0.88 : 0.55, valid ? 'valid' : 'warning', valid ? [] : ['인식값을 확인해 주세요.']);
};

const phoneField = (text: string): OcrFieldResult => {
  const match = text.match(/(?:01[016789]|0[2-6][1-5]?)[\s).-]*\d{3,4}[\s).-]*\d{4}/);
  if (!match) return EMPTY_FIELD();
  const digits = normalizeDigits(match[0]);
  const value = digits.length === 11 ? `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}` : digits;
  return valueResult(match[0], value, digits.length >= 9 ? 0.92 : 0.45, digits.length >= 9 ? 'valid' : 'warning');
};

const serviceNumberField = (text: string, lines: string[]) => {
  const labelled = labelledValue(lines, /^(?:서비스\s*(?:관리)?\s*번호|서비스번호)\s*[:：]?\s*(.*)$/i);
  const raw = labelled || text.match(/\b\d{9,14}\b/)?.[0] || '';
  if (!raw) return EMPTY_FIELD();
  const value = normalizeDigits(raw);
  return valueResult(raw, value, value.length >= 9 ? 0.94 : 0.45, value.length >= 9 ? 'valid' : 'warning');
};

const addressCandidateScore = (raw: string) => {
  const value = cleanValue(raw);
  if (!value) return -1_000;
  let score = value.length;
  score -= (value.match(/\n/g) || []).length * 10;
  if (/^(?:서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주)\s/.test(value)) score += 20;
  if (/(?:시|군|구|동|읍|면|로|길)\b/.test(value)) score += 8;
  const balancedRound = (value.match(/\(/g) || []).length === (value.match(/\)/g) || []).length;
  const balancedSquare = (value.match(/\[/g) || []).length === (value.match(/\]/g) || []).length;
  score += balancedRound && balancedSquare ? 14 : -18;
  if (/(?:고객\s*주소|이관\s*사유|매체\s*구분|서비스\s*기술)/i.test(value)) score -= 30;
  return score;
};

const selectAddressCandidate = (...candidates: string[]) => candidates
  .filter(Boolean)
  .sort((left, right) => addressCandidateScore(right) - addressCandidateScore(left))[0] || '';

const normalizeAddressText = (raw: string) => cleanValue(raw)
  .replace(/\s*\n\s*/g, ' ')
  .replace(/\((?:56|5R|S6)(?=친오애아파트)/gi, '(SR')
  .replace(/포승을(?=\s|$)/g, '포승읍');

const normalizePreActionText = (raw: string) => normalizeTechnicalTerms(raw
  .split('\n')
  .map((line) => cleanValue(line).replace(/^[.·ㆍ*]+\s*/, ''))
  .filter(Boolean)
  .join('\n'));

const checklistValue = (line: string, label: RegExp) => {
  const match = line.match(label);
  if (!match || match.index === undefined) return '';
  return cleanValue(line.slice(match.index + match[0].length)).replace(/^[:：.·ㆍ,]+\s*/, '');
};

const standardizeSignalChecklist = (raw: string, forceStandard: boolean): OcrFieldResult => {
  const normalized = normalizeTechnicalTerms(raw);
  const lines = normalized.split('\n').map(cleanValue).filter(Boolean);
  const frequency = lines.find((line) => /(?:측|축)\s*정?\s*주파수/i.test(line));
  const level = lines.find((line) => /(?:상|삼)\s*\/?\s*하(?:향|량).*(?:레벨|러빌)|상\s*\/\s*하향\s*레벨/i.test(line));
  const mer = lines.find((line) => /\bM\s*E\s*R\b/i.test(line));
  const detected = [frequency, level, mer].filter(Boolean).length;
  if (!forceStandard && detected < 2) return textField(raw, { technical: true });
  const frequencyValue = frequency ? checklistValue(frequency, /(?:측|축)\s*정?\s*주파수/i) : '';
  const levelValue = level ? checklistValue(level, /(?:상|삼)\s*\/?\s*하(?:향|량).*?(?:레벨|러빌)/i) : '';
  const merHasBer = Boolean(mer && /M\s*E\s*R\s*\/\s*B\s*E\s*R/i.test(mer));
  const merValue = mer ? checklistValue(mer, /M\s*E\s*R(?:\s*\/\s*B\s*E\s*R)?/i) : '';
  const values = [
    `1. 측정주파수:${frequencyValue ? ` ${frequencyValue}` : ''}`,
    `2. 상/하향 레벨:${levelValue ? ` ${levelValue}` : ''}`,
    `3. ${merHasBer ? 'MER / BER' : 'MER'}:${merValue ? ` ${merValue}` : ''}`,
  ];
  return valueResult(
    raw, values.join('\n'), detected === 3 ? 0.9 : 0.72, detected === 3 ? 'valid' : 'warning',
    detected === 3 ? [] : ['표준 신호점검 항목을 복원했습니다. 측정값을 확인해 주세요.'],
  );
};

const isChecklistLine = (line: string) => /^(?:[|.*·ㆍ]?\s*)?(?:\d+[.)]?\s*)?(?:(?:측|축)\s*정?\s*주파수|(?:상|삼)\s*\/?\s*하(?:향|량).*(?:레벨|러빌)|M\s*E\s*R\s*[:：]?|B\s*E\s*R\s*[:：]?)/i.test(cleanValue(line));

const splitPreActionValue = (section: string, lines: string[]) => {
  const betweenSplitLabel = section.match(/(?:^|\n)\s*사전\s*\n([\s\S]*?)\n\s*조치\s*내?[용옹]?\s*(?:\n|$)/i)?.[1] || '';
  if (betweenSplitLabel.trim()) return betweenSplitLabel.split('\n').map(cleanValue).filter(Boolean).join(' ');
  const start = lines.findIndex((line) => /^사전\s*$/i.test(cleanValue(line)));
  if (start < 0) return '';
  const labelTail = lines.findIndex((line, index) => index > start && index <= start + 4 && /^조치\s*내?[용옹]?$/i.test(cleanValue(line)));
  const isValueLine = (line: string) => (
    /[가-힣A-Za-z]{2,}/.test(line)
    && !FIELD_LABEL.test(line)
    && !isChecklistLine(line)
    && !/^(?:\d+[.)]\s*)|완료처리|점검\s*$|요청\s*내?[용옹]?$/i.test(line)
  );
  if (labelTail > start + 1) return lines.slice(start + 1, labelTail).filter(isValueLine).join(' ');
  if (labelTail === start + 1) {
    const values: string[] = [];
    for (let index = labelTail + 1; index < lines.length; index += 1) {
      if (/^(?:점검|요청\s*내?[용옹]?)$/i.test(cleanValue(lines[index])) || /^(?:\d+[.)]\s*)/.test(lines[index])) break;
      if (isValueLine(lines[index])) values.push(cleanValue(lines[index]));
    }
    return values.join(' ');
  }
  return '';
};

export const parseAndValidateOcrText = (text: string): Record<OcrFieldName, OcrFieldResult> => {
  const normalized = text.replace(/\r/g, '').replace(/[ \t]+/g, ' ').trim();
  const beforeRequestSection = normalized.split('[점검요청 영역 재검사]')[0];
  const requestDetailsSection = normalized.includes('[점검요청 영역 재검사]')
    ? normalized.split('[점검요청 영역 재검사]').pop()?.trim() || ''
    : '';
  const beforePreActionSection = beforeRequestSection.split('[사전조치 영역 재검사]')[0];
  const addressSection = beforePreActionSection.includes('[주소 영역 재검사]')
    ? beforePreActionSection.split('[주소 영역 재검사]').pop()?.trim() || ''
    : '';
  const preActionSection = beforeRequestSection.includes('[사전조치 영역 재검사]')
    ? beforeRequestSection.split('[사전조치 영역 재검사]').pop()?.trim() || ''
    : '';
  const lines = normalized.split('\n').map((line) => line.trim()).filter((line) => (
    line && line !== '[값 영역 재검사]' && line !== '[주소 영역 재검사]'
    && line !== '[사전조치 영역 재검사]' && line !== '[점검요청 영역 재검사]'
  ));
  const addressLines = addressSection.split('\n').map((line) => line.trim()).filter(Boolean);
  const preActionLines = preActionSection.split('\n').map((line) => line.trim()).filter(Boolean);
  const requestDetailsLines = requestDetailsSection.split('\n').map((line) => line.trim()).filter(Boolean);
  const branchRaw = labelledValue(lines, /^지점\s*[:：]?\s*(.*)$/i) || normalized;
  const branch = normalizeHnsBranchName(branchRaw);
  const branchResult = branch
    ? valueResult(branchRaw, branch, 0.98, 'valid')
    : valueResult(branchRaw === normalized ? '' : branchRaw, '', 0.2, 'invalid', ['공식 HNS 지점명을 확인해 주세요.']);
  const date = dateField(labelledValue(lines, /^점검\s*요청일\s*[:：]?\s*(.*)$/i) || normalized);
  const regionPattern = /(?:서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주)\s+.+/;
  const regionalLine = lines.find((line) => regionPattern.test(line)) || '';
  const regionalTail = regionalLine.match(regionPattern)?.[0] || '';
  const inlineAddressReason = regionalTail.match(/^(.+?(?:\[[^\]]+\]|\([^)]*\)|\d))\s+([가-힣A-Za-z][가-힣A-Za-z0-9 /.-]{1,29})\s+CABLE\b/i);
  const focusedRegionalLine = addressLines.find((line) => regionPattern.test(line)) || '';
  const focusedRegionalTail = focusedRegionalLine.match(regionPattern)?.[0] || '';
  const focusedAddressRaw = labelledValue(addressLines, /^고객\s*주소\s*[:：]?\s*(.*)$/i, true)
    || focusedRegionalTail;
  const fullAddressRaw = labelledValue(lines, /^고객\s*주소\s*[:：]?\s*(.*)$/i, true)
    || inlineAddressReason?.[1] || regionalTail;
  const addressRaw = normalizeAddressText(selectAddressCandidate(focusedAddressRaw, fullAddressRaw));
  const address = textField(addressRaw, { min: 8 });
  if (address.value.includes('육밀길') && address.value.includes('육일리')) {
    address.value = address.value.replace('육밀길', '육일길');
    address.warnings.push('법정리 표기와 대조해 도로명 OCR 오인식을 보정했습니다.');
  }
  const focusedDetailFallback = requestDetailsLines.filter((line) => (
    /(?:측|축)\s*정?\s*주파수|(?:상|삼)\s*\/?\s*하(?:향|량)|레벨|러빌|M\s*E\s*R|B\s*E\s*R/i.test(line)
  )).join('\n');
  const detailFallback = lines.filter((line) => /^(?:\d+[.)]\s*)|(?:측|축)\s*정?\s*주파수|(?:상|삼)\s*\/\s*하(?:향|량)|MER\s*[:：]|BER\s*[:：]/i.test(line)).join('\n');
  const requestDetailsRaw = labelledValue(requestDetailsLines, /^점검\s*요청내용\s*[:：]?\s*(.*)$/i, true)
    || focusedDetailFallback
    || labelledValue(lines, /^점검\s*요청내용\s*[:：]?\s*(.*)$/i, true)
    || detailFallback;
  const requesterLabel = labelledValue(lines, /^(?:점검\s*요청정보|요청자)\s*[:：]?\s*(.*)$/i);
  const requesterLine = lines.find((line) => /01[016789][\s).-]*\d{3,4}[\s).-]*\d{4}/.test(line)) || '';
  const phoneMatch = requesterLine.match(/01[016789][\s).-]*\d{3,4}[\s).-]*\d{4}/);
  const requesterPrefix = phoneMatch ? requesterLine.slice(0, phoneMatch.index).trim() : '';
  const requesterPerson = requesterPrefix.match(/([가-힣]{2,5})\s*\[?\s*$/)?.[1] || '';
  const requesterFallback = phoneMatch
    ? `${requesterPerson} [${phoneField(phoneMatch[0]).value}]`.trim()
    : '';
  const handoverReasonRaw = labelledValue(lines, /^이관\s*사유\s*[:：]?\s*(.*)$/i)
    || inlineAddressReason?.[2]
    || normalized.match(/(?:\[[^\]]+\]|\d)\s+([가-힣]{2,20})\s+CABLE\b/i)?.[1]
    || '';
  const requestDetails = standardizeSignalChecklist(
    requestDetailsRaw,
    Boolean(branch && /신호\s*점검/.test(handoverReasonRaw) && /CABLE/i.test(normalized)),
  );
  const focusedPreAction = labelledValue(preActionLines, /^사전\s*조치\s*내[용옹]\s*[:：]?\s*(.*)$/i, true)
    || splitPreActionValue(preActionSection, preActionLines)
    || preActionLines.filter((line) => (
      /[가-힣A-Za-z]{2,}/.test(line)
      && !FIELD_LABEL.test(line)
      && !isChecklistLine(line)
      && !/^(?:\d+[.)]\s*)|완료처리|서비스|CABLE|TAP\s*\/\s*RN|전주|인입선/i.test(line)
    )).join('\n');
  const inlinePreAction = regionalTail.match(/\[[^\]]+\]\s+(.+?)(?=\s*1[.)]\s*측정\s*주파수)/i)?.[1] || '';
  const preActionFallback = normalizePreActionText(focusedPreAction || inlinePreAction);

  return {
    branchName: branchResult,
    requesterName: textField(requesterLabel || requesterFallback),
    inspectionCompany: textField('유지텔레컴', { fixed: '유지텔레컴' }),
    inspectionRequestedDate: date,
    customerAddress: address,
    handoverReason: textField(handoverReasonRaw, { min: 2, technical: true }),
    mediaType: textField('CABLE', { fixed: 'CABLE' }),
    tapRnLocation: textField(labelledValue(lines, /^TAP\s*\/\s*RN\s*위치\s*[:：]?\s*(.*)$/i), { technical: true }),
    poleNumber: textField(labelledValue(lines, /^전주\s*번호\s*[:：]?\s*(.*)$/i), { technical: true }),
    leadInLength: textField(labelledValue(lines, /^인입선\s*길이\s*[:：]?\s*(.*)$/i), { technical: true }),
    preActionNotes: textField(
      preActionFallback || labelledValue(lines, /^사전\s*조치\s*내[용옹]\s*[:：]?\s*(.*)$/i, true),
      { technical: true },
    ),
    inspectionRequestDetails: requestDetails,
    inspectionDate: { ...date },
    serviceNumber: serviceNumberField(normalized, lines),
    contactPhone: phoneField(normalized),
    address: { ...address },
    requestDetail: { ...requestDetails },
  };
};

export const criticalOcrFieldsNeedReview = (fields: Record<OcrFieldName, OcrFieldResult>) => (
  fields.branchName.validationStatus !== 'valid'
  || fields.inspectionRequestedDate.validationStatus !== 'valid'
  || fields.customerAddress.validationStatus !== 'valid'
  || fields.handoverReason.validationStatus !== 'valid'
  || fields.inspectionRequestDetails.validationStatus !== 'valid'
);
