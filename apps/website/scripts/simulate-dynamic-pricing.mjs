import { formatLocalDate, formatLocalTime, localDateTimeToEpoch } from "../server/domain.mjs";
import { simulatePricingScenario } from "../server/pricing-simulation.mjs";

const date = "2026-10-30";
const startMs = localDateTimeToEpoch(`${date}T18:00`);
const endMs = startMs + 60 * 60_000;
const currency = new Intl.NumberFormat("es-CL", {
  style: "currency",
  currency: "CLP",
  maximumFractionDigits: 0,
});
const dynamicPricing = {
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
const settings = {
  preparationMinutes: 10,
  generalRateClpPerLaneHour: 12_000,
  rateBands: [],
  rateExceptions: {},
  promotions: [],
  weeklyHours: Object.fromEntries(
    Array.from({ length: 7 }, (_, weekday) => [String(weekday), { open: "12:00", close: "02:00" }]),
  ),
  exceptions: {},
  dynamicPricing,
};

function makeScenario(label, options = {}) {
  const {
    occupiedLaneCount = 0,
    dynamicOverrides = {},
    budgetRemainingClp = 100_000,
    channel = "web",
    impact = null,
    promotion = null,
    leadTimeHours = 6,
  } = options;
  const scenarioSettings = {
    ...settings,
    promotions: promotion ? [promotion] : [],
    dynamicPricing: { ...dynamicPricing, ...dynamicOverrides },
  };
  const reservations = Array.from({ length: occupiedLaneCount }, (_, index) => ({
    lanes: [index + 1],
    startMs: startMs - 2 * 60 * 60_000,
    endMs: endMs + 2 * 60 * 60_000,
    preparationMinutes: 0,
  }));
  return simulatePricingScenario({
    label,
    settings: scenarioSettings,
    startMs,
    durationMinutes: 60,
    laneCount: 1,
    lanes: [12],
    reservations,
    channel,
    now: startMs - leadTimeHours * 60 * 60_000,
    budgetRemainingClp,
    impact,
  });
}

const scenarios = [
  makeScenario("Baja ocupación", { occupiedLaneCount: 0 }),
  makeScenario("Ocupación media", { occupiedLaneCount: 6 }),
  makeScenario("Ocupación alta", { occupiedLaneCount: 9 }),
  makeScenario("Piso de precio", {
    occupiedLaneCount: 0,
    dynamicOverrides: { floorClpPerLaneHour: 11_000 },
  }),
  makeScenario("Tope absoluto", {
    occupiedLaneCount: 0,
    dynamicOverrides: { maxDiscountClpPerLaneHour: 500 },
  }),
  makeScenario("Presupuesto limitado", { occupiedLaneCount: 0, budgetRemainingClp: 1_000 }),
  makeScenario("Día protegido", {
    occupiedLaneCount: 0,
    dynamicOverrides: { protectedWeekdays: [5] },
  }),
  makeScenario("Desactivado", {
    occupiedLaneCount: 0,
    dynamicOverrides: { mode: "off" },
  }),
  makeScenario("Modo sombra", {
    occupiedLaneCount: 0,
    dynamicOverrides: { mode: "shadow" },
  }),
  makeScenario("Promoción mayor", {
    occupiedLaneCount: 0,
    promotion: {
      name: "Promoción simulada",
      kind: "fixed",
      value: 3_000,
      enabled: true,
      startsAt: startMs - 1,
      endsAt: endMs + 1,
    },
  }),
  makeScenario("Canal no habilitado", { occupiedLaneCount: 0, channel: "phone" }),
  makeScenario("Fuera de anticipación", { occupiedLaneCount: 0, leadTimeHours: 60 }),
  makeScenario("Presupuesto agotado", { occupiedLaneCount: 0, budgetRemainingClp: 0 }),
  makeScenario("Valor futuro protegido", {
    occupiedLaneCount: 9,
    impact: [0, 0],
  }),
];

console.log(
  `Simulación sintética de precios · ${formatLocalDate(startMs)} ${formatLocalTime(startMs)} · Sin reservas ni datos comerciales reales`,
);
console.log(
  "Escenario | Ocupación | Riesgo | Motivo | Oferta potencial | Descuento dinámico | Beneficio aplicado | Origen | Precio final",
);
for (const scenario of scenarios) {
  const { risk, quote } = scenario;
  const occupancy = risk?.signals.occupancyPercent;
  console.log(
    [
      scenario.label,
      occupancy == null ? "—" : `${String(occupancy)}%`,
      risk?.riskPoints ?? "—",
      risk?.reasonCode ?? "sin_cálculo",
      currency.format(quote.dynamic?.potentialDiscountClp ?? 0),
      currency.format(quote.dynamic?.discountClp ?? 0),
      currency.format(quote.discountClp),
      quote.pricingSource,
      currency.format(quote.totalClp),
    ].join(" | "),
  );
}
