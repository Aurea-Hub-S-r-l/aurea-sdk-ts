import { describe, expect, it } from "vitest";
import { collect, paginateOffset, paginatePages, paginateSkip } from "../src/pagination";

const range = (from: number, to: number) => Array.from({ length: Math.max(0, to - from) }, (_, i) => from + i);

describe("pagination — docs › Pagination", () => {
  it("offset: follows pagination.hasMore", async () => {
    const total = 7;
    const calls: Array<{ limit: number; offset: number }> = [];
    const items = await collect(
      paginateOffset(async ({ limit, offset }) => {
        calls.push({ limit, offset });
        return { data: range(offset, Math.min(offset + limit, total)), pagination: { total, limit, offset, hasMore: offset + limit < total } };
      }, { limit: 3 }),
    );
    expect(items).toEqual(range(0, 7));
    expect(calls).toEqual([{ limit: 3, offset: 0 }, { limit: 3, offset: 3 }, { limit: 3, offset: 6 }]);
  });

  it("offset: without hasMore, stops at total (bank ramp deposits)", async () => {
    const total = 5;
    let n = 0;
    const items = await collect(
      paginateOffset(async ({ limit, offset }) => {
        n++;
        return { deposits: range(offset, Math.min(offset + limit, total)), total, limit, offset };
      }, { limit: 2 }),
    );
    expect(items).toEqual(range(0, 5));
    expect(n).toBe(3);
  });

  it("page: follows pagination.totalPages", async () => {
    const pages: number[] = [];
    const items = await collect(
      paginatePages(async ({ page, limit }) => {
        pages.push(page);
        return { data: [`p${page}a`, `p${page}b`], pagination: { page, limit, total: 6, totalPages: 3 } };
      }, { limit: 2 }),
    );
    expect(pages).toEqual([1, 2, 3]);
    expect(items).toHaveLength(6);
  });

  it("page: reads totalPages at the top level (payouts)", async () => {
    const items = await collect(
      paginatePages(async ({ page }) => ({ payouts: [page], total: 2, page, limit: 1, totalPages: 2 }), { limit: 1 }),
    );
    expect(items).toEqual([1, 2]);
  });

  it("skip: the inbox's { notifications, total }", async () => {
    const all = range(0, 5);
    const items = await collect(
      paginateSkip(async ({ limit, skip }) => ({ notifications: all.slice(skip, skip + limit), total: all.length }), { limit: 2 }),
    );
    expect(items).toEqual(all);
  });

  it("stops on an empty page and at maxPages", async () => {
    let n = 0;
    await collect(paginateOffset(async () => (n++, { data: [], pagination: { hasMore: true } })));
    expect(n).toBe(1);
    let m = 0;
    await collect(paginatePages(async () => (m++, { data: [1], pagination: { totalPages: 1000 } }), { maxPages: 4 }));
    expect(m).toBe(4);
  });

  it("takes a custom items picker, and collect() stops at max", async () => {
    const items = await collect(
      paginateOffset(async ({ offset }) => ({ result: { rows: [offset] }, pagination: { hasMore: true } }), { limit: 1, items: (p) => p.result.rows }),
      3,
    );
    expect(items).toEqual([0, 1, 2]);
  });
});
