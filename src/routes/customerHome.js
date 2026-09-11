const { authenticate } = require('../middleware/authenticate');
const { requireRole } = require('../middleware/requireRole');

function mountCustomerHomeRoutes(router) {
  router.get('/customer/home', authenticate, requireRole('customer'), (req, res) => {
    res.json(200, { screen: 'customer-home' });
  });
}

module.exports = { mountCustomerHomeRoutes };
