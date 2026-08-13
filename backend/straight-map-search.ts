export type StraightMapMatchLength = 5 | 6;

export const normalizeStraightMapCompactText = (value: unknown) => String(value ?? '')
  .normalize('NFKC')
  .trim()
  .toLocaleLowerCase('ko-KR')
  .replace(/\s+/g, '');

export const straightMapContinuousTerms = (query: unknown, matchLength: StraightMapMatchLength) => {
  const normalized = normalizeStraightMapCompactText(query);
  const characters = Array.from(normalized);
  if (characters.length < matchLength) return { normalized, terms: [] as string[] };
  const terms = new Set<string>([normalized]);
  for (let index = 0; index <= characters.length - matchLength; index += 1) {
    terms.add(characters.slice(index, index + matchLength).join(''));
  }
  return { normalized, terms: [...terms].slice(0, 80) };
};
