const { createRouter } = require('./router');
const { mountAuthRoutes } = require('./routes/auth');
const { mountProviderDashboardRoutes } = require('./routes/providerDashboard');
const { mountCustomerHomeRoutes } = require('./routes/customerHome');

function createApp() {
  const router = createRouter();
  mountAuthRoutes(router);
  mountProviderDashboardRoutes(router);
  mountCustomerHomeRoutes(router);
  return router;
}

module.exports = { createApp };
