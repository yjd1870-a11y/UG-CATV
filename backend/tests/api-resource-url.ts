import assert from 'node:assert/strict';
import { resolveApiResourceUrl } from '../../src/shared/api/url';

const renderApi = 'https://ratis-transmission-webapp-yjd1870.onrender.com/api';

assert.equal(
  resolveApiResourceUrl(renderApi, '/api/floor-plans/floor-1/image'),
  `${renderApi}/floor-plans/floor-1/image`,
);
assert.equal(
  resolveApiResourceUrl(renderApi, '/api/straight-maps/map-1/versions/1/tiles/3/0_0.webp'),
  `${renderApi}/straight-maps/map-1/versions/1/tiles/3/0_0.webp`,
);
assert.equal(resolveApiResourceUrl('/api', '/api/floor-plans/floor-1/image'), '/api/floor-plans/floor-1/image');
assert.equal(resolveApiResourceUrl(renderApi, 'https://cdn.example.com/image.png'), 'https://cdn.example.com/image.png');
assert.equal(resolveApiResourceUrl(renderApi, 'blob:https://example.com/asset'), 'blob:https://example.com/asset');

console.log('[api-resource-url] passed');
