function authenticate(req) {
  const header = req.headers['authorization'] || '';
  const match = /^Bearer (.+)$/.exec(header);
  const userId = match ? match[1].trim() : '';
  if (userId.length === 0) {
    console.warn('Auth failed for request', { method: req.method, url: req.url });
    return null;
  }
  return userId;
}

module.exports = { authenticate };
