const http = require('node:http');
const { createDefectRepository } = require('./repository/defectRepository');
const { createDefectController } = require('./controllers/defectController');
const { readJsonBody, sendJson } = require('./utils/http');

function createApp() {
  const repository = createDefectRepository();
  const controller = createDefectController(repository);

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const segments = url.pathname.split('/').filter(Boolean);

    try {
      if (req.method === 'POST' && segments.length === 1 && segments[0] === 'defects') {
        const body = await readJsonBody(req);
        return controller.create(req, res, body);
      }

      if (req.method === 'GET' && segments.length === 2 && segments[0] === 'defects') {
        return controller.get(req, res, segments[1]);
      }

      if (
        req.method === 'POST' &&
        segments.length === 3 &&
        segments[0] === 'defects' &&
        segments[2] === 'transitions'
      ) {
        const body = await readJsonBody(req);
        return controller.transition(req, res, segments[1], body);
      }

      return sendJson(res, 404, { error: 'Not found' });
    } catch (err) {
      console.error('Request processing failed:', err);
      return sendJson(res, 400, { error: 'Invalid request body' });
    }
  });

  return server;
}

module.exports = { createApp };
