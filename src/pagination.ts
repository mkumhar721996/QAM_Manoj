export const DEFAULT_LIMIT = 20;
export const DEFAULT_OFFSET = 0;
export const MAX_LIMIT = 100;

export class PaginationValidationError extends Error {}

export interface PaginationParams {
  limit: number;
  offset: number;
}

export function parsePaginationParams(searchParams: URLSearchParams): PaginationParams {
  const rawLimit = searchParams.get("limit");
  const rawOffset = searchParams.get("offset");
  const limit = rawLimit === null ? DEFAULT_LIMIT : Number(rawLimit);
  const offset = rawOffset === null ? DEFAULT_OFFSET : Number(rawOffset);

  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    throw new PaginationValidationError(`limit must be an integer between 1 and ${MAX_LIMIT}`);
  }
  if (!Number.isInteger(offset) || offset < 0) {
    throw new PaginationValidationError("offset must be a non-negative integer");
  }
  return { limit, offset };
}

export function paginateArray<T>(all: T[], limit: number, offset: number): T[] {
  return all.slice(offset, offset + limit);
}

export function buildPaginationEnvelope<T>(
  items: T[],
  total: number,
  limit: number,
  offset: number,
): { total: number; limit: number; offset: number; items: T[] } {
  return { total, limit, offset, items };
}
