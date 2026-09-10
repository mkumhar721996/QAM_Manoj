const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../../src/app');

let baseUrl;
let server;

before(async () => {
  server = createApp();
  await new Promise((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

function authHeaders(userId) {
  return { Authorization: `Bearer ${userId}`, 'Content-Type': 'application/json' };
}

async function seedDefect(userId, status) {
  const res = await fetch(`${baseUrl}/defects`, {
    method: 'POST',
    headers: authHeaders(userId),
    body: JSON.stringify({ reporterId: userId, title: 'Seed defect', status }),
  });
  return res.json();
}

async function transitionDefect(userId, id, toStatus) {
  const res = await fetch(`${baseUrl}/defects/${id}/transitions`, {
    method: 'POST',
    headers: authHeaders(userId),
    body: JSON.stringify({ toStatus }),
  });
  return { status: res.status, body: await res.json() };
}

async function getDefect(userId, id) {
  const res = await fetch(`${baseUrl}/defects/${id}`, {
    method: 'GET',
    headers: authHeaders(userId),
  });
  return { status: res.status, body: await res.json() };
}

test('AC1: Open -> Fixed succeeds for an authenticated tester', async () => {
  const defect = await seedDefect('tester-1', 'Open');
  const { status, body } = await transitionDefect('tester-1', defect.id, 'Fixed');
  assert.equal(status, 200);
  assert.equal(body.status, 'Fixed');
});

test('AC2: Fixed -> Closed succeeds for an authenticated tester', async () => {
  const defect = await seedDefect('tester-1', 'Fixed');
  const { status, body } = await transitionDefect('tester-1', defect.id, 'Closed');
  assert.equal(status, 200);
  assert.equal(body.status, 'Closed');
});

test('AC3: Fixed -> Reopened succeeds for an authenticated tester', async () => {
  const defect = await seedDefect('tester-1', 'Fixed');
  const { status, body } = await transitionDefect('tester-1', defect.id, 'Reopened');
  assert.equal(status, 200);
  assert.equal(body.status, 'Reopened');
});

test('AC4: Reopened -> Fixed succeeds for an authenticated tester', async () => {
  const defect = await seedDefect('tester-1', 'Reopened');
  const { status, body } = await transitionDefect('tester-1', defect.id, 'Fixed');
  assert.equal(status, 200);
  assert.equal(body.status, 'Fixed');
});

test('AC5: any transition attempt from Closed is rejected and status remains Closed', async () => {
  const defect = await seedDefect('tester-1', 'Closed');

  for (const toStatus of ['Open', 'Fixed', 'Reopened']) {
    const { status, body } = await transitionDefect('tester-1', defect.id, toStatus);
    assert.ok(status === 409 || status === 422, `expected rejection for Closed -> ${toStatus}`);
    assert.equal(body.defect.status, 'Closed');
  }

  const { body: finalDefect } = await getDefect('tester-1', defect.id);
  assert.equal(finalDefect.status, 'Closed');
});

test('AC6: Open cannot transition directly to Closed or Reopened', async () => {
  for (const toStatus of ['Closed', 'Reopened']) {
    const defect = await seedDefect('tester-1', 'Open');
    const { status, body } = await transitionDefect('tester-1', defect.id, toStatus);
    assert.ok(status === 409 || status === 422, `expected rejection for Open -> ${toStatus}`);
    assert.equal(body.defect.status, 'Open');
  }
});

test('AC7: a tester who is not the original reporter can still transition the defect', async () => {
  const defect = await seedDefect('original-reporter', 'Open');
  const { status, body } = await transitionDefect('a-different-tester', defect.id, 'Fixed');
  assert.equal(status, 200);
  assert.equal(body.status, 'Fixed');
});

test('AC8: full transition history is visible in chronological order to any authenticated user', async () => {
  const defect = await seedDefect('tester-1', 'Open');
  await transitionDefect('tester-1', defect.id, 'Fixed');
  await transitionDefect('tester-1', defect.id, 'Reopened');
  await transitionDefect('tester-1', defect.id, 'Fixed');

  const { status, body } = await getDefect('a-completely-different-viewer', defect.id);
  assert.equal(status, 200);
  assert.equal(body.history.length, 3);

  const expectedSequence = [
    ['Open', 'Fixed'],
    ['Fixed', 'Reopened'],
    ['Reopened', 'Fixed'],
  ];
  expectedSequence.forEach(([fromStatus, toStatus], index) => {
    assert.equal(body.history[index].fromStatus, fromStatus);
    assert.equal(body.history[index].toStatus, toStatus);
    assert.ok(body.history[index].at, 'history entry must have a timestamp');
  });

  const timestamps = body.history.map((entry) => new Date(entry.at).getTime());
  for (let i = 1; i < timestamps.length; i++) {
    assert.ok(timestamps[i] >= timestamps[i - 1], 'history must be in chronological order');
  }
});

test('AC9: a completed transition records and exposes a timestamp on the defect', async () => {
  const defect = await seedDefect('tester-1', 'Open');
  const beforeTransition = Date.now();
  const { status, body } = await transitionDefect('tester-1', defect.id, 'Fixed');
  const afterTransition = Date.now();

  assert.equal(status, 200);
  assert.ok(body.lastTransitionAt, 'lastTransitionAt must be present');

  const transitionTime = new Date(body.lastTransitionAt).getTime();
  assert.ok(transitionTime >= beforeTransition && transitionTime <= afterTransition);
  assert.equal(body.history[body.history.length - 1].at, body.lastTransitionAt);
});

test('an unauthenticated request is rejected', async () => {
  const defect = await seedDefect('tester-1', 'Open');
  const res = await fetch(`${baseUrl}/defects/${defect.id}/transitions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ toStatus: 'Fixed' }),
  });
  assert.equal(res.status, 401);
});
