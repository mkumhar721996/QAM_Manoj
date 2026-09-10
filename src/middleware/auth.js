function authenticate(req) {
  const header = req.headers['authorization'] || '';
  const match = /^Bearer (.+)$/.exec(header);
  if (!match) {
    return null;
  }
  const userId = match[1].trim();
  return userId.length > 0 ? userId : null;
}

module.exports = { authenticate };
