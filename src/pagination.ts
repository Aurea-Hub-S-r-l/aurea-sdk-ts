/**
 * Pagination helpers (docs.aureahub.com › Pagination). The list routes use one of three styles, none with cursors:
 *
 * - `offset`: `limit` + `offset`, answer `{ data, pagination: { total, limit, offset, hasMore } }`
 *   (wallets, users…); the bank ramp's deposits and transactions have no `hasMore`: stop at `total`.
 * - `page`: `page` (from 1) + `limit`, answer `{ data, pagination: { page, limit, total, totalPages } }`
 *   (transactions, the unified feed); payouts carry `totalPages` at the top level.
 * - `skip`: `limit` + `skip`, answer `{ notifications, total }` (the inbox).
 *
 * Each helper calls `fetchPage` with the page's parameters and yields the items one by one, so a generated method
 * plugs straight in:
 *
 *   for await (const wallet of paginateOffset((p) => aurea.wallets.v1WalletsGet(p), { limit: 100 })) { … }
 */

type Page = object | null | undefined;

/** The item type of a page: the element of its `data` array, else unknown (pass `items` to pick another field). */
export type ItemOf<P> = P extends { data?: Array<infer I> | null } ? I : unknown;

export interface PaginateOptions<T> {
  /** Items per page; the route's own maximum applies (often 100). */
  limit?: number;
  /** Where the items are in an answer; default: `data`, else the first array field (`deposits`, `payouts`…). */
  items?: (page: any) => T[] | undefined;
  /** Stop after this many pages (a safety stop; default 10,000). */
  maxPages?: number;
}

function itemsOf<T>(page: Page, pick?: (page: any) => T[] | undefined): T[] {
  if (pick) return pick(page) ?? [];
  if (!page || typeof page !== "object") return [];
  if (Array.isArray((page as { data?: unknown }).data)) return (page as { data: T[] }).data;
  const first = Object.values(page).find(Array.isArray);
  return (first as T[] | undefined) ?? [];
}

function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function paginationOf(page: Page): Record<string, unknown> {
  const p = page && typeof page === "object" ? (page as { pagination?: unknown }).pagination : undefined;
  return p && typeof p === "object" ? (p as Record<string, unknown>) : ((page ?? {}) as Record<string, unknown>);
}

/** `limit` + `offset` lists. */
export async function* paginateOffset<P extends Page, T = ItemOf<P>>(
  fetchPage: (params: { limit: number; offset: number }) => Promise<P>,
  options: PaginateOptions<T> & { offset?: number } = {},
): AsyncGenerator<T, void, undefined> {
  const limit = options.limit ?? 50;
  const maxPages = options.maxPages ?? 10_000;
  let offset = options.offset ?? 0;
  for (let n = 0; n < maxPages; n++) {
    const page = await fetchPage({ limit, offset });
    const items = itemsOf<T>(page, options.items);
    yield* items;
    const meta = paginationOf(page);
    if (typeof meta.hasMore === "boolean") {
      if (!meta.hasMore) return;
    } else {
      const total = num(meta.total);
      if (total === undefined || offset + limit >= total) return;
    }
    if (items.length === 0) return;
    offset += limit;
  }
}

/** `page` + `limit` lists (pages from 1). */
export async function* paginatePages<P extends Page, T = ItemOf<P>>(
  fetchPage: (params: { page: number; limit: number }) => Promise<P>,
  options: PaginateOptions<T> & { page?: number } = {},
): AsyncGenerator<T, void, undefined> {
  const limit = options.limit ?? 50;
  const maxPages = options.maxPages ?? 10_000;
  for (let page = options.page ?? 1, n = 0; n < maxPages; page++, n++) {
    const answer = await fetchPage({ page, limit });
    const items = itemsOf<T>(answer, options.items);
    yield* items;
    const totalPages = num(paginationOf(answer).totalPages);
    if (totalPages === undefined || page >= totalPages || items.length === 0) return;
  }
}

/** `limit` + `skip` lists (the notification inbox: `{ notifications, total }`). */
export async function* paginateSkip<P extends Page, T = ItemOf<P>>(
  fetchPage: (params: { limit: number; skip: number }) => Promise<P>,
  options: PaginateOptions<T> & { skip?: number } = {},
): AsyncGenerator<T, void, undefined> {
  const limit = options.limit ?? 20;
  const maxPages = options.maxPages ?? 10_000;
  let skip = options.skip ?? 0;
  for (let n = 0; n < maxPages; n++) {
    const answer = await fetchPage({ limit, skip });
    const items = itemsOf<T>(answer, options.items);
    yield* items;
    const total = num(paginationOf(answer).total);
    skip += items.length;
    if (items.length === 0 || total === undefined || skip >= total) return;
  }
}

/** Collects an async iterable into an array (mind the size of what you list). */
export async function collect<T>(iterable: AsyncIterable<T>, max = Infinity): Promise<T[]> {
  const out: T[] = [];
  for await (const item of iterable) {
    out.push(item);
    if (out.length >= max) break;
  }
  return out;
}
