import test from "node:test";
import assert from "node:assert/strict";
import {
  buildHistoricalCapacityIntervals,
  summarizeInventoryPerformance,
  summarizeOperationalPerformance,
  summarizePricingPerformance,
} from "./pricing-performance.mjs";
import { localDateTimeToEpoch } from "./domain.mjs";

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
    configurationEstimated: false,
    assignmentEstimated: false,
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

test("historical capacity uses each schedule version at its effective time", () => {
  const fromMs = localDateTimeToEpoch("2026-10-26T16:00");
  const changeAt = fromMs + 2 * 60 * 60_000;
  const toMs = fromMs + 4 * 60 * 60_000;
  const openUntil20 = Object.fromEntries(
    Array.from({ length: 7 }, (_, day) => [String(day), { open: "16:00", close: "20:00" }]),
  );
  const openUntil18 = Object.fromEntries(
    Array.from({ length: 7 }, (_, day) => [String(day), { open: "16:00", close: "18:00" }]),
  );
  const result = buildHistoricalCapacityIntervals({
    fromMs,
    toMs,
    history: [
      {
        effectiveAt: fromMs,
        weeklyHoursJson: JSON.stringify(openUntil20),
        exceptionsJson: "{}",
        activeLaneIdsJson: "[1]",
        preparationMinutes: 10,
        isBaseline: false,
      },
      {
        effectiveAt: changeAt,
        weeklyHoursJson: JSON.stringify(openUntil18),
        exceptionsJson: "{}",
        activeLaneIdsJson: "[1]",
        preparationMinutes: 0,
        isBaseline: false,
      },
    ],
  });

  assert.equal(result.configurationEstimated, false);
  assert.deepEqual(result.intervals, [
    {
      laneId: 1,
      startMs: fromMs,
      endMs: changeAt,
      preparationMinutes: 10,
      minimumSellableMinutes: 70,
      segments: [
        {
          startMs: fromMs,
          endMs: changeAt,
          preparationMinutes: 10,
          minimumSellableMinutes: 70,
        },
      ],
    },
  ]);
});

test("historical capacity reports when the period uses a baseline estimate", () => {
  const fromMs = localDateTimeToEpoch("2026-10-26T16:00");
  const weeklyHours = Object.fromEntries(
    Array.from({ length: 7 }, (_, day) => [String(day), { open: "16:00", close: "20:00" }]),
  );
  const result = buildHistoricalCapacityIntervals({
    fromMs,
    toMs: fromMs + 4 * 60 * 60_000,
    history: [
      {
        effectiveAt: 0,
        weeklyHoursJson: JSON.stringify(weeklyHours),
        exceptionsJson: "{}",
        activeLaneIdsJson: "[1]",
        preparationMinutes: 10,
        isBaseline: true,
      },
    ],
  });

  assert.equal(result.configurationEstimated, true);
  assert.equal(result.intervals[0].startMs, fromMs);
  assert.equal(result.intervals[0].endMs, fromMs + 4 * 60 * 60_000);
});

test("fragmentation respects preparation changes inside a continuous operating window", () => {
  const fromMs = localDateTimeToEpoch("2026-10-26T16:00");
  const changeAt = fromMs + 2 * 60 * 60_000;
  const toMs = fromMs + 4 * 60 * 60_000;
  const weeklyHours = Object.fromEntries(
    Array.from({ length: 7 }, (_, day) => [String(day), { open: "16:00", close: "20:00" }]),
  );
  const historicalCapacity = buildHistoricalCapacityIntervals({
    fromMs,
    toMs,
    history: [
      {
        effectiveAt: fromMs,
        weeklyHoursJson: JSON.stringify(weeklyHours),
        exceptionsJson: "{}",
        activeLaneIdsJson: "[1]",
        preparationMinutes: 10,
        isBaseline: false,
      },
      {
        effectiveAt: changeAt,
        weeklyHoursJson: JSON.stringify(weeklyHours),
        exceptionsJson: "{}",
        activeLaneIdsJson: "[1]",
        preparationMinutes: 0,
        isBaseline: false,
      },
    ],
  });
  const report = summarizeInventoryPerformance({
    fromMs,
    toMs,
    availableIntervals: historicalCapacity.intervals,
    reservations: [
      {
        reservationId: "before-change",
        laneId: 1,
        reservationStartMs: fromMs,
        reservationEndMs: fromMs + 60 * 60_000,
        effectiveEndMs: fromMs + 60 * 60_000,
        allocationStartMs: fromMs,
        allocationEndMs: fromMs + 70 * 60_000,
      },
      {
        reservationId: "after-change",
        laneId: 1,
        reservationStartMs: fromMs + 135 * 60_000,
        reservationEndMs: fromMs + 195 * 60_000,
        effectiveEndMs: fromMs + 195 * 60_000,
        allocationStartMs: fromMs + 135 * 60_000,
        allocationEndMs: fromMs + 195 * 60_000,
      },
    ],
    configurationEstimated: false,
  });

  assert.equal(historicalCapacity.intervals.length, 1);
  assert.equal(historicalCapacity.intervals[0].segments.length, 2);
  assert.equal(report.availableLaneHours, 4);
  assert.equal(report.committedLaneHours, 2);
  assert.equal(report.unbookableGapLaneHours, 1.83);
  assert.equal(report.minimumSellableMinutes, null);
});

test("inventory reports assignment estimates only before assignment history began", () => {
  const fromMs = Date.parse("2026-10-26T16:00:00Z");
  const report = summarizeInventoryPerformance({
    fromMs,
    toMs: fromMs + 2 * 60 * 60_000,
    availableIntervals: [{ laneId: 1, startMs: fromMs, endMs: fromMs + 2 * 60 * 60_000 }],
    reservations: [
      {
        reservationId: "legacy",
        laneId: 1,
        reservationStartMs: fromMs,
        reservationEndMs: fromMs + 60 * 60_000,
        allocationStartMs: fromMs,
        allocationEndMs: fromMs + 70 * 60_000,
        assignmentFromMs: 0,
        assignmentToMs: null,
        assignmentRecordedAt: fromMs + 10 * 60_000,
        assignmentBaseline: 1,
      },
    ],
    configurationEstimated: false,
  });

  assert.equal(report.assignmentEstimated, true);
  assert.equal(report.configurationEstimated, false);
});
