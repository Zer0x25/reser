import test from "node:test";
import assert from "node:assert/strict";
import { summarizePricingPerformance } from "./pricing-performance.mjs";

test("pricing performance separates applied discounts, shadow potential, and cancelled bookings", () => {
  const report = summarizePricingPerformance([
    {
      channel: "web",
      commercialStatus: "confirmed",
      quoteClp: 9_600,
      quoteJson: JSON.stringify({
        dynamic: { applied: true, discountClp: 2_400, potentialDiscountClp: 2_400 },
      }),
    },
    {
      channel: "web",
      commercialStatus: "pending_approval",
      quoteClp: 12_000,
      quoteJson: JSON.stringify({
        dynamic: { applied: false, discountClp: 0, potentialDiscountClp: 1_800 },
      }),
    },
    {
      channel: "web",
      commercialStatus: "cancelled",
      quoteClp: 9_600,
      quoteJson: JSON.stringify({
        dynamic: { applied: true, discountClp: 2_400, potentialDiscountClp: 2_400 },
      }),
    },
    {
      channel: "phone",
      commercialStatus: "confirmed",
      quoteClp: 12_000,
      quoteJson: "invalid historical quote",
    },
  ]);

  assert.deepEqual(report.totals, {
    reservationCount: 4,
    confirmedCount: 2,
    pendingCount: 1,
    cancelledCount: 1,
    dynamicAppliedCount: 1,
    dynamicDiscountCommittedClp: 2_400,
    dynamicQuoteTotalClp: 9_600,
    dynamicPotentialNotAppliedCount: 1,
    dynamicPotentialNotAppliedClp: 1_800,
  });
  assert.deepEqual(
    report.byChannel.map(({ channel, reservationCount }) => [channel, reservationCount]),
    [
      ["phone", 1],
      ["web", 3],
    ],
  );
  assert.equal(report.byChannel[1].dynamicDiscountCommittedClp, 2_400);
  assert.equal(report.byChannel[1].dynamicPotentialNotAppliedClp, 1_800);
});
