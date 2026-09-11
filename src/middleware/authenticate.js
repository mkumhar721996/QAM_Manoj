const { verifySessionToken } = require('../auth/token');
const userModel = require('../models/user');

function authenticate(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) {
    res.json(401, { error: 'authentication required' });
    return;
  }
  const payload = verifySessionToken(token);
  if (!payload) {
    res.json(401, { error: 'invalid or expired session' });
    return;
  }
  const user = userModel.findById(payload.sub);
  if (!user) {
    res.json(401, { error: 'invalid or expired session' });
    return;
  }
  req.user = user;
  next();
}

module.exports = { authenticate };
