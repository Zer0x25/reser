import test from "node:test";
import assert from "node:assert/strict";
import {
  calculateQuote,
  chooseClosest,
  chooseCompact,
  chooseFirstAvailable,
  formatLocalTime,
  findAlternatives,
  isLaneSetFree,
  isPhysicallyGrouped,
  laneSetsFor,
  localDateTimeToEpoch,
  matchesHours,
  minimumLanes,
} from "./domain.mjs";

const hours = Object.fromEntries(
  Array.from({ length: 7 }, (_, day) => [String(day), { open: "16:00", close: "23:00" }]),
);
const settings = {
  preparationMinutes: 10,
  startIntervalMinutes: 10,
  minimumAdvanceMinutes: 0,
  allowImmediateWeb: true,
  generalRateClpPerLaneHour: 12000,
  rateBands: [],
  rateExceptions: {},
  promotions: [],
  weeklyHours: hours,
  exceptions: {},
};

function comparePreservationScores(a, b) {
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return 0;
}

test("capacity and physical pairs are explicit", () => {
  assert.equal(minimumLanes(6), 1);
  assert.equal(minimumLanes(7), 2);
  assert.equal(minimumLanes(12), 2);
  assert.equal(minimumLanes(13), 3);
  assert.equal(minimumLanes(18), 3);
  assert.throws(() => minimumLanes(0), /1 y 72/);
  assert.throws(() => minimumLanes(73), /1 y 72/);
  assert.deepEqual(laneSetsFor(4, 0), []);
  assert.deepEqual(
    laneSetsFor(7, 2, false).map((lanes) => lanes[0]),
    [1, 3, 5, 7, 9, 11],
  );
  assert.equal(isPhysicallyGrouped([1, 2, 3]), true);
  assert.equal(isPhysicallyGrouped([1, 5, 9]), false);
  assert.equal(
    laneSetsFor(13, 3, false).some((lanes) => lanes.join(",") === "1,3,5"),
    true,
  );
  assert.equal(
    laneSetsFor(13, 3, false).some((lanes) => lanes.join(",") === "1,5,9"),
    false,
  );
  assert.equal(
    laneSetsFor(13, 3, true).some((lanes) => lanes.join(",") === "1,5,9"),
    true,
  );
});

test("lane and venue-wide maintenance blocks reject only the affected inventory", () => {
  const startMs = localDateTimeToEpoch("2026-10-30T18:00");
  const endMs = startMs + 60 * 60_000;
  const isFree = (lanes, blocks) =>
    isLaneSetFree({
      lanes,
      startMs,
      endMs,
      preparationMinutes: 0,
      reservations: [],
      blocks,
    });
  assert.equal(isFree([1], [{ laneId: 1, startMs, endMs }]), false);
  assert.equal(isFree([2], [{ laneId: 1, startMs, endMs }]), true);
  assert.equal(isFree([2], [{ laneId: null, startMs, endMs }]), false);
});

test("date exceptions override weekly hours and CLP half ties round upward", () => {
  const date = "2026-10-30";
  const startMs = localDateTimeToEpoch(`${date}T16:00`);
  assert.equal(matchesHours(startMs, startMs + 60 * 60_000, hours), true);
  assert.equal(
    matchesHours(startMs, startMs + 60 * 60_000, hours, { [date]: { closed: true } }),
    false,
  );
  assert.equal(
    matchesHours(startMs, startMs + 60 * 60_000, hours, {
      [date]: { open: "17:00", close: "23:00" },
    }),
    false,
  );
  const quote = calculateQuote({
    startMs,
    durationMinutes: 30,
    laneCount: 1,
    settings: { ...settings, generalRateClpPerLaneHour: 10001 },
  });
  assert.equal(quote.baseClp, 5001);
});

