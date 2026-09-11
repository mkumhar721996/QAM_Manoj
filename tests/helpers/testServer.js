const fs = require('fs');
const os = require('os');
const path = require('path');
const { createStore } = require('../../src/db/store');
const { createAuthService } = require('../../src/services/authService');
const { createApp } = require('../../src/app');

function startTestServer() {
  const dbFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'qam-test-')), 'db.json');
  const store = createStore(dbFile);
  const authService = createAuthService(store);
  const app = createApp({ store, authService });

  return new Promise((resolve) => {
    app.listen(0, '127.0.0.1', () => {
      const { port } = app.address();
      resolve({
        baseUrl: `http://127.0.0.1:${port}`,
        store,
        authService,
        close: () => new Promise((r) => app.close(r)),
      });
    });
  });
}

module.exports = { startTestServer };
