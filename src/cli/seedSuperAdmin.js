const path = require('path');
const { createStore } = require('../db/store');
const { createUser, hasSuperAdmin } = require('../services/userService');
const { ROLES } = require('../db/roles');

function seedSuperAdmin(store, { email, password }) {
  if (hasSuperAdmin(store)) {
    return { created: false, reason: 'super_admin_exists' };
  }
  if (!email || !password) {
    throw new Error('SUPER_ADMIN_EMAIL and SUPER_ADMIN_PASSWORD are required');
  }
  const user = createUser(store, { email, password, role: ROLES.SUPER_ADMIN });
  return { created: true, user };
}

if (require.main === module) {
  const dbFile = process.env.DB_FILE || path.join(__dirname, '..', '..', 'data', 'db.json');
  const store = createStore(dbFile);
  try {
    const result = seedSuperAdmin(store, {
      email: process.env.SUPER_ADMIN_EMAIL,
      password: process.env.SUPER_ADMIN_PASSWORD,
    });
    if (result.created) {
      console.log(`Super-admin account created: ${result.user.email}`);
    } else {
      console.log('Super-admin already exists; no action taken.');
    }
  } catch (err) {
    console.error(`Failed to seed super-admin: ${err.message}`);
    process.exitCode = 1;
  }
}

module.exports = { seedSuperAdmin };
