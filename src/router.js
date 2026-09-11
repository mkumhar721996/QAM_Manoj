const http = require('node:http');

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      if (chunks.length === 0) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

function createRouter() {
  const routes = [];

  function register(method, path, handlers) {
    routes.push({ method, path, handlers });
  }

  const router = {
    get: (path, ...handlers) => register('GET', path, handlers),
    post: (path, ...handlers) => register('POST', path, handlers),
  };

  router.listen = (port) => {
    const server = http.createServer(async (req, res) => {
      const url = new URL(req.url, 'http://localhost');
      const match = routes.find((r) => r.method === req.method && r.path === url.pathname);

      res.json = (status, body) => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(body));
      };

      if (!match) {
        res.json(404, { error: 'not found' });
        return;
      }

      if (req.method === 'POST') {
        try {
          req.body = await readJsonBody(req);
        } catch {
          res.json(400, { error: 'invalid JSON body' });
          return;
        }
      }

      let index = 0;
      const next = () => {
        const handler = match.handlers[index++];
        if (!handler) return;
        handler(req, res, next);
      };
      next();
    });
    return server.listen(port);
  };

  return router;
}

module.exports = { createRouter };
