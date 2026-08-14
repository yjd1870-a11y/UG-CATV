const isAbsoluteResourceUrl = (value: string) => /^(?:[a-z][a-z\d+.-]*:)?\/\//i.test(value)
  || /^(?:data|blob):/i.test(value);

export const resolveApiResourceUrl = (apiBase: string, resourceUrl: string) => {
  const base = apiBase.trim().replace(/\/$/, '');
  const value = resourceUrl.trim();
  if (!value || isAbsoluteResourceUrl(value)) return value;

  if (value === '/api' && base.endsWith('/api')) return base;
  const path = value.startsWith('/api/') && base.endsWith('/api')
    ? value.slice('/api'.length)
    : value.startsWith('/') ? value : `/${value}`;
  return `${base}${path}`;
};
