const MAX_BODY_BYTES = 10 * 1024; // 10KB
const BODY_READ_TIMEOUT_MS = 5000;

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    let receivedBytes = 0;
    let settled = false;

    const settle = (fn, arg) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      fn(arg);
    };

    const timeout = setTimeout(() => {
      req.destroy();
      settle(reject, new Error('Request body read timed out'));
    }, BODY_READ_TIMEOUT_MS);

    req.on('data', (chunk) => {
      receivedBytes += chunk.length;
      if (receivedBytes > MAX_BODY_BYTES) {
        req.destroy();
        return settle(reject, new Error('Request body too large'));
      }
      raw += chunk;
    });
    req.on('end', () => {
      if (!raw) {
        return settle(resolve, {});
      }
      try {
        settle(resolve, JSON.parse(raw));
      } catch (err) {
        settle(reject, err);
      }
    });
    req.on('error', (err) => settle(reject, err));
  });
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

module.exports = { readJsonBody, sendJson };
