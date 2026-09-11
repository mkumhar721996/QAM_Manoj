const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('./helpers');

async function registerAndGetToken(baseUrl, { email, role }) {
  const res = await fetch(`${baseUrl}/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Test User', email, password: 'test-password', role }),
  });
  const body = await res.json();
  return body.token;
}

test('AC6: a newly registered provider gets immediate access to provider screens, no approval gate', async (t) => {
  const { baseUrl, close } = await startServer();
  t.after(close);

  const token = await registerAndGetToken(baseUrl, { email: 'provider@example.com', role: 'provider' });

  const dashboardRes = await fetch(`${baseUrl}/provider/dashboard`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(dashboardRes.status, 200);
  const dashboardBody = await dashboardRes.json();
  assert.equal(dashboardBody.screen, 'provider-dashboard');
  assert.equal(dashboardBody.pendingApproval, undefined);
  assert.equal(dashboardBody.approved, undefined);

  const bookingsRes = await fetch(`${baseUrl}/provider/bookings`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(bookingsRes.status, 200);
});

test('AC7: users can only reach screens appropriate to their assigned role', async (t) => {
  const { baseUrl, close } = await startServer();
  t.after(close);

  const customerToken = await registerAndGetToken(baseUrl, { email: 'customer@example.com', role: 'customer' });
  const providerToken = await registerAndGetToken(baseUrl, { email: 'provider2@example.com', role: 'provider' });

  const customerOnProviderRoute = await fetch(`${baseUrl}/provider/dashboard`, {
    headers: { Authorization: `Bearer ${customerToken}` },
  });
  assert.equal(customerOnProviderRoute.status, 403);

  const providerOnCustomerRoute = await fetch(`${baseUrl}/customer/home`, {
    headers: { Authorization: `Bearer ${providerToken}` },
  });
  assert.equal(providerOnCustomerRoute.status, 403);

  const customerOnOwnRoute = await fetch(`${baseUrl}/customer/home`, {
    headers: { Authorization: `Bearer ${customerToken}` },
  });
  assert.equal(customerOnOwnRoute.status, 200);

  const providerOnOwnRoute = await fetch(`${baseUrl}/provider/dashboard`, {
    headers: { Authorization: `Bearer ${providerToken}` },
  });
  assert.equal(providerOnOwnRoute.status, 200);
});
