const { authenticate } = require('../middleware/authenticate');
const { requireRole } = require('../middleware/requireRole');

// Placeholder provider-specific screens. Access is gated only on role: a
// newly registered provider reaches these immediately, with no separate
// approval/status check.
function mountProviderDashboardRoutes(router) {
  router.get('/provider/dashboard', authenticate, requireRole('provider'), (req, res) => {
    res.json(200, { screen: 'provider-dashboard' });
  });
  router.get('/provider/bookings', authenticate, requireRole('provider'), (req, res) => {
    res.json(200, { screen: 'provider-bookings' });
  });
}

module.exports = { mountProviderDashboardRoutes };
