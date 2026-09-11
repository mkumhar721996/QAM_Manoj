const userModel = require('../models/user');
const { validateRegistration } = require('../validation/registerSchema');
const { hashPassword } = require('../auth/password');
const { createSessionToken } = require('../auth/token');

function toPublicUser(user) {
  return { id: user.id, name: user.name, email: user.email, role: user.role };
}

function register(req, res) {
  const { valid, errors, data } = validateRegistration(req.body);
  if (!valid) {
    res.json(400, { errors });
    return;
  }

  if (userModel.findByEmail(data.email)) {
    res.json(409, { error: 'email already registered' });
    return;
  }

  const passwordHash = hashPassword(data.password);
  const user = userModel.create({
    name: data.name,
    email: data.email,
    passwordHash,
    role: data.role,
  });

  const token = createSessionToken(user);
  res.json(201, { user: toPublicUser(user), token });
}

module.exports = { register, toPublicUser };