test("CLP quote prorates across tariff boundaries and chooses one promotion", () => {
  const friday = "2026-10-30";
  const quote = calculateQuote({
    startMs: localDateTimeToEpoch(`${friday}T18:30`),
    durationMinutes: 120,
    laneCount: 2,
    settings: {
      ...settings,
      rateBands: [
        { weekday: 5, start: "17:00", end: "19:00", rateClpPerLaneHour: 10000 },
        { weekday: 5, start: "19:00", end: "21:00", rateClpPerLaneHour: 20000 },
      ],
      promotions: [
        {
          enabled: true,
          name: "10%",
          kind: "percent",
          value: 10,
          startsAt: 0,
          endsAt: Number.MAX_SAFE_INTEGER,
        },
        {
          enabled: true,
          name: "$9.000",
          kind: "fixed",
          value: 9000,
          startsAt: 0,
          endsAt: Number.MAX_SAFE_INTEGER,
        },
      ],
    },
  });
  assert.equal(quote.baseClp, 70000);
  assert.equal(quote.discountClp, 9000);
  assert.equal(quote.totalClp, 61000);
  assert.equal(quote.promotionName, "$9.000");
});

test("a promotion can discount only the eligible portion of a reservation", () => {
  const date = "2026-10-30";
  const start = localDateTimeToEpoch(`${date}T18:30`);
  const quote = calculateQuote({
    startMs: start,
    durationMinutes: 120,
    laneCount: 2,
    settings: {
      ...settings,
      rateBands: [
        { weekday: 5, start: "17:00", end: "19:00", rateClpPerLaneHour: 10000 },
        { weekday: 5, start: "19:00", end: "21:00", rateClpPerLaneHour: 20000 },
      ],
      promotions: [
        {
          enabled: true,
          name: "Una hora",
          kind: "fixed",
          value: 20000,
          startsAt: localDateTimeToEpoch(`${date}T19:00`),
          endsAt: localDateTimeToEpoch(`${date}T20:00`),
        },
      ],
    },
  });
  assert.equal(quote.baseClp, 70000);
  assert.equal(quote.discountClp, 20000);
  assert.equal(quote.totalClp, 50000);
});

test("Santiago local timestamps use the timezone offset in force for that date", () => {
  const summer = localDateTimeToEpoch("2026-12-15T18:10");
  const winter = localDateTimeToEpoch("2026-06-15T18:10");
  assert.equal(summer - winter, 183 * 86_400_000 - 3_600_000);
  assert.equal(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "America/Santiago",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(new Date(summer)),
    "18:10",
  );
});

test("repeated Santiago wall-clock times remain distinct reservable instants", () => {
  const date = "2026-04-04";
  const first = localDateTimeToEpoch(`${date}T23:00`);
  const next = first + 60 * 60_000;
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Santiago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  assert.equal(fmt.format(new Date(first)), fmt.format(new Date(next)));
  const fallBackSettings = {
    ...settings,
    minimumAdvanceMinutes: -1_000_000,
    weeklyHours: { ...hours, 6: { open: "12:00", close: "01:00" } },
  };
  const options = findAlternatives({
    date,
    preferredTime: "23:00",
    players: 4,
    durationMinutes: 60,
    reservations: [],
    blocks: [],
    settings: fallBackSettings,
    limit: 100,
  });
  assert.equal(
    options.some((option) => option.startMs === first),
    true,
  );
  assert.equal(
    options.some((option) => option.startMs === next),
    true,
  );
});

test("overnight sessions stay inside the operating day that opened them", () => {
  const overnightHours = { ...hours, 5: { open: "16:00", close: "01:00" } };
  const start = localDateTimeToEpoch("2026-10-30T23:00");
  const end = localDateTimeToEpoch("2026-10-31T00:00");
  assert.equal(matchesHours(start, end, overnightHours), true);
});

