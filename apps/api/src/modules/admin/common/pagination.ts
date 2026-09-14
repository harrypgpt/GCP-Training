export interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export function paginationSkipTake(page: number, pageSize: number): { skip: number; take: number } {
  return { skip: (page - 1) * pageSize, take: pageSize };
}

export function buildPaginatedResult<T>(
  items: T[],
  total: number,
  page: number,
  pageSize: number,
): PaginatedResult<T> {
  return { items, total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}

/**
 * Case-insensitive Prisma `contains` filter for a definitely-present search
 * term. Callers should only reach for this inside a branch that already
 * checked the term is non-empty (e.g. `query.search ? { OR: [...] } : {}`),
 * which is why this returns a plain object rather than `T | undefined` —
 * that union would otherwise poison every `WhereInput` it's spread into
 * under `exactOptionalPropertyTypes`.
 */
export function containsInsensitive(term: string): { contains: string; mode: 'insensitive' } {
  return { contains: term, mode: 'insensitive' };
}
