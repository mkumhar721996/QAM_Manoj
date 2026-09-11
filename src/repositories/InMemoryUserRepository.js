"use strict";

const crypto = require("node:crypto");

class InMemoryUserRepository {
  constructor() {
    /** @type {Map<string, import('../models/User').User>} */
    this.usersById = new Map();
    this.idsByEmail = new Map();
  }

  create({ email, displayName, phone, passwordHash }) {
    const id = crypto.randomUUID();
    const user = {
      id,
      email,
      displayName,
      phone: phone ?? null,
      passwordHash,
      status: "active",
      tokenVersion: 0,
      createdAt: new Date().toISOString(),
      deletedAt: null,
    };
    this.usersById.set(id, user);
    this.idsByEmail.set(email.toLowerCase(), id);
    return user;
  }

  findById(id) {
    return this.usersById.get(id) ?? null;
  }

  findByEmail(email) {
    const id = this.idsByEmail.get(email.toLowerCase());
    return id ? this.usersById.get(id) ?? null : null;
  }
}

module.exports = { InMemoryUserRepository };
