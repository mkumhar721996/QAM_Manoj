const { test } = require('node:test');
const assert = require('node:assert/strict');
const { STATUSES, isValidTransition } = require('../../src/domain/statusTransitions');

const ALLOWED = new Set([
  'Open->Fixed',
  'Fixed->Closed',
  'Fixed->Reopened',
  'Reopened->Fixed',
]);

for (const from of STATUSES) {
  for (const to of STATUSES) {
    const key = `${from}->${to}`;
    const expected = ALLOWED.has(key);
    test(`isValidTransition(${from}, ${to}) is ${expected}`, () => {
      assert.equal(isValidTransition(from, to), expected);
    });
  }
}

test('Closed is a terminal status with no allowed transitions', () => {
  for (const to of STATUSES) {
    assert.equal(isValidTransition('Closed', to), false);
  }
});
