import test from "node:test";
import assert from "node:assert/strict";
import { calculateQuote, localDateTimeToEpoch } from "./domain.mjs";
import { simulatePricingScenario } from "./pricing-simulation.mjs";

const HOUR_MS = 60 * 60_000;
const startMs = localDateTimeToEpoch("2026-10-30T18:00");
const endMs = startMs + HOUR_MS;
const baseDynamicPricing = {
  mode: "active",
  configVersion: 1,
  floorClpPerLaneHour: 8_000,
  maxDiscountPercent: 30,
  maxDiscountClpPerLaneHour: 3_000,
  advanceWindowHours: 48,
  lowOccupancyThresholdPercent: 50,
  mediumOccupancyThresholdPercent: 70,
  riskTiers: [{ minPoints: 3, discountPercent: 20 }],
  protectedWeekdays: [],
  protectedBands: [],
  protectedDates: [],
  dailyDiscountBudgetClp: 100_000,
  quoteTtlMinutes: 20,
  channels: ["web"],
  pilot: { weekdays: [], bands: [] },
};
const baseSettings = {
  preparationMinutes: 10,
  generalRateClpPerLaneHour: 12_000,
  rateBands: [],
  rateExceptions: {},
  promotions: [],
  weeklyHours: Object.fromEntries(
    Array.from({ length: 7 }, (_, weekday) => [String(weekday), { open: "12:00", close: "02:00" }]),
  ),
  exceptions: {},
  dynamicPricing: baseDynamicPricing,
};

function scenario(label, options = {}) {
  const {
    occupiedLaneCount = 0,
    dynamicOverrides = {},
    budgetRemainingClp = 100_000,
    channel = "web",
    impact = null,
    promotion = null,
    leadTimeHours = 6,
  } = options;
  const reservations = Array.from({ length: occupiedLaneCount }, (_, index) => ({
    lanes: [index + 1],
    startMs: startMs - 2 * HOUR_MS,
    endMs: endMs + 2 * HOUR_MS,
    preparationMinutes: 0,
  }));
  return simulatePricingScenario({
    label,
    settings: {
      ...baseSettings,
      promotions: promotion ? [promotion] : [],
      dynamicPricing: { ...baseDynamicPricing, ...dynamicOverrides },
    },
    startMs,
    durationMinutes: 60,
    laneCount: 1,
    lanes: [12],
    reservations,
    channel,
    now: startMs - leadTimeHours * HOUR_MS,
    budgetRemainingClp,
    impact,
  });
}

