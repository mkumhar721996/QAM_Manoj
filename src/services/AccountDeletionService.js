"use strict";

class AccountDeletionService {
  /**
   * @param {{ userRepository: import('../repositories/InMemoryUserRepository').InMemoryUserRepository, tokenService: import('./TokenService').TokenService }} deps
   */
  constructor({ userRepository, tokenService }) {
    this.userRepository = userRepository;
    this.tokenService = tokenService;
  }

  /** Soft-deletes and anonymises the given user, revoking all of their tokens. */
  deleteAccount(user) {
    user.email = `deleted-${user.id}@deleted.invalid`;
    user.displayName = "Deleted User";
    user.phone = null;
    user.status = "deleted";
    user.deletedAt = new Date().toISOString();
    user.tokenVersion += 1;

    this.tokenService.revokeAllForUser(user.id);

    return user;
  }
}

module.exports = { AccountDeletionService };
