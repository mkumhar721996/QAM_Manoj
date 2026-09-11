const { register, toPublicUser } = require('../controllers/registerController');
const { authenticate } = require('../middleware/authenticate');

function mountAuthRoutes(router) {
  router.post('/register', register);
  router.get('/me', authenticate, (req, res) => {
    res.json(200, { user: toPublicUser(req.user) });
  });
}

module.exports = { mountAuthRoutes };
