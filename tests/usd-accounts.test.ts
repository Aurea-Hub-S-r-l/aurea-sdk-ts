import { describe, expect, it } from "vitest";
import { Aurea, V1RampBankCustomerAccountsGet200ResponseFromJSON } from "../src/index";

/** The bank ramp's USD account per customer (docs › Bank Ramp: USD Account per Customer). */
describe("USD accounts", () => {
  const recorder = () => {
    const seen: Array<{ method: string; path: string; search: string; headers: Headers; body: unknown }> = [];
    const fetch = async (url: string, init?: RequestInit) => {
      const u = new URL(url);
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : null;
      seen.push({ method: init?.method ?? "GET", path: u.pathname, search: u.search, headers: new Headers(init?.headers), body });
      const answer = u.pathname.endsWith("/payouts")
        ? { environment: "sandbox", payout: { id: "2f8d6b4a-0c1e-4a3b-9d5f-7e9a1c3b5d70", purpose: "customer_account", amount: "100.00", receiptUrl: null } }
        : { environment: "sandbox", currency: "USD", rail: "usd_account", custody: "custodial", status: "active", capabilities: { collections: "active", payouts: "active" }, requirements: [], nextStep: null, bankDetails: [], balances: [], updatedAt: null };
      return new Response(JSON.stringify(answer), { status: 201, headers: { "content-type": "application/json" } });
    };
    return { seen, fetch };
  };

  it("reads the account and its rail", async () => {
    const { seen, fetch } = recorder();
    const user = new Aurea({ accessToken: "EXAMPLE", fetch });
    const account = await user.bankRampAccounts.v1RampBankCustomerAccountsGet({ isTestnet: true });
    expect(seen[0]).toMatchObject({ method: "GET", path: "/v1/ramp/bank/customer/accounts", search: "?isTestnet=true" });
    expect(account.rail).toBe("usd_account");
    expect(account.nextStep).toBeNull();
  });

  it("keeps the next step and its custody options", () => {
    const account = V1RampBankCustomerAccountsGet200ResponseFromJSON({
      environment: "production", currency: "USD", rail: "none", custody: null, status: null, capabilities: null,
      requirements: [], nextStep: { action: "choose_custody", custodyOptions: ["custodial"] }, bankDetails: [], balances: [], updatedAt: null,
    });
    expect(account.nextStep).toEqual({ action: "choose_custody", custodyOptions: ["custodial"] });
  });

  it("pays out with the idempotency key in its header", async () => {
    const { seen, fetch } = recorder();
    const user = new Aurea({ accessToken: "EXAMPLE", fetch });
    await user.bankRampAccounts.v1RampBankCustomerAccountsPayoutsPost({
      idempotencyKey: "EXAMPLE-key-1",
      v1RampBankCustomerAccountsPayoutsPostRequest: { beneficiaryId: "5e0b7a12-8c3d-4f6e-9a1b-2c4d6e8f0a13", amount: "100.00", isTestnet: true },
    });
    expect(seen[0]).toMatchObject({ method: "POST", path: "/v1/ramp/bank/customer/accounts/payouts" });
    expect(seen[0].headers.get("idempotency-key")).toBe("EXAMPLE-key-1");
    expect(seen[0].body).toEqual({ beneficiaryId: "5e0b7a12-8c3d-4f6e-9a1b-2c4d6e8f0a13", amount: "100.00", isTestnet: true });
  });

  it("reads the profile and the terms through aurea.bankRampUsdAccounts", async () => {
    const seen: string[] = [];
    const fetch = async (url: string) => {
      const path = new URL(url).pathname;
      seen.push(path);
      return new Response(JSON.stringify({ environment: "sandbox", state: "none", nextStep: "complete_profile", url: null, expiresAt: null, acceptedAt: null }), { status: 200, headers: { "content-type": "application/json" } });
    };
    const user = new Aurea({ accessToken: "EXAMPLE", fetch });
    await user.bankRampUsdAccounts.v1RampBankCustomerTermsGet({ isTestnet: true });
    expect(seen).toEqual(["/v1/ramp/bank/customer/terms"]);
  });
});