test("overnight availability stays open after midnight when the next weekday is closed", () => {
  const date = "2026-10-31";
  const weeklyHours = {
    ...hours,
    5: { open: "15:00", close: "01:00" },
    6: { closed: true },
  };
  const start = localDateTimeToEpoch(`${date}T00:00`);
  const close = localDateTimeToEpoch(`${date}T01:00`);

  assert.equal(matchesHours(start, close, weeklyHours), true);
  assert.equal(matchesHours(close, close + 60 * 60_000, weeklyHours), false);

  const alternatives = findAlternatives({
    date,
    preferredTime: "00:00",
    players: 4,
    durationMinutes: 60,
    reservations: [],
    blocks: [],
    settings: { ...settings, closingMarginMinutes: 0, weeklyHours },
    limit: 100,
  });
  assert.equal(
    alternatives.some((alternative) => alternative.startMs === start),
    true,
  );
});

test("availability uses whole-hour booking durations independently of start intervals", () => {
  const alternatives = findAlternatives({
    date: "2027-01-08",
    preferredTime: "18:00",
    players: 4,
    durationMinutes: 120,
    reservations: [],
    blocks: [],
    settings: { ...settings, startIntervalMinutes: 10 },
    limit: 100,
  });
  assert.ok(alternatives.length > 0);
  assert.equal(
    alternatives.every((alternative) => alternative.endMs - alternative.startMs === 120 * 60_000),
    true,
  );
  assert.throws(
    () =>
      findAlternatives({
        date: "2027-01-08",
        preferredTime: "18:00",
        players: 4,
        durationMinutes: 70,
        reservations: [],
        blocks: [],
        settings: { ...settings, startIntervalMinutes: 10 },
      }),
    /horas completas/,
  );
});

test("alternatives respect preparation buffers and the optimizer is deterministic", () => {
  const date = "2027-01-08";
  const reservation = {
    id: "existing",
    lanes: [1],
    startMs: localDateTimeToEpoch(`${date}T17:00`),
    endMs: localDateTimeToEpoch(`${date}T18:00`),
    preparationMinutes: 10,
  };
  const options = findAlternatives({
    date,
    preferredTime: "18:00",
    players: 4,
    durationMinutes: 60,
    reservations: [reservation],
    blocks: [],
    settings,
    limit: 10,
  });
  assert.equal(options.length > 0, true);
  assert.equal(
    isLaneSetFree({
      lanes: [1],
      startMs: localDateTimeToEpoch(`${date}T18:00`),
      endMs: localDateTimeToEpoch(`${date}T19:00`),
      preparationMinutes: 10,
      reservations: [reservation],
      blocks: [],
    }),
    false,
  );
  assert.equal(
    options.some((option) => option.startMs === localDateTimeToEpoch(`${date}T18:10`)),
    true,
  );
  assert.deepEqual(
    options,
    findAlternatives({
      date,
      preferredTime: "18:00",
      players: 4,
      durationMinutes: 60,
      reservations: [reservation],
      blocks: [],
      settings,
      limit: 10,
    }),
  );
  const fixture = [
    { startMs: 5, quote: { totalClp: 5000 } },
    { startMs: 1, quote: { totalClp: 6000 } },
    { startMs: 8, quote: { totalClp: 3000 } },
  ];
  assert.equal(chooseFirstAvailable(fixture).startMs, 1);
  assert.equal(chooseClosest(fixture, 7).startMs, 8);
  assert.equal(chooseCompact(fixture).startMs, 1);
});

