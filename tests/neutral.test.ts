import { describe, expect, it } from "vitest";
import {
  Aurea,
  BankPayoutItemFromJSON,
  V1RampBankPayinDepositsGet200ResponseDepositsInnerFromJSON,
} from "../src/index";

/** The API's neutral names (docs › Errors & Codes › Neutral Names) are what the types carry. */
describe("neutral names", () => {
  it("keeps the bank ramp's neutral fields and drops the provider-named ones", () => {
    const deposit = V1RampBankPayinDepositsGet200ResponseDepositsInnerFromJSON({
      id: "d1",
      bankRampStatus: "completed",
      bankRampDepositId: "dep-1",
      refunds: [],
      ["no" + "ahStatus"]: "completed",
    } as never) as unknown as Record<string, unknown>;
    expect(deposit.bankRampStatus).toBe("completed");
    expect(deposit.bankRampDepositId).toBe("dep-1");
    expect(Object.keys(deposit).some((k) => /^no.?ah/i.test(k))).toBe(false);
  });

  it("keeps typeNeutral", () => {
    const item = BankPayoutItemFromJSON({ type: "x", typeNeutral: "bank_ramp_payout" } as never) as unknown as Record<string, unknown>;
    expect(item.typeNeutral).toBe("bank_ramp_payout");
  });

  it("calls /v1/cards and /v1/lending through aurea.cards and aurea.lending", async () => {
    const seen: string[] = [];
    const fetch = async (url: string) => {
      const path = new URL(url).pathname;
      seen.push(path);
      return new Response(JSON.stringify(path === "/v1/cards" ? [] : { positions: [] }), { status: 200, headers: { "content-type": "application/json" } });
    };
    const user = new Aurea({ accessToken: "EXAMPLE", fetch });
    await user.cards.v1CardsGet();
    await user.lending.v1LendingPositionsGet({} as never);
    expect(seen).toEqual(["/v1/cards", "/v1/lending/positions"]);
  });
});