test("simulated occupancy, protections, budget, floor, promotion, and quote modes", () => {
  const low = scenario("Baja ocupación");
  assert.equal(low.risk.signals.occupancyPercent, 0);
  assert.equal(low.risk.eligible, true);
  assert.equal(low.risk.riskPoints, 3);
  assert.equal(low.quote.dynamic.potentialDiscountClp, 2_400);
  assert.equal(low.quote.dynamic.discountClp, 2_400);
  assert.equal(low.quote.totalClp, 9_600);
  assert.equal(low.quote.pricingSource, "dynamic");

  const medium = scenario("Ocupación media", { occupiedLaneCount: 6 });
  assert.equal(medium.risk.signals.occupancyPercent, 50);
  assert.equal(medium.risk.eligible, false);
  assert.equal(medium.risk.reasonCode, "risk_below_threshold");
  assert.equal(medium.quote.totalClp, 12_000);

  const high = scenario("Ocupación alta", { occupiedLaneCount: 9 });
  assert.equal(high.risk.signals.occupancyPercent, 75);
  assert.equal(high.risk.eligible, false);
  assert.equal(high.quote.dynamic.discountClp, 0);

  const floorLimited = scenario("Piso", {
    dynamicOverrides: { floorClpPerLaneHour: 11_000 },
  });
  assert.equal(floorLimited.quote.dynamic.potentialDiscountClp, 1_000);
  assert.equal(floorLimited.quote.totalClp, 11_000);

  const absoluteLimited = scenario("Tope absoluto", {
    dynamicOverrides: { maxDiscountClpPerLaneHour: 500 },
  });
  assert.equal(absoluteLimited.quote.dynamic.potentialDiscountClp, 500);
  assert.equal(absoluteLimited.quote.totalClp, 11_500);

  const budgetLimited = scenario("Presupuesto", { budgetRemainingClp: 1_000 });
  assert.equal(budgetLimited.risk.eligible, true);
  assert.equal(budgetLimited.quote.dynamic.potentialDiscountClp, 1_000);
  assert.equal(budgetLimited.quote.totalClp, 11_000);

  const exhausted = scenario("Presupuesto agotado", { budgetRemainingClp: 0 });
  assert.equal(exhausted.risk.reasonCode, "budget_exhausted");
  assert.equal(exhausted.quote.totalClp, 12_000);

  const protectedDay = scenario("Día protegido", {
    dynamicOverrides: { protectedWeekdays: [5] },
  });
  assert.equal(protectedDay.risk.reasonCode, "protected_weekday");
  assert.equal(protectedDay.quote.totalClp, 12_000);

  const shadow = scenario("Sombra", { dynamicOverrides: { mode: "shadow" } });
  assert.equal(shadow.risk.eligible, true);
  assert.equal(shadow.quote.dynamic.potentialDiscountClp, 2_400);
  assert.equal(shadow.quote.dynamic.applied, false);
  assert.equal(shadow.quote.totalClp, 12_000);

  const disabled = scenario("Desactivado", { dynamicOverrides: { mode: "off" } });
  assert.equal(disabled.risk, null);
  assert.equal(disabled.quote.dynamic, null);
  assert.equal(disabled.quote.totalClp, 12_000);

  const promotion = scenario("Promoción", {
    promotion: {
      name: "Promoción simulada",
      kind: "fixed",
      value: 3_000,
      enabled: true,
      startsAt: startMs - 1,
      endsAt: endMs + 1,
    },
  });
  assert.equal(promotion.quote.dynamic.applied, false);
  assert.equal(promotion.quote.discountClp, 3_000);
  assert.equal(promotion.quote.totalClp, 9_000);
  assert.equal(promotion.quote.pricingSource, "promotion");

  const wrongChannel = scenario("Canal", { channel: "phone" });
  assert.equal(wrongChannel.risk.reasonCode, "channel_not_enabled");
  assert.equal(wrongChannel.quote.totalClp, 12_000);

  const outsideWindow = scenario("Anticipación", { leadTimeHours: 60 });
  assert.equal(outsideWindow.risk.reasonCode, "outside_advance_window");
  assert.equal(outsideWindow.quote.totalClp, 12_000);

  const futureValue = scenario("Valor futuro", {
    occupiedLaneCount: 9,
    impact: [0, 0],
  });
  assert.equal(futureValue.risk.reasonCode, "future_value");
  assert.equal(futureValue.quote.totalClp, 12_000);
});

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

