import test from "node:test";
import assert from "node:assert/strict";
import {
  summarizeInventoryPerformance,
  summarizeOperationalPerformance,
  summarizePricingPerformance,
} from "./pricing-performance.mjs";

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

test("operational performance divides net verified revenue by available lane-hours", () => {
  assert.deepEqual(
    summarizeOperationalPerformance({
      verifiedRevenueClp: 25_500,
      availableLaneHours: 2.5,
      activeLaneCount: 12,
    }),
    {
      verifiedRevenueClp: 25_500,
      availableLaneHours: 2.5,
      activeLaneCount: 12,
      revenuePerAvailableLaneHourClp: 10_200,
    },
  );
  assert.equal(
    summarizeOperationalPerformance({
      verifiedRevenueClp: 0,
      availableLaneHours: 0,
      activeLaneCount: 0,
    }).revenuePerAvailableLaneHourClp,
    null,
  );
});

test("inventory performance measures booked hours and unbookable gaps per lane", () => {
  const startMs = Date.parse("2026-10-26T16:00:00Z");
  const report = summarizeInventoryPerformance({
    fromMs: startMs,
    toMs: startMs + 4 * 60 * 60_000,
    availableIntervals: [{ laneId: 1, startMs, endMs: startMs + 4 * 60 * 60_000 }],
    reservations: [
      {
        reservationId: "one",
        laneId: 1,
        reservationStartMs: startMs,
        reservationEndMs: startMs + 60 * 60_000,
        allocationStartMs: startMs,
        allocationEndMs: startMs + 70 * 60_000,
      },
      {
        reservationId: "two",
        laneId: 1,
        reservationStartMs: startMs + 135 * 60_000,
        reservationEndMs: startMs + 195 * 60_000,
        allocationStartMs: startMs + 135 * 60_000,
        allocationEndMs: startMs + 205 * 60_000,
      },
    ],
    minimumSellableMinutes: 70,
  });

  assert.deepEqual(report, {
    reservationCount: 2,
    availableLaneHours: 4,
    committedLaneHours: 2,
    occupancyPercent: 50,
    unbookableGapLaneHours: 1.67,
    unbookableGapPercent: 41.7,
    minimumSellableMinutes: 70,
  });
});

test("inventory performance clips edge gaps to the selected reporting period", () => {
  const startMs = Date.parse("2026-10-26T16:00:00Z");
  const report = summarizeInventoryPerformance({
    fromMs: startMs + 60 * 60_000,
    toMs: startMs + 3 * 60 * 60_000,
    availableIntervals: [{ laneId: 1, startMs, endMs: startMs + 4 * 60 * 60_000 }],
    reservations: [
      {
        reservationId: "one",
        laneId: 1,
        reservationStartMs: startMs,
        reservationEndMs: startMs + 60 * 60_000,
        allocationStartMs: startMs,
        allocationEndMs: startMs + 70 * 60_000,
      },
      {
        reservationId: "two",
        laneId: 1,
        reservationStartMs: startMs + 135 * 60_000,
        reservationEndMs: startMs + 195 * 60_000,
        allocationStartMs: startMs + 135 * 60_000,
        allocationEndMs: startMs + 205 * 60_000,
      },
    ],
    minimumSellableMinutes: 70,
  });

  assert.equal(report.availableLaneHours, 2);
  assert.equal(report.committedLaneHours, 0.75);
  assert.equal(report.occupancyPercent, 37.5);
  assert.equal(report.unbookableGapLaneHours, 1.08);
  assert.equal(report.unbookableGapPercent, 54.2);
  assert.equal(report.reservationCount, 1);
});
