import assert from "node:assert/strict";
import test from "node:test";
import { summarizePricingFunnel } from "./pricing-funnel.mjs";

test("pricing funnel counts offers, unique selections, and reservation conversions by quote type", () => {
  const funnel = summarizePricingFunnel([
    { pricingGroup: "dynamic_applied", selectedAt: 200, reservedAt: 300 },
    { pricingGroup: "dynamic_applied", selectedAt: 200, reservedAt: null },
    { pricingGroup: "dynamic_potential", selectedAt: null, reservedAt: null },
    { pricingGroup: "standard", selectedAt: 250, reservedAt: null },
  ]);

  assert.deepEqual(funnel.totals, {
    offeredCount: 4,
    selectedCount: 3,
    reservedCount: 1,
    confirmedCount: 0,
    paidCount: 0,
    verifiedRevenueClp: 0,
    contractedLaneHours: 0,
    revenuePerLaneHourClp: null,
  });
  assert.deepEqual(funnel.byPricingGroup, [
    {
      pricingGroup: "dynamic_applied",
      offeredCount: 2,
      selectedCount: 2,
      reservedCount: 1,
      confirmedCount: 0,
      paidCount: 0,
      verifiedRevenueClp: 0,
      contractedLaneHours: 0,
      revenuePerLaneHourClp: null,
    },
    {
      pricingGroup: "dynamic_potential",
      offeredCount: 1,
      selectedCount: 0,
      reservedCount: 0,
      confirmedCount: 0,
      paidCount: 0,
      verifiedRevenueClp: 0,
      contractedLaneHours: 0,
      revenuePerLaneHourClp: null,
    },
    {
      pricingGroup: "standard",
      offeredCount: 1,
      selectedCount: 1,
      reservedCount: 0,
      confirmedCount: 0,
      paidCount: 0,
      verifiedRevenueClp: 0,
      contractedLaneHours: 0,
      revenuePerLaneHourClp: null,
    },
  ]);
});

test("a reservation implies a selected quote and unknown quote types remain countable", () => {
  const funnel = summarizePricingFunnel([
    { pricingGroup: "legacy", selectedAt: null, reservedAt: 500 },
  ]);

  assert.deepEqual(funnel.totals, {
    offeredCount: 1,
    selectedCount: 1,
    reservedCount: 1,
    confirmedCount: 0,
    paidCount: 0,
    verifiedRevenueClp: 0,
    contractedLaneHours: 0,
    revenuePerLaneHourClp: null,
  });
  assert.deepEqual(funnel.byPricingGroup, [
    {
      pricingGroup: "standard",
      offeredCount: 1,
      selectedCount: 1,
      reservedCount: 1,
      confirmedCount: 0,
      paidCount: 0,
      verifiedRevenueClp: 0,
      contractedLaneHours: 0,
      revenuePerLaneHourClp: null,
    },
  ]);
});

test("confirmed quotes count current verified payments per contracted lane-hour", () => {
  const funnel = summarizePricingFunnel([
    {
      pricingGroup: "dynamic_applied",
      reservedAt: 100,
      confirmedAt: 200,
      reservationId: "paid-reservation",
      commercialStatus: "finished",
      financialStatus: "paid",
      verifiedRevenueClp: 9600,
      laneCount: 1,
      startMs: 0,
      endMs: 3_600_000,
    },
    {
      pricingGroup: "standard",
      reservedAt: 100,
      confirmedAt: 200,
      reservationId: "partially-paid-reservation",
      commercialStatus: "confirmed",
      financialStatus: "partially_paid",
      verifiedRevenueClp: 4000,
      laneCount: 2,
      startMs: 0,
      endMs: 5_400_000,
    },
    {
      pricingGroup: "dynamic_potential",
      reservedAt: 100,
      confirmedAt: 200,
      reservationId: "cancelled-reservation",
      commercialStatus: "cancelled",
      financialStatus: "paid",
      verifiedRevenueClp: 5000,
      laneCount: 4,
      startMs: 0,
      endMs: 3_600_000,
    },
  ]);

  assert.deepEqual(funnel.totals, {
    offeredCount: 3,
    selectedCount: 3,
    reservedCount: 3,
    confirmedCount: 3,
    paidCount: 1,
    verifiedRevenueClp: 13_600,
    contractedLaneHours: 4,
    revenuePerLaneHourClp: 3400,
  });
  assert.equal(
    funnel.byPricingGroup.find((group) => group.pricingGroup === "dynamic_applied")
      .revenuePerLaneHourClp,
    9600,
  );
  assert.equal(
    funnel.byPricingGroup.find((group) => group.pricingGroup === "dynamic_potential")
      .revenuePerLaneHourClp,
    null,
  );
});
