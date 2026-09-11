import { createApp } from '../src/app.js';
import { createStore } from '../src/store.js';
import { hashPassword } from '../src/passwords.js';

export async function startTestServer() {
  const store = createStore();
  const server = createApp(store);
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  return {
    store,
    baseUrl,
    async close() {
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

export function seedUser(store, { email, password, role = 'USER' }) {
  return store.users.create({ email, passwordHash: hashPassword(password), role });
}

export async function login(baseUrl, email, password) {
  const res = await fetch(`${baseUrl}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const body = await res.json();
  return { status: res.status, body };
}
