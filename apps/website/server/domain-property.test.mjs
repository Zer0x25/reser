import test from "node:test";
import assert from "node:assert/strict";
import {
  findAlternatives,
  isLaneSetFree,
  isPhysicallyGrouped,
  localDateTimeToEpoch,
  matchesHours,
  minimumLanes,
} from "./domain.mjs";

function seededRandom(seed) {
  let value = seed >>> 0;
  return () => {
    value = (Math.imul(value, 1_664_525) + 1_013_904_223) >>> 0;
    return value / 0x1_0000_0000;
  };
}

function integer(random, min, max) {
  return min + Math.floor(random() * (max - min + 1));
}

function sampleLanes(random, count) {
  const lanes = Array.from({ length: 12 }, (_, index) => index + 1);
  for (let index = lanes.length - 1; index > 0; index -= 1) {
    const other = integer(random, 0, index);
    [lanes[index], lanes[other]] = [lanes[other], lanes[index]];
  }
  return lanes.slice(0, count).sort((a, b) => a - b);
}

function independentlyGrouped(lanes) {
  if (lanes.length <= 1) return true;
  if (lanes.length === 2) return Math.floor((lanes[0] - 1) / 2) === Math.floor((lanes[1] - 1) / 2);
  const position = (lane) => ({ column: Math.floor((lane - 1) / 2), row: (lane - 1) % 2 });
  const reached = new Set([lanes[0]]);
  const queue = [lanes[0]];
  while (queue.length) {
    const current = position(queue.shift());
    for (const lane of lanes) {
      if (reached.has(lane)) continue;
      const candidate = position(lane);
      if (
        Math.abs(current.column - candidate.column) + Math.abs(current.row - candidate.row) ===
        1
      ) {
        reached.add(lane);
        queue.push(lane);
      }
    }
  }
  return reached.size === lanes.length;
}

function overlaps(start, end, otherStart, otherEnd) {
  return start < otherEnd && end > otherStart;
}

const date = "2027-01-08";
const dayStart = localDateTimeToEpoch(`${date}T16:00`);
const weeklyHours = Object.fromEntries(
  Array.from({ length: 7 }, (_, weekday) => [String(weekday), { open: "16:00", close: "23:00" }]),
);
const baseSettings = {
  preparationMinutes: 10,
  closingMarginMinutes: 20,
  startIntervalMinutes: 10,
  minimumAdvanceMinutes: 0,
  allowImmediateWeb: true,
  generalRateClpPerLaneHour: 12_000,
  rateBands: [],
  rateExceptions: {},
  promotions: [],
  weeklyHours,
  exceptions: {},
};

test("physical grouping matches an independent graph traversal for every lane subset", () => {
  for (let mask = 1; mask < 1 << 12; mask += 1) {
    const lanes = Array.from({ length: 12 }, (_, index) => index + 1).filter(
      (lane) => mask & (1 << (lane - 1)),
    );
    assert.equal(
      isPhysicallyGrouped(lanes),
      independentlyGrouped(lanes),
      `physical grouping disagreed for lane set ${lanes.join(",")}`,
    );
  }
});

test("lane conflict detection matches an independent oracle across seeded intervals", () => {
  const random = seededRandom(0x5eed_1234);
  for (let scenario = 0; scenario < 5_000; scenario += 1) {
    const reservations = Array.from({ length: integer(random, 0, 12) }, (_, index) => {
      const startMs = dayStart + integer(random, 0, 600) * 60_000;
      const durationMinutes = integer(random, 3, 24) * 10;
      return {
        id: `seed-${scenario}-reservation-${index}`,
        lanes: sampleLanes(random, integer(random, 1, 4)),
        startMs,
        endMs: startMs + durationMinutes * 60_000,
        preparationMinutes: integer(random, 0, 30),
      };
    });
    const blocks = Array.from({ length: integer(random, 0, 5) }, (_, index) => {
      const startMs = dayStart + integer(random, 0, 600) * 60_000;
      return {
        id: `seed-${scenario}-block-${index}`,
        laneId: random() < 0.12 ? null : integer(random, 1, 12),
        startMs,
        endMs: startMs + integer(random, 1, 18) * 10 * 60_000,
      };
    });
    const lanes = sampleLanes(random, integer(random, 1, 6));
    const startMs = dayStart + integer(random, 0, 600) * 60_000;
    const endMs = startMs + integer(random, 6, 24) * 10 * 60_000;
    const preparationMinutes = integer(random, 0, 30);
    const occupiedEnd = endMs + preparationMinutes * 60_000;
    const expected = lanes.every(
      (lane) =>
        !blocks.some(
          (block) =>
            (block.laneId === null || block.laneId === lane) &&
            overlaps(startMs, occupiedEnd, block.startMs, block.endMs),
        ) &&
        !reservations.some(
          (reservation) =>
            reservation.lanes.includes(lane) &&
            overlaps(
              startMs,
              occupiedEnd,
              reservation.startMs,
              reservation.endMs + reservation.preparationMinutes * 60_000,
            ),
        ),
    );

    assert.equal(
      isLaneSetFree({
        lanes,
        startMs,
        endMs,
        preparationMinutes,
        reservations,
        blocks,
      }),
      expected,
      `conflict detector disagreed in seed 0x5eed1234, scenario ${scenario}`,
    );
  }
});