test("availability scenarios preserve capacity and physical grouping for representative demand", () => {
  const date = "2027-01-08";
  const reservations = [
    {
      id: "scenario-confirmed",
      lanes: [1, 2],
      startMs: localDateTimeToEpoch(`${date}T18:00`),
      endMs: localDateTimeToEpoch(`${date}T19:00`),
      preparationMinutes: settings.preparationMinutes,
    },
  ];
  const blocks = [
    {
      laneId: 12,
      startMs: localDateTimeToEpoch(`${date}T20:00`),
      endMs: localDateTimeToEpoch(`${date}T21:00`),
    },
  ];

  for (const players of [4, 6, 7, 12, 13, 18, 72]) {
    const request = {
      date,
      preferredTime: "18:00",
      players,
      durationMinutes: 60,
      reservations,
      blocks,
      settings,
      limit: 8,
    };
    const options = findAlternatives(request);
    assert.ok(options.length > 0, `${players} players should have a feasible alternative`);
    assert.deepEqual(
      options,
      findAlternatives(request),
      `${players} player results should be deterministic`,
    );

    for (const option of options) {
      assert.equal(option.minimumLanes, minimumLanes(players));
      assert.equal(option.laneCount, minimumLanes(players));
      assert.ok(option.lanes.length * 6 >= players);
      assert.equal(isPhysicallyGrouped(option.lanes), true);
      assert.equal(option.endMs - option.startMs, 60 * 60_000);
      assert.equal(
        matchesHours(
          option.startMs,
          option.endMs + (settings.closingMarginMinutes ?? 0) * 60_000,
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
      );
    }
  }
});

test("five and ten minute preparation buffers produce the expected next bookable start", () => {
  const date = "2027-01-08";
  const priorEnd = localDateTimeToEpoch(`${date}T18:00`);
  const blocks = Array.from({ length: 11 }, (_, index) => ({
    laneId: index + 2,
    startMs: priorEnd,
    endMs: localDateTimeToEpoch(`${date}T19:00`),
  }));

  for (const [preparationMinutes, expectedTime] of [
    [5, "18:05"],
    [10, "18:10"],
  ]) {
    const scenarioSettings = { ...settings, preparationMinutes, startIntervalMinutes: 5 };
    const options = findAlternatives({
      date,
      preferredTime: "18:00",
      players: 4,
      durationMinutes: 60,
      reservations: [
        {
          id: `prep-${preparationMinutes}`,
          lanes: [1],
          startMs: localDateTimeToEpoch(`${date}T17:00`),
          endMs: priorEnd,
          preparationMinutes,
        },
      ],
      blocks,
      settings: scenarioSettings,
      limit: 8,
    });
    const closest = chooseClosest(options, priorEnd);

    assert.ok(closest, `${preparationMinutes} minute preparation should leave an option`);
    assert.equal(formatLocalTime(closest.startMs), expectedTime);
    assert.deepEqual(closest.lanes, [1]);
  }
});

test("engine recommendation preserves more future capacity than the nearest-time baseline", () => {
  const date = "2027-01-08";
  const reservations = [
    [1, "18:00", "19:00"],
    [3, "19:00", "20:00"],
    [5, "20:00", "21:00"],
    [6, "20:00", "21:00"],
    [7, "21:00", "22:00"],
  ].map(([lane, start, end], index) => ({
    id: `demand-${index}`,
    lanes: [lane],
    startMs: localDateTimeToEpoch(`${date}T${start}`),
    endMs: localDateTimeToEpoch(`${date}T${end}`),
    preparationMinutes: settings.preparationMinutes,
  }));
  const options = findAlternatives({
    date,
    preferredTime: "18:00",
    players: 4,
    durationMinutes: 60,
    reservations,
    blocks: [],
    settings,
    limit: 100,
  });
  const preferredStart = localDateTimeToEpoch(`${date}T18:00`);
  const bestPreservation = options.reduce((best, option) =>
    !best || comparePreservationScores(option.preservationScore, best.preservationScore) > 0
      ? option
      : best,
  );
  const baselines = [
    ["first available", chooseFirstAvailable(options)],
    ["nearest time", chooseClosest(options, preferredStart)],
    ["simple compaction", chooseCompact(options)],
  ];

  assert.deepEqual(bestPreservation.preservationScore, [5, 5, 2, 5]);
  for (const [name, baseline] of baselines) {
    assert.ok(baseline, `${name} should select a feasible alternative`);
    assert.ok(
      comparePreservationScores(bestPreservation.preservationScore, baseline.preservationScore) >=
        0,
      `engine recommendation should preserve at least as much capacity as ${name}`,
    );
  }
  assert.deepEqual(chooseClosest(options, preferredStart).preservationScore, [3, 3, 1, 3]);
});
