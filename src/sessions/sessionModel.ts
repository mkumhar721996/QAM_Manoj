export interface Session {
  id: string;
  userId: string;
  refreshTokenHash: string;
  createdAt: number;
  expiresAt: number;
  revoked: boolean;
}