test("2,000 seeded price simulations preserve every dynamic discount limit", () => {
  const random = seededRandom(0xd1a0_2026);
  const durations = [60, 120, 180];

  for (let index = 0; index < 2_000; index += 1) {
    const rate = integer(random, 1, 60_000);
    const laneCount = integer(random, 1, 12);
    const durationMinutes = durations[integer(random, 0, durations.length - 1)];
    const hours = durationMinutes / 60;
    const catalogTotal = rate * laneCount * hours;
    const floor = integer(random, 1, rate);
    const maximumPercent = integer(random, 1, 100);
    const maximumAbsolute = random() < 0.5 ? null : integer(random, 1, rate * 2);
    const budget = integer(random, 0, catalogTotal * 2);
    const tierPercent = integer(random, 1, 100);
    const mode = random() < 0.15 ? "shadow" : "active";
    const start = localDateTimeToEpoch("2026-10-30T18:00");
    const end = start + durationMinutes * 60_000;
    const promotion =
      random() < 0.65
        ? {
            name: "Beneficio sintético",
            kind: random() < 0.5 ? "percent" : "fixed",
            value: 0,
            enabled: true,
            startsAt: start - 1,
            endsAt: end + 1,
          }
        : null;
    if (promotion)
      promotion.value =
        promotion.kind === "percent"
          ? integer(random, 0, 100)
          : integer(random, 0, Math.max(1, Math.ceil(catalogTotal * 1.5)));

    const settings = {
      ...baseSettings,
      generalRateClpPerLaneHour: rate,
      promotions: promotion ? [promotion] : [],
      dynamicPricing: {
        ...baseDynamicPricing,
        mode,
        floorClpPerLaneHour: floor,
        maxDiscountPercent: maximumPercent,
        maxDiscountClpPerLaneHour: maximumAbsolute,
      },
    };
    const risk = {
      eligible: true,
      riskPoints: integer(random, 1, 10),
      tier: { minPoints: 1, discountPercent: tierPercent },
      reasonCode: "synthetic_property_scenario",
      reason: "Escenario sintético determinista",
      signals: { budgetRemainingClp: budget },
      configVersion: 1,
      mode,
      show: mode === "active",
      ruleVersion: "bounded-orphan-risk-v1",
    };
    const quote = calculateQuote({
      startMs: start,
      durationMinutes,
      laneCount,
      settings,
      risk,
    });
    const dynamic = quote.dynamic;
    const maxByFloor = Math.max(0, catalogTotal - Math.ceil(floor * laneCount * hours));
    const maxByPercent = Math.floor((catalogTotal * maximumPercent) / 100);
    const maxByAbsolute =
      maximumAbsolute == null
        ? Number.MAX_SAFE_INTEGER
        : Math.floor(maximumAbsolute * laneCount * hours);
    const promotionDiscount = quote.promotionDiscountClp;
    const dynamicDiscount = dynamic.applied ? dynamic.discountClp : 0;

    assert.equal(quote.baseClp, catalogTotal, `catalog total in simulation ${index}`);
    assert.ok(Number.isSafeInteger(quote.totalClp), `integer total in simulation ${index}`);
    assert.ok(quote.totalClp >= 0 && quote.totalClp <= catalogTotal, `bounded quote ${index}`);
    assert.ok(dynamic.potentialDiscountClp >= 0, `nonnegative offer ${index}`);
    assert.ok(dynamic.potentialDiscountClp <= maxByFloor, `floor cap in simulation ${index}`);
    assert.ok(
      dynamic.potentialDiscountClp <= maxByPercent,
      `percentage cap in simulation ${index}`,
    );
    assert.ok(dynamic.potentialDiscountClp <= maxByAbsolute, `absolute cap in simulation ${index}`);
    assert.ok(dynamic.potentialDiscountClp <= budget, `budget cap in simulation ${index}`);
    assert.equal(dynamic.totalAfterDiscountClp, catalogTotal - dynamic.potentialDiscountClp);
    assert.equal(
      dynamic.applied,
      mode === "active" && dynamic.potentialDiscountClp > promotionDiscount,
    );
    assert.equal(quote.discountClp, Math.max(promotionDiscount, dynamicDiscount));
    assert.equal(quote.totalClp, catalogTotal - quote.discountClp);
    if (dynamic.applied) assert.ok(quote.totalClp >= dynamic.floorTotalClp);
  }
});

test("pricing simulator rejects malformed synthetic inputs", () => {
  assert.throws(
    () => simulatePricingScenario({ settings: null, startMs, durationMinutes: 60 }),
    /configuración de tarifas/,
  );
  assert.throws(
    () => simulatePricingScenario({ settings: baseSettings, startMs: 0 }),
    /inicio válido/,
  );
  assert.throws(
    () => simulatePricingScenario({ settings: baseSettings, startMs, durationMinutes: 0 }),
    /duración simulada/,
  );
  assert.throws(
    () => simulatePricingScenario({ settings: baseSettings, startMs, laneCount: 2 }),
    /pistas simuladas/,
  );
});
