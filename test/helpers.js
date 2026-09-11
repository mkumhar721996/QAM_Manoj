const { createApp } = require('../src/app');
const db = require('../src/db');

async function startServer() {
  db.reset();
  const app = createApp();
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address();
  return {
    server,
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

module.exports = { startServer };
