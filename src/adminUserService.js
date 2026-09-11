import { USER_STATUS } from './store.js';

export class UserNotFoundError extends Error {
  constructor() {
    super('User not found.');
    this.name = 'UserNotFoundError';
  }
}

// Suspending an already-suspended user is a no-op on tokenVersion/tokens
// (they were already revoked) but still succeeds, per AC5.
export function suspendUser(store, userId) {
  const user = store.users.findById(userId);
  if (!user) throw new UserNotFoundError();

  if (user.status !== USER_STATUS.SUSPENDED) {
    user.status = USER_STATUS.SUSPENDED;
    user.tokenVersion += 1;
  }
  store.refreshTokens.revokeAllForUser(user.id);
  return user;
}

export function reinstateUser(store, userId) {
  const user = store.users.findById(userId);
  if (!user) throw new UserNotFoundError();

  user.status = USER_STATUS.ACTIVE;
  return user;
}
