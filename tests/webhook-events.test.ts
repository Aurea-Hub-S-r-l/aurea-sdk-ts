import { describe, expect, it } from "vitest";
import {
  V1AdminTenantsIdWebhookEndpointsGet200ResponseEventTypesInnerTypeEnum,
  V1AdminTenantsIdWebhookEndpointsPostRequestEventTypesEnum,
} from "../src/index";

/** The webhook endpoints' event types (docs › Webhooks & Events, Remittance › Payout Events). */
describe("webhook event types", () => {
  it("name every Remittance payout event, the return included (0.3.1)", () => {
    const remittance = Object.values(V1AdminTenantsIdWebhookEndpointsPostRequestEventTypesEnum).filter((t) =>
      t.startsWith("remittance.payout."),
    );
    expect(remittance).toEqual([
      "remittance.payout.requested",
      "remittance.payout.approved",
      "remittance.payout.rejected",
      "remittance.payout.expired",
      "remittance.payout.cancelled",
      "remittance.payout.submitted",
      "remittance.payout.completed",
      "remittance.payout.failed",
      "remittance.payout.returned",
    ]);
    expect(Object.values(V1AdminTenantsIdWebhookEndpointsGet200ResponseEventTypesInnerTypeEnum)).toContain(
      "remittance.payout.returned",
    );
  });
});