test("generated availability alternatives preserve every booking invariant", () => {
  const random = seededRandom(0x0b0a_2027);
  for (let scenario = 0; scenario < 18; scenario += 1) {
    const settings = {
      ...baseSettings,
      preparationMinutes: integer(random, 0, 20),
      closingMarginMinutes: integer(random, 0, 30),
      startIntervalMinutes: random() < 0.5 ? 5 : 10,
    };
    const reservations = Array.from({ length: integer(random, 0, 5) }, (_, index) => {
      const startMs = dayStart + integer(random, 0, 360) * 60_000;
      return {
        id: `search-${scenario}-reservation-${index}`,
        lanes: sampleLanes(random, integer(random, 1, 3)),
        startMs,
        endMs: startMs + integer(random, 6, 18) * 10 * 60_000,
        preparationMinutes: integer(random, 0, 20),
      };
    });
    const blocks = Array.from({ length: integer(random, 0, 3) }, (_, index) => {
      const startMs = dayStart + integer(random, 0, 360) * 60_000;
      return {
        id: `search-${scenario}-block-${index}`,
        laneId: random() < 0.15 ? null : integer(random, 1, 12),
        startMs,
        endMs: startMs + integer(random, 3, 12) * 10 * 60_000,
      };
    });
    const players = integer(random, 1, 18);
    const durationMinutes = [60, 120, 180][integer(random, 0, 2)];
    const preferredMinutes = integer(random, 0, 420);
    const preferredTime = `${String(16 + Math.floor(preferredMinutes / 60)).padStart(2, "0")}:${String(preferredMinutes % 60).padStart(2, "0")}`;
    const acceptSeparated = random() < 0.4;
    const request = {
      date,
      preferredTime,
      players,
      durationMinutes,
      acceptSeparated,
      reservations,
      blocks,
      settings,
      limit: 6,
    };
    const alternatives = findAlternatives(request);
    const distinctStarts = new Set(alternatives.map((option) => option.startMs));

    assert.equal(
      distinctStarts.size,
      alternatives.length,
      `duplicate start in scenario ${scenario}`,
    );
    assert.ok(alternatives.length <= request.limit);
    for (const option of alternatives) {
      assert.equal(option.laneCount, minimumLanes(players));
      assert.equal(option.lanes.length, option.laneCount);
      assert.ok(option.lanes.length * 6 >= players);
      assert.equal(option.grouped, isPhysicallyGrouped(option.lanes));
      assert.ok(acceptSeparated || option.grouped);
      assert.equal(option.endMs - option.startMs, durationMinutes * 60_000);
      assert.equal(
        matchesHours(
          option.startMs,
          option.endMs + settings.closingMarginMinutes * 60_000,
          settings.weeklyHours,
          settings.exceptions,
        ),
        true,
      );
      assert.equal(
        isLaneSetFree({
          lanes: option.lanes,
          startMs: option.startMs,
          endMs: option.endMs,
          preparationMinutes: settings.preparationMinutes,
          reservations,
          blocks,
        }),
        true,
        `conflicting search result in seed 0x0b0a2027, scenario ${scenario}`,
      );
    }
  }
});
