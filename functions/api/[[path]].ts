const DEFAULT_API_ORIGIN = 'https://ratis-transmission-webapp-yjd1870.onrender.com';
const allowedMethods = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']);
const requestHeadersToRemove = [
  'connection',
  'content-length',
  'forwarded',
  'host',
  'proxy-authorization',
  'proxy-connection',
  'transfer-encoding',
  'x-forwarded-for',
  'x-forwarded-host',
  'x-forwarded-proto',
  'x-real-ip',
];

type PagesEnvironment = {
  API_ORIGIN?: string;
};

type PagesContext = {
  request: Request;
  env: PagesEnvironment;
};

type FetchImplementation = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const jsonError = (status: number, message: string, code: string) => new Response(
  JSON.stringify({ success: false, message, code }),
  {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json; charset=utf-8',
    },
  },
);

const validatedOrigin = (configuredOrigin = DEFAULT_API_ORIGIN) => {
  const origin = new URL(configuredOrigin);
  if (
    origin.protocol !== 'https:'
    || origin.username
    || origin.password
    || origin.pathname !== '/'
    || origin.search
    || origin.hash
  ) {
    throw new Error('API_ORIGIN must be an HTTPS origin without a path.');
  }
  return origin;
};

export const proxyApiRequest = async (
  request: Request,
  configuredOrigin = DEFAULT_API_ORIGIN,
  fetchImplementation: FetchImplementation = fetch,
) => {
  if (!allowedMethods.has(request.method)) {
    return jsonError(405, '허용되지 않은 요청 방식입니다.', 'METHOD_NOT_ALLOWED');
  }

  const incomingUrl = new URL(request.url);
  if (incomingUrl.pathname !== '/api' && !incomingUrl.pathname.startsWith('/api/')) {
    return jsonError(404, '요청한 API를 찾을 수 없습니다.', 'NOT_FOUND');
  }

  const upstreamUrl = validatedOrigin(configuredOrigin);
  upstreamUrl.pathname = incomingUrl.pathname;
  upstreamUrl.search = incomingUrl.search;

  const headers = new Headers(request.headers);
  for (const name of requestHeadersToRemove) headers.delete(name);

  const hasBody = !['GET', 'HEAD'].includes(request.method);
  const upstreamResponse = await fetchImplementation(upstreamUrl, {
    method: request.method,
    headers,
    body: hasBody ? request.body : undefined,
    cache: 'no-store',
    redirect: 'manual',
  });

  // API responses can contain authenticated business data and must never be
  // stored by the Pages/CDN cache.  Enforce this at the proxy boundary as a
  // defence in depth even when an upstream route forgets its cache headers.
  const responseHeaders = new Headers(upstreamResponse.headers);
  responseHeaders.set('Cache-Control', 'private, no-store, no-cache, must-revalidate');
  responseHeaders.set('CDN-Cache-Control', 'no-store');
  responseHeaders.set('Cloudflare-CDN-Cache-Control', 'no-store');
  responseHeaders.set('Pragma', 'no-cache');
  responseHeaders.set('Expires', '0');
  const existingVary = responseHeaders.get('Vary');
  const varyValues = new Set(
    (existingVary ? existingVary.split(',') : [])
      .map((value) => value.trim())
      .filter(Boolean),
  );
  varyValues.add('Cookie');
  varyValues.add('Authorization');
  responseHeaders.set('Vary', [...varyValues].join(', '));

  return new Response(upstreamResponse.body, {
    status: upstreamResponse.status,
    statusText: upstreamResponse.statusText,
    headers: responseHeaders,
  });
};

export const onRequest = async ({ request, env }: PagesContext) => {
  try {
    return await proxyApiRequest(request, env.API_ORIGIN);
  } catch {
    return jsonError(502, 'API 서버에 연결하지 못했습니다.', 'API_PROXY_ERROR');
  }
};
