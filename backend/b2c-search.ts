export const normalizeB2CSearchText = (value: unknown) => String(value ?? '')
  .replace(/_x000D_/gi, '')
  .trim()
  .toLocaleLowerCase('ko-KR')
  .replace(/\s+/g, '');

export const buildB2CSearchValue = (values: unknown[]) => values
  .map(normalizeB2CSearchText)
  .filter(Boolean)
  .join('\u001f');
