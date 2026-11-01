import { describe, expect, it } from "vitest";
import { Aurea, idempotencyKey, paginateOffset, paginatePages, paginateSkip } from "../src/index";

/** The README's quickstart, as written there, against a fake API: it compiles and makes the calls the docs list. */
describe("README quickstart", () => {
  it("runs the six steps", async () => {
    const seen: string[] = [];
    const answer = (status: number, body: unknown) =>
      new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    const fetch = async (url: string, init: RequestInit = {}) => {
      const { pathname, search } = new URL(url);
      const headers = new Headers(init.headers);
      seen.push(`${init.method} ${pathname}${search} ${headers.has("x-signature") ? "signed" : headers.get("authorization") ? "bearer" : "-"}`);
      if (pathname === "/v1/auth/register") return answer(201, { accessToken: "EXAMPLE_token", refreshToken: "r", expiresIn: 900, user: { id: "u1" } });
      if (pathname === "/v1/tokens/meta/chains") return answer(200, { chains: [{ id: "base", name: "Base", chainId: 84532 }] });
      if (pathname === "/v1/wallets/" && init.method === "POST") return answer(201, { id: "w1", chain: "base", address: "0xabc", isTestnet: true });
      if (pathname === "/v1/wallets/w1/balance") return answer(200, { walletId: "w1", nativeBalance: { balance: "0.05", symbol: "ETH", decimals: 18 } });
      if (pathname === "/v1/transactions/") return answer(201, { id: "t1", status: "pending" });
      if (pathname === "/v1/transactions/t1/status") return answer(200, { id: "t1", status: "confirmed", confirmations: 3 });
      return answer(404, { message: "not found" });
    };

    const aurea = new Aurea({ apiKey: "ak_live_EXAMPLE_key", apiSecret: "as_EXAMPLE_secret", fetch });
    const { accessToken } = await aurea.auth.v1AuthRegisterPost({
      v1AuthRegisterPostRequest: { username: "quickstart_alice", email: "alice@example.com", password: "SecurePass123" },
    });
    const user = aurea.withAccessToken(accessToken!);
    const { chains } = await user.tokens.v1TokensMetaChainsGet({ isTestnet: "true" });
    const wallet = await user.wallets.v1WalletsPost({
      v1WalletsPostRequest: { chain: chains![0].id!, isTestnet: true, name: "Quickstart" },
    });
    const balance = await user.wallets.v1WalletsIdBalanceGet({ id: wallet.id! });
    const key = idempotencyKey();
    const tx = await user.transactions.v1TransactionsPost({
      idempotencyKey: key,
      v1TransactionsPostRequest: {
        walletId: wallet.id!,
        toAddress: "0x52908400098527886E0F7030069857D2E4169EE7",
        amount: "1000000000000000",
      },
    });
    const status = await user.transactions.v1TransactionsIdStatusGet({ id: tx.id! });

    expect(balance.walletId).toBe("w1");
    expect(status.status).toBe("confirmed");
    expect(seen).toEqual([
      "POST /v1/auth/register signed",
      "GET /v1/tokens/meta/chains?isTestnet=true bearer",
      "POST /v1/wallets/ bearer",
      "GET /v1/wallets/w1/balance bearer",
      "POST /v1/transactions/ bearer",
      "GET /v1/transactions/t1/status bearer",
    ]);
  });

  it("the pagination examples type-check against the generated methods", () => {
    const user = new Aurea({ accessToken: "EXAMPLE", fetch: async () => new Response("{}") });
    // Not iterated: only checks that the README's calls compile.
    void paginateOffset((p) => user.wallets.v1WalletsGet(p), { limit: 100 });
    void paginatePages((p) => user.transactions.v1TransactionsGet(p), { limit: 100 });
    void paginateSkip((p) => user.notifications.v1NotificationsInboxGet(p));
  });
});
