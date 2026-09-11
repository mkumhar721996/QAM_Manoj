const path = require('path');
const { createStore } = require('./db/store');
const { createAuthService } = require('./services/authService');
const { createApp } = require('./app');

const dbFile = process.env.DB_FILE || path.join(__dirname, '..', 'data', 'db.json');
const store = createStore(dbFile);
const authService = createAuthService(store);
const app = createApp({ store, authService });

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});
