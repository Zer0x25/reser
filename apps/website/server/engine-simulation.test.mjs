import test from "node:test";
import assert from "node:assert/strict";
import { isLaneSetFree, isPhysicallyGrouped, matchesHours, minimumLanes } from "./domain.mjs";
import { simulateBookingDay } from "./engine-simulation.mjs";
import { blocks, date, demand, reservations, settings } from "./fixtures/engine-day.mjs";

test("full-day synthetic demand simulation is deterministic and never overbooks", () => {
  const results = simulateBookingDay({ date, settings, reservations, blocks, demand });
  assert.deepEqual(simulateBookingDay({ date, settings, reservations, blocks, demand }), results);
  assert.deepEqual(
    results.map((result) => result.policy),
    ["engine", "first_available", "nearest", "compact"],
  );

  for (const result of results) {
    assert.equal(result.acceptedRequests + result.rejectedRequests.length, demand.length);
    assert.equal(
      result.laneHoursSold,
      result.accepted.reduce(
        (sum, booking) => sum + ((booking.endMs - booking.startMs) / 3_600_000) * booking.laneCount,
        0,
      ),
    );
    assert.equal(
      result.revenueClp,
      result.accepted.reduce((sum, booking) => sum + booking.quoteClp, 0),
    );

    const scheduled = [...reservations];
    for (const booking of result.accepted) {
      assert.equal(booking.laneCount, minimumLanes(booking.players));
      assert.ok(booking.lanes.length * 6 >= booking.players);
      assert.equal(isPhysicallyGrouped(booking.lanes), true);
      assert.equal(
        matchesHours(
          booking.startMs,
          booking.endMs + settings.closingMarginMinutes * 60_000,
          settings.weeklyHours,
          settings.exceptions,
        ),
        true,
      );
      assert.equal(
        isLaneSetFree({
          lanes: booking.lanes,
          startMs: booking.startMs,
          endMs: booking.endMs,
          preparationMinutes: settings.preparationMinutes,
          reservations: scheduled,
          blocks,
        }),
        true,
        `${result.policy} assigned a conflicting interval to ${booking.id}`,
      );
      scheduled.push({
        id: `simulation-check-${booking.id}`,
        lanes: booking.lanes,
        startMs: booking.startMs,
        endMs: booking.endMs,
        preparationMinutes: settings.preparationMinutes,
      });
    }

    assert.deepEqual(Object.keys(result.remainingCapacity), [
      "3 pistas · 1 h",
      "2 pistas · 1 h",
      "1 pista · 2 h",
      "1 pista · 1 h",
    ]);
    assert.ok(Object.values(result.remainingCapacity).every(Number.isInteger));
    assert.ok(Object.values(result.remainingCapacity).every((capacity) => capacity >= 0));
  }
});

test("benchmark records the tradeoff between preservation, sales, and time deviation", () => {
  const results = simulateBookingDay({ date, settings, reservations, blocks, demand });
  const summary = Object.fromEntries(
    results.map((result) => [
      result.policy,
      {
        acceptedRequests: result.acceptedRequests,
        rejectedIds: result.rejectedRequests.map((request) => request.id),
        laneHoursSold: result.laneHoursSold,
        revenueClp: result.revenueClp,
        averageDeviationMinutes: result.averageDeviationMinutes,
        remainingCapacity: result.remainingCapacity,
      },
    ]),
  );

  assert.deepEqual(summary, {
    engine: {
      acceptedRequests: 6,
      rejectedIds: ["large-36-b", "large-24", "group-13-b", "group-12", "group-7", "solo-6-b"],
      laneHoursSold: 48,
      revenueClp: 576_000,
      averageDeviationMinutes: 113,
      remainingCapacity: {
        "3 pistas · 1 h": 1,
        "2 pistas · 1 h": 1,
        "1 pista · 2 h": 0,
        "1 pista · 1 h": 5,
      },
    },
    first_available: {
      acceptedRequests: 6,
      rejectedIds: ["large-36-b", "large-24", "group-13-b", "group-12", "group-7", "solo-6-b"],
      laneHoursSold: 48,
      revenueClp: 576_000,
      averageDeviationMinutes: 132,
      remainingCapacity: {
        "3 pistas · 1 h": 1,
        "2 pistas · 1 h": 1,
        "1 pista · 2 h": 0,
        "1 pista · 1 h": 5,
      },
    },
    nearest: {
      acceptedRequests: 7,
      rejectedIds: ["large-36-b", "large-30", "large-24", "group-7", "solo-6-b"],
      laneHoursSold: 43,
      revenueClp: 516_000,
      averageDeviationMinutes: 36,
      remainingCapacity: {
        "3 pistas · 1 h": 1,
        "2 pistas · 1 h": 3,
        "1 pista · 2 h": 0,
        "1 pista · 1 h": 7,
      },
    },
    compact: {
      acceptedRequests: 6,
      rejectedIds: ["large-36-b", "large-24", "group-13-b", "group-12", "group-7", "solo-6-b"],
      laneHoursSold: 48,
      revenueClp: 576_000,
      averageDeviationMinutes: 82,
      remainingCapacity: {
        "3 pistas · 1 h": 1,
        "2 pistas · 1 h": 2,
        "1 pista · 2 h": 0,
        "1 pista · 1 h": 5,
      },
    },
  });
});
