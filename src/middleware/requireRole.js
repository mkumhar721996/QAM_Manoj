function requireRole(role) {
  return function (req, res, next) {
    if (!req.user || req.user.role !== role) {
      res.json(403, { error: `requires ${role} role` });
      return;
    }
    next();
  };
}

module.exports = { requireRole };
