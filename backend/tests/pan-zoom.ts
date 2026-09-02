import assert from 'node:assert/strict';
import { horizontalSwipeDirection, pinchView, zoomViewAt } from '../../src/shared/gestures/pan-zoom';

const initial = { scale: 2, x: 100, y: 50 };
const anchor = { x: 400, y: 300 };
const worldBefore = { x: (anchor.x - initial.x) / initial.scale, y: (anchor.y - initial.y) / initial.scale };
const zoomed = zoomViewAt(initial, 1.5, anchor, 0.5, 10);
assert.equal(zoomed.scale, 3);
assert.equal(zoomed.x + worldBefore.x * zoomed.scale, anchor.x);
assert.equal(zoomed.y + worldBefore.y * zoomed.scale, anchor.y);

const pinched = pinchView(initial, anchor, { x: 430, y: 320 }, 1.5, 0.5, 10);
assert.equal(pinched.scale, 3);
assert.equal(pinched.x + worldBefore.x * pinched.scale, 430);
assert.equal(pinched.y + worldBefore.y * pinched.scale, 320);

const limited = zoomViewAt(initial, 100, anchor, 0.5, 4);
assert.equal(limited.scale, 4);

assert.equal(horizontalSwipeDirection({ x: 120, y: 20 }, { x: 40, y: 24 }), 1);
assert.equal(horizontalSwipeDirection({ x: 40, y: 20 }, { x: 120, y: 24 }), -1);
assert.equal(horizontalSwipeDirection({ x: 40, y: 20 }, { x: 70, y: 22 }), 0);
assert.equal(horizontalSwipeDirection({ x: 40, y: 20 }, { x: 100, y: 100 }), 0);

console.log('Pan/zoom test passed: zoom, pinch, and horizontal swipe gestures behave as expected.');
