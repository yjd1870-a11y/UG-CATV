type CacheValue = { expires: number; value: unknown };

const searchCache = new Map<string, CacheValue>();

export const cachedStraightMapSearch = (key: string, create: () => unknown) => {
  const cached = searchCache.get(key);
  if (cached && cached.expires > Date.now()) return cached.value;
  const value = create();
  if (searchCache.size >= 100) searchCache.delete(searchCache.keys().next().value as string);
  searchCache.set(key, { expires: Date.now() + 30_000, value });
  return value;
};

export const invalidateStraightMapSearchCache = () => searchCache.clear();
