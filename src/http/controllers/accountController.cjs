"use strict";

function createAccountController({ accountDeletionService }) {
  return {
    /** Deletes the target account, but only when the caller owns it. */
    deleteAccount(user, targetUserId) {
      if (user.id !== targetUserId) {
        return { status: 403, body: { error: "You may only delete your own account" } };
      }

      accountDeletionService.deleteAccount(user);
      return { status: 204 };
    },
  };
}

module.exports = { createAccountController };
