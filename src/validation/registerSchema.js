const { ROLES } = require('../models/user');

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 8;

function validateRegistration(body = {}) {
  const errors = {};
  const { name, email, password, role } = body;

  if (typeof name !== 'string' || name.trim().length === 0) {
    errors.name = 'name is required';
  }

  if (typeof email !== 'string' || email.trim().length === 0) {
    errors.email = 'email is required';
  } else if (!EMAIL_PATTERN.test(email)) {
    errors.email = 'email must be a valid email address';
  }

  if (typeof password !== 'string' || password.length === 0) {
    errors.password = 'password is required';
  } else if (password.length < MIN_PASSWORD_LENGTH) {
    errors.password = `password must be at least ${MIN_PASSWORD_LENGTH} characters`;
  }

  if (typeof role !== 'string' || role.trim().length === 0) {
    errors.role = 'role is required';
  } else if (!ROLES.includes(role)) {
    errors.role = `role must be one of: ${ROLES.join(', ')}`;
  }

  return {
    valid: Object.keys(errors).length === 0,
    errors,
    data: { name, email, password, role },
  };
}

module.exports = { validateRegistration };
