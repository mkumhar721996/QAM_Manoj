export const ERROR_CODES = {
  VALIDATION_ERROR: "VALIDATION_ERROR",
  UNAUTHORIZED: "UNAUTHORIZED",
  FORBIDDEN: "FORBIDDEN",
  NOT_FOUND: "NOT_FOUND",
  CONFLICT: "CONFLICT",
  PAYLOAD_TOO_LARGE: "PAYLOAD_TOO_LARGE",
  INTERNAL_ERROR: "INTERNAL_ERROR",
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

export interface ErrorEnvelope {
  error_code: string;
  message: string;
  details: Record<string, unknown>;
}

export function errorEnvelope(
  errorCode: ErrorCode | string,
  message: string,
  details: Record<string, unknown> = {},
): ErrorEnvelope {
  return { error_code: errorCode, message, details };
}
