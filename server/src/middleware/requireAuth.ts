export interface AuthResult {
  authenticated: boolean;
  userId: string | null;
}

export function requireAuth(headers: Record<string, string | undefined>): AuthResult {
  const rawUserId = headers["x-user-id"];
  const userId = typeof rawUserId === "string" ? rawUserId.trim() : "";

  if (userId.length === 0) {
    return { authenticated: false, userId: null };
  }

  return { authenticated: true, userId };
}
