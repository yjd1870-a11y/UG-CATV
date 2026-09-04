import assert from 'node:assert/strict';
import { koreaDate, resolveInspectionRequestedDate } from '../../src/features/transfers/registration-policy';

const beforeKoreaMidnight = new Date('2026-09-04T14:59:59.000Z');
const afterKoreaMidnight = new Date('2026-09-04T15:00:00.000Z');

assert.equal(koreaDate(beforeKoreaMidnight), '2026-09-04');
assert.equal(koreaDate(afterKoreaMidnight), '2026-09-05');
assert.equal(resolveInspectionRequestedDate('2026-09-04', false, afterKoreaMidnight), '2026-09-05');
assert.equal(resolveInspectionRequestedDate('2026-09-01', true, afterKoreaMidnight), '2026-09-01');

console.log('Work-transfer registration policy test passed: Korea registration date and user-edited date preservation');
