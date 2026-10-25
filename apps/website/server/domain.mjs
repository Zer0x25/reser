import {
  TIME_ZONE,
  formatLocalDate,
  formatLocalTime,
  localDateTimeToEpoch,
  parseLocalDay,
  santiagoParts,
  santiagoWeekday,
} from "../shared/time.mjs";

export {
  TIME_ZONE,
  formatLocalDate,
  formatLocalTime,
  localDateTimeToEpoch,
  parseLocalDay,
  santiagoParts,
  santiagoWeekday,
};

export const LANE_COUNT = 12;
export const MAX_PLAYERS_PER_LANE = 6;
export const DEFAULT_PREPARATION_MINUTES = 10;
export const DYNAMIC_PRICING_MODES = ["off", "shadow", "pilot", "active"];
export const DYNAMIC_PRICING_RULE_VERSION = "bounded-orphan-risk-v1";

export function isWholeHourBookingDuration(durationMinutes) {
  return (
    Number.isSafeInteger(durationMinutes) && durationMinutes >= 60 && durationMinutes % 60 === 0
  );
}

export function minimumLanes(players) {
  if (!Number.isInteger(players) || players < 1 || players > 72)
    throw new Error("Indica entre 1 y 72 jugadores.");
  return Math.ceil(players / MAX_PLAYERS_PER_LANE);
}

export function lanePosition(laneId) {
  return { x: Math.floor((laneId - 1) / 2), y: (laneId - 1) % 2 };
}

function areNeighbors(a, b) {
  const pa = lanePosition(a);
  const pb = lanePosition(b);
  return Math.abs(pa.x - pb.x) + Math.abs(pa.y - pb.y) === 1;
}

export function isPhysicallyGrouped(lanes) {
  if (lanes.length <= 1) return true;
  if (lanes.length === 2) return Math.floor((lanes[0] - 1) / 2) === Math.floor((lanes[1] - 1) / 2);
  const remaining = new Set(lanes.slice(1));
  const reached = new Set([lanes[0]]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const lane of remaining) {
      if ([...reached].some((other) => areNeighbors(lane, other))) {
        reached.add(lane);
        remaining.delete(lane);
        changed = true;
      }
    }
  }
  return remaining.size === 0;
}

export function laneSetsFor(
  players,
  contractedLanes = minimumLanes(players),
  acceptSeparated = false,
) {
  const min = minimumLanes(players);
  if (!Number.isInteger(contractedLanes) || contractedLanes < min || contractedLanes > LANE_COUNT)
    return [];
  const sets = [];
  const visit = (next, current) => {
    if (current.length === contractedLanes) {
      const validTwoLanePair = contractedLanes !== 2 || isPhysicallyGrouped(current);
      if (validTwoLanePair && (acceptSeparated || isPhysicallyGrouped(current))) sets.push(current);
      return;
    }
    for (let lane = next; lane <= LANE_COUNT - (contractedLanes - current.length) + 1; lane += 1)
      visit(lane + 1, [...current, lane]);
  };
  visit(1, []);
  return sets;
}

function shiftLocalDate(date, days) {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

function operatingHoursForDate(date, weeklyHours, exceptions) {
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
  const rule = exceptions?.[date] ?? weeklyHours?.[String(weekday)];
  if (!rule || rule.closed || !rule.open || !rule.close) return false;
  const open = localDateTimeToEpoch(`${date}T${rule.open}`);
  let close = localDateTimeToEpoch(`${date}T${rule.close}`);
  if (close <= open) {
    close = localDateTimeToEpoch(`${shiftLocalDate(date, 1)}T${rule.close}`);
  }
  return { date, rule, openMs: open, closeMs: close };
}

function operatingHoursForInterval(startMs, endMs, weeklyHours, exceptions = {}) {
  const date = formatLocalDate(startMs);
  const windows = [date, shiftLocalDate(date, -1)]
    .map((candidateDate) => operatingHoursForDate(candidateDate, weeklyHours, exceptions))
    .filter(Boolean);
  return windows.find((window) => startMs >= window.openMs && endMs <= window.closeMs) ?? null;
}

export function matchesHours(startMs, endMs, weeklyHours, exceptions = {}) {
  return Boolean(operatingHoursForInterval(startMs, endMs, weeklyHours, exceptions));
}

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;

function clampPercent(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(100, number)) : fallback;
}

function occupancySignals({ startMs, endMs, reservations, blocks }) {
  const windowStart = startMs - 2 * HOUR_MS;
  const windowEnd = endMs + 2 * HOUR_MS;
  const windowMs = windowEnd - windowStart;
  let soldMs = 0;
  for (const reservation of reservations ?? []) {
    const from = Math.max(windowStart, reservation.startMs);
    const to = Math.min(windowEnd, reservation.endMs);
    if (to > from) soldMs += (to - from) * (reservation.lanes?.length ?? 0);
  }
  let blockedMs = 0;
  for (const block of blocks ?? []) {
    const from = Math.max(windowStart, block.startMs);
    const to = Math.min(windowEnd, block.endMs);
    if (to > from) blockedMs += (to - from) * (block.laneId == null ? LANE_COUNT : 1);
  }
  const capacityMs = Math.max(0, LANE_COUNT * windowMs - blockedMs);
  return {
    occupancyPercent: capacityMs > 0 ? Math.round((soldMs / capacityMs) * 100) : 0,
    soldLaneMinutes: Math.round(soldMs / MINUTE_MS),
    capacityLaneMinutes: Math.round(capacityMs / MINUTE_MS),
    windowStartMs: windowStart,
    windowEndMs: windowEnd,
  };
}

function gapSignals({ startMs, endMs, lanes, reservations, blocks, settings }) {
  const preparationMs =
    Number(settings.preparationMinutes ?? DEFAULT_PREPARATION_MINUTES) * MINUTE_MS;
  const minimumUsefulMs = HOUR_MS + preparationMs;
  const day = parseLocalDay(formatLocalDate(startMs));
  const details = [];
  let gapRisk = false;
  let doubleGapRisk = false;
  for (const lane of lanes ?? []) {
    const intervals = [];
    for (const reservation of reservations ?? []) {
      if (!reservation.lanes?.includes(lane)) continue;
      intervals.push({
        startMs: reservation.startMs,
        endMs:
          reservation.endMs +
          Number(reservation.preparationMinutes ?? settings.preparationMinutes ?? 0) * MINUTE_MS,
      });
    }
    for (const block of blocks ?? []) {
      if (block.laneId !== lane && block.laneId != null) continue;
      intervals.push({ startMs: block.startMs, endMs: block.endMs });
    }
    const previous = intervals
      .filter((interval) => interval.endMs <= startMs)
      .sort((a, b) => b.endMs - a.endMs)[0];
    const next = intervals
      .filter((interval) => interval.startMs >= endMs + preparationMs)
      .sort((a, b) => a.startMs - b.startMs)[0];
    const beforeGapMs = startMs - (previous?.endMs ?? day.start);
    const afterGapMs = (next?.startMs ?? day.end) - (endMs + preparationMs);
    const beforeOrphan = beforeGapMs > 0 && beforeGapMs < minimumUsefulMs;
    const afterOrphan = afterGapMs > 0 && afterGapMs < minimumUsefulMs;
    const laneRisk = beforeOrphan || afterOrphan;
    if (laneRisk) gapRisk = true;
    if (beforeOrphan && afterOrphan) doubleGapRisk = true;
    details.push({
      lane,
      beforeGapMinutes: Math.round(beforeGapMs / MINUTE_MS),
      afterGapMinutes: Math.round(afterGapMs / MINUTE_MS),
      orphan: laneRisk,
    });
  }
  return { gapRisk, doubleGapRisk, gapDetails: details };
}

function pilotEligible(config, weekday, localTime) {
  const weekdays = Array.isArray(config.pilot?.weekdays) ? config.pilot.weekdays : [];
  if (weekdays.includes(weekday)) return true;
  return (Array.isArray(config.pilot?.bands) ? config.pilot.bands : []).some(
    (band) => Number(band.weekday) === weekday && localTime >= band.start && localTime < band.end,
  );
}

/**
 * Evaluates whether a concrete free slot is an orphan-risk candidate.
 * It is deliberately deterministic and explainable: no client data, no ML and no
 * price manipulation. The returned object is data; calculateQuote decides the money.
 */
export function evaluateOrphanRisk({
  startMs,
  endMs,
  lanes,
  reservations = [],
  blocks = [],
  settings,
  channel = "web",
  now = Date.now(),
  budgetRemainingClp = Number.MAX_SAFE_INTEGER,
  impact = null,
}) {
  const config = settings?.dynamicPricing;
  if (!config || config.mode === "off" || !DYNAMIC_PRICING_MODES.includes(config.mode)) return null;
  const configVersion = Number(config.configVersion ?? 0);
  const signals = {
    protected: false,
    channelEnabled: false,
    pilotEligible: false,
    occupancyPercent: null,
    leadTimeHours: null,
    gapRisk: false,
    futureValueRisk: false,
    budgetRemainingClp,
  };
  const result = (eligible, riskPoints, tier, reasonCode, reason, extra = {}) => ({
    eligible,
    riskPoints,
    tier,
    reasonCode,
    reason,
    signals: { ...signals, ...extra },
    configVersion,
    mode: config.mode,
    show: config.mode === "active" || config.mode === "pilot",
    ruleVersion: DYNAMIC_PRICING_RULE_VERSION,
  });
  const ineligible = (reasonCode, reason, extra = {}) =>
    result(false, 0, null, reasonCode, reason, extra);
  const date = formatLocalDate(startMs);
  const weekday = santiagoWeekday(startMs);
  const localTime = formatLocalTime(startMs);
  if ((config.protectedDates ?? []).includes(date)) {
    signals.protected = true;
    return ineligible("protected_date", "Fecha protegida por administración", { protected: true });
  }
  if ((config.protectedWeekdays ?? []).map(Number).includes(weekday)) {
    signals.protected = true;
    return ineligible("protected_weekday", "Día protegido por administración", { protected: true });
  }
  if (
    (config.protectedBands ?? []).some(
      (band) => Number(band.weekday) === weekday && localTime >= band.start && localTime < band.end,
    )
  ) {
    signals.protected = true;
    return ineligible("protected_band", "Franja protegida por administración", { protected: true });
  }
  if (config.mode === "pilot" && !pilotEligible(config, weekday, localTime))
    return ineligible("outside_pilot", "Horario fuera del alcance del piloto");
  signals.pilotEligible = config.mode !== "pilot" || pilotEligible(config, weekday, localTime);
  const channels = Array.isArray(config.channels) ? config.channels : [];
  if (!channels.includes(channel))
    return ineligible("channel_not_enabled", "Canal no habilitado para precio dinámico");
  signals.channelEnabled = true;
  if (!Number.isSafeInteger(config.floorClpPerLaneHour) || config.floorClpPerLaneHour <= 0)
    return ineligible("floor_missing", "Falta configurar el piso dinámico");
  if (startMs < now) return ineligible("past_start", "El horario ya comenzó");
  const leadTimeHours = (startMs - now) / HOUR_MS;
  const advanceWindowHours = Number(config.advanceWindowHours);
  if (!Number.isFinite(advanceWindowHours) || leadTimeHours > advanceWindowHours)
    return ineligible("outside_advance_window", "Fuera de la ventana de anticipación configurada", {
      leadTimeHours: Math.round(leadTimeHours * 10) / 10,
    });
  if (budgetRemainingClp <= 0)
    return ineligible("budget_exhausted", "Presupuesto diario de descuento agotado", {
      leadTimeHours: Math.round(leadTimeHours * 10) / 10,
    });
  const occupancy = occupancySignals({ startMs, endMs, reservations, blocks });
  const gaps = gapSignals({
    startMs,
    endMs,
    lanes,
    reservations,
    blocks,
    settings,
  });
  const lowThreshold = clampPercent(config.lowOccupancyThresholdPercent, 50);
  const mediumThreshold = clampPercent(config.mediumOccupancyThresholdPercent, 70);
  const futureValueRisk =
    Array.isArray(impact) &&
    impact[0] === 0 &&
    impact[1] === 0 &&
    occupancy.occupancyPercent >= mediumThreshold;
  Object.assign(signals, occupancy, gaps, {
    leadTimeHours: Math.round(leadTimeHours * 10) / 10,
    futureValueRisk,
  });
  if (futureValueRisk)
    return ineligible("future_value", "El horario compromete capacidad futura valiosa");
  let riskPoints = 0;
  if (occupancy.occupancyPercent < lowThreshold) riskPoints += 2;
  else if (occupancy.occupancyPercent < mediumThreshold) riskPoints += 1;
  if (leadTimeHours <= 24) riskPoints += 1;
  else if (leadTimeHours <= 48 && occupancy.occupancyPercent < lowThreshold) riskPoints += 1;
  if (gaps.gapRisk) riskPoints += 1;
  if (gaps.doubleGapRisk) riskPoints += 1;
  const tiers = (Array.isArray(config.riskTiers) ? config.riskTiers : [])
    .filter(
      (tier) =>
        Number.isSafeInteger(tier.minPoints) &&
        tier.minPoints >= 1 &&
        Number.isSafeInteger(tier.discountPercent) &&
        tier.discountPercent > 0,
    )
    .sort((a, b) => b.minPoints - a.minPoints);
  const tier = tiers.find((candidate) => riskPoints >= candidate.minPoints) ?? null;
  if (!tier)
    return result(
      false,
      riskPoints,
      null,
      "risk_below_threshold",
      "Riesgo insuficiente para un descuento",
    );
  const reasonCode = gaps.gapRisk
    ? "gap_fill"
    : leadTimeHours <= 24
      ? "last_minute"
      : "low_occupancy";
  const reason =
    reasonCode === "gap_fill"
      ? "Completa un hueco de baja demanda"
      : reasonCode === "last_minute"
        ? "Último minuto con baja ocupación"
        : "Baja ocupación en esta franja";
  return result(true, riskPoints, tier, reasonCode, reason);
}

function dynamicPricingForQuote({
  baseClp,
  durationMinutes,
  laneCount,
  settings,
  risk,
  promotionDiscountClp,
}) {
  if (!risk || !settings?.dynamicPricing) return null;
  const config = settings.dynamicPricing;
  const tier = risk.tier;
  const hours = durationMinutes / 60;
  const floorTotalClp = Number.isSafeInteger(config.floorClpPerLaneHour)
    ? Math.ceil(config.floorClpPerLaneHour * laneCount * hours)
    : null;
  const maxPercentDiscountClp = Math.floor(
    (baseClp * clampPercent(config.maxDiscountPercent, 0)) / 100,
  );
  const maxAbsoluteDiscountClp = Number.isSafeInteger(config.maxDiscountClpPerLaneHour)
    ? Math.floor(config.maxDiscountClpPerLaneHour * laneCount * hours)
    : Number.MAX_SAFE_INTEGER;
  const maxByFloorClp = floorTotalClp == null ? 0 : Math.max(0, baseClp - floorTotalClp);
  const budgetRemainingClp = Number.isFinite(risk.signals?.budgetRemainingClp)
    ? Math.max(0, Math.floor(risk.signals.budgetRemainingClp))
    : Number.MAX_SAFE_INTEGER;
  const requestedClp =
    risk.eligible && tier ? Math.floor((baseClp * clampPercent(tier.discountPercent, 0)) / 100) : 0;
  const potentialDiscountClp = Math.max(
    0,
    Math.min(
      requestedClp,
      maxPercentDiscountClp,
      maxAbsoluteDiscountClp,
      maxByFloorClp,
      budgetRemainingClp,
    ),
  );
  const applied =
    risk.show === true && potentialDiscountClp > 0 && potentialDiscountClp > promotionDiscountClp;
  return {
    ...risk,
    applied,
    shadow: config.mode === "shadow",
    discountPercent: tier?.discountPercent ?? 0,
    discountClp: applied ? potentialDiscountClp : 0,
    potentialDiscountClp,
    totalAfterDiscountClp: Math.max(0, baseClp - potentialDiscountClp),
    floorTotalClp,
    maxDiscountPercent: config.maxDiscountPercent,
    maxDiscountClpPerLaneHour: config.maxDiscountClpPerLaneHour ?? null,
    configVersion: Number(config.configVersion ?? 0),
  };
}

export function pricingConfigSnapshot(settings) {
  const config = settings?.dynamicPricing ?? {};
  return {
    mode: config.mode ?? "off",
    configVersion: Number(config.configVersion ?? 0),
    floorClpPerLaneHour: config.floorClpPerLaneHour ?? null,
    maxDiscountPercent: config.maxDiscountPercent ?? null,
    maxDiscountClpPerLaneHour: config.maxDiscountClpPerLaneHour ?? null,
    advanceWindowHours: config.advanceWindowHours ?? null,
    lowOccupancyThresholdPercent: config.lowOccupancyThresholdPercent ?? null,
    mediumOccupancyThresholdPercent: config.mediumOccupancyThresholdPercent ?? null,
    riskTiers: Array.isArray(config.riskTiers) ? config.riskTiers : [],
    protectedWeekdays: Array.isArray(config.protectedWeekdays) ? config.protectedWeekdays : [],
    protectedBands: Array.isArray(config.protectedBands) ? config.protectedBands : [],
    protectedDates: Array.isArray(config.protectedDates) ? config.protectedDates : [],
    dailyDiscountBudgetClp: config.dailyDiscountBudgetClp ?? null,
    quoteTtlMinutes: config.quoteTtlMinutes ?? null,
    channels: Array.isArray(config.channels) ? config.channels : [],
    pilot: config.pilot ?? { weekdays: [], bands: [] },
  };
}

export function calculateQuote({
  startMs,
  durationMinutes,
  laneCount,
  settings,
  channel = "web",
  risk = null,
}) {
  const generalRate = Number(settings.generalRateClpPerLaneHour ?? 0);
  if (!Number.isSafeInteger(generalRate) || generalRate < 0)
    throw new Error("Tarifa base inválida.");
  const endMs = startMs + durationMinutes * 60_000;
  const bands = Array.isArray(settings.rateBands) ? settings.rateBands : [];
  const exceptions = settings.rateExceptions ?? {};
  const segments = [];
  let cursor = startMs;
  while (cursor < endMs) {
    const localDate = formatLocalDate(cursor);
    const weekday = santiagoWeekday(cursor);
    const localTime = formatLocalTime(cursor);
    const eligible = bands.filter(
      (band) => Number(band.weekday) === weekday && localTime >= band.start && localTime < band.end,
    );
    const exception = exceptions[localDate];
    const rate =
      exception && Number.isSafeInteger(exception.rateClpPerLaneHour)
        ? exception.rateClpPerLaneHour
        : (eligible.sort((a, b) => b.start.localeCompare(a.start))[0]?.rateClpPerLaneHour ??
          generalRate);
    let next = endMs;
    next = Math.min(next, cursor + 60_000);
    const localMinute = Number(localTime.slice(3));
    if (localMinute !== 59) next = Math.min(next, cursor + (60 - localMinute) * 60_000);
    segments.push({ startMs: cursor, endMs: next, rateClpPerLaneHour: rate });
    cursor = next;
  }
  const numerator = segments.reduce(
    (sum, s) =>
      sum + BigInt(s.endMs - s.startMs) * BigInt(laneCount) * BigInt(s.rateClpPerLaneHour),
    0n,
  );
  const denominator = 3_600_000n;
  const rounded = (numerator + denominator / 2n) / denominator;
  if (rounded > BigInt(Number.MAX_SAFE_INTEGER))
    throw new Error("La cotización supera el rango monetario permitido.");
  const baseClp = Number(rounded);
  const promotions = (settings.promotions ?? []).filter((promotion) => {
    if (!promotion.enabled || endMs <= promotion.startsAt || startMs >= promotion.endsAt)
      return false;
    if (promotion.channel && promotion.channel !== channel) return false;
    if (promotion.minimumDurationMinutes && durationMinutes < promotion.minimumDurationMinutes)
      return false;
    return true;
  });
  let promotionDiscountClp = 0;
  let promotionName = null;
  for (const promotion of promotions) {
    const eligibleNumerator =
      promotion.maximumDurationMinutes && durationMinutes > promotion.maximumDurationMinutes
        ? 0n
        : segments.reduce((sum, segment) => {
            const from = Math.max(segment.startMs, promotion.startsAt);
            const to = Math.min(segment.endMs, promotion.endsAt);
            return to > from
              ? sum + BigInt(to - from) * BigInt(laneCount) * BigInt(segment.rateClpPerLaneHour)
              : sum;
          }, 0n);
    const eligibleBase = Number((eligibleNumerator + denominator / 2n) / denominator);
    const benefit =
      promotion.kind === "percent"
        ? Math.floor((eligibleBase * Math.max(0, Math.min(100, promotion.value))) / 100)
        : Math.min(eligibleBase, Math.max(0, Math.round(promotion.value)));
    if (benefit > promotionDiscountClp) {
      promotionDiscountClp = benefit;
      promotionName = promotion.name;
    }
  }
  const dynamic = dynamicPricingForQuote({
    baseClp,
    durationMinutes,
    laneCount,
    settings,
    risk,
    promotionDiscountClp,
  });
  const dynamicDiscountClp = dynamic?.applied === true ? dynamic.discountClp : 0;
  const promotionApplied = promotionDiscountClp >= dynamicDiscountClp;
  const discountClp = Math.max(promotionDiscountClp, dynamicDiscountClp);
  return {
    version: 2,
    baseClp,
    catalogPriceClp: baseClp,
    discountClp,
    totalClp: Math.max(0, baseClp - discountClp),
    promotionName: promotionApplied ? promotionName : null,
    promotionDiscountClp: promotionApplied ? promotionDiscountClp : 0,
    pricingSource:
      dynamicDiscountClp > 0
        ? "dynamic"
        : promotionApplied && promotionDiscountClp > 0
          ? "promotion"
          : "catalog",
    dynamic,
    segments,
  };
}

function overlaps(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && aEnd > bStart;
}

export function isLaneSetFree({ lanes, startMs, endMs, preparationMinutes, reservations, blocks }) {
  const occupiedEnd = endMs + preparationMinutes * 60_000;
  for (const lane of lanes) {
    if (
      blocks.some(
        (block) =>
          (block.laneId === lane || block.laneId === null) &&
          overlaps(startMs, occupiedEnd, block.startMs, block.endMs),
      )
    )
      return false;
    for (const reservation of reservations) {
      if (
        reservation.lanes.includes(lane) &&
        overlaps(
          startMs,
          occupiedEnd,
          reservation.startMs,
          reservation.endMs + reservation.preparationMinutes * 60_000,
        )
      )
        return false;
    }
  }
  return true;
}

function laneUseImpact({ laneSet, startMs, endMs, reservations, blocks, settings }) {
  const operatingWindow = operatingHoursForInterval(
    startMs,
    endMs,
    settings.weeklyHours,
    settings.exceptions,
  );
  if (!operatingWindow) return [0, 0, 0, 0];
  const closeMs = operatingWindow.closeMs;
  const future = [
    ...reservations,
    { lanes: laneSet, startMs, endMs, preparationMinutes: settings.preparationMinutes },
  ];
  const scenarios = [
    [3, 60],
    [2, 60],
    [1, 120],
    [1, 60],
  ];
  return scenarios.map(([laneCount, durationMinutes]) => {
    const groups = laneSetsFor(laneCount * 6, laneCount, false);
    let count = 0;
    const step = (durationMinutes + settings.preparationMinutes) * 60_000;
    let cursor = endMs + settings.preparationMinutes * 60_000;
    while (cursor + durationMinutes * 60_000 <= closeMs) {
      const slotEnd = cursor + durationMinutes * 60_000;
      const inOpenHours = matchesHours(
        cursor,
        slotEnd + (settings.closingMarginMinutes ?? 0) * 60_000,
        settings.weeklyHours,
        settings.exceptions,
      );
      const free =
        inOpenHours &&
        groups.some((group) =>
          isLaneSetFree({
            lanes: group,
            startMs: cursor,
            endMs: slotEnd,
            preparationMinutes: settings.preparationMinutes,
            reservations: future,
            blocks,
          }),
        );
      if (free) {
        count += 1;
        cursor += step;
      } else cursor += 10 * 60_000;
    }
    return count;
  });
}

function compareVector(a, b) {
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return b[i] - a[i];
  return 0;
}

export function findAlternatives({
  date,
  preferredTime,
  players,
  durationMinutes,
  lanes: contractedLanes,
  acceptSeparated = false,
  reservations,
  blocks,
  settings,
  limit = 8,
  channel = "web",
  now = Date.now(),
  budgetRemainingClp = Number.MAX_SAFE_INTEGER,
}) {
  const minLanes = minimumLanes(players);
  const laneCount = contractedLanes ?? minLanes;
  const sets = laneSetsFor(players, laneCount, acceptSeparated);
  if (!sets.length)
    throw new Error("No existe una agrupación física válida para esta cantidad de pistas.");
  if (!isWholeHourBookingDuration(durationMinutes))
    throw new Error("Las reservas iniciales deben solicitarse en horas completas.");
  const selectedDay = parseLocalDay(date);
  const previousDate = shiftLocalDate(date, -1);
  const windows = [date, previousDate]
    .map((candidateDate) =>
      operatingHoursForDate(candidateDate, settings.weeklyHours, settings.exceptions),
    )
    .filter(
      (window) => window && window.openMs < selectedDay.end && window.closeMs > selectedDay.start,
    );
  if (!windows.length) return [];
  const stepMinutes = Number(settings.startIntervalMinutes ?? 10);
  const stepMs = stepMinutes * 60_000;
  const startTime = localDateTimeToEpoch(`${date}T${preferredTime}`);
  const candidates = [];
  const seenStartTimes = new Set();
  for (const window of windows) {
    for (
      let startMs = Math.ceil(window.openMs / stepMs) * stepMs;
      startMs + durationMinutes * 60_000 <= window.closeMs;
      startMs += stepMs
    ) {
      if (startMs < selectedDay.start || startMs >= selectedDay.end || seenStartTimes.has(startMs))
        continue;
      seenStartTimes.add(startMs);
      const endMs = startMs + durationMinutes * 60_000;
      if (
        !matchesHours(
          startMs,
          endMs + (settings.closingMarginMinutes ?? 0) * 60_000,
          settings.weeklyHours,
          settings.exceptions,
        )
      )
        continue;
      const future = startMs - now < settings.minimumAdvanceMinutes * 60_000;
      if (future && !settings.allowImmediateWeb) continue;
      let chosen = null;
      for (const group of sets) {
        if (
          !isLaneSetFree({
            lanes: group,
            startMs,
            endMs,
            preparationMinutes: settings.preparationMinutes,
            reservations,
            blocks,
          })
        )
          continue;
        const impact = laneUseImpact({
          laneSet: group,
          startMs,
          endMs,
          reservations,
          blocks,
          settings,
        });
        if (
          !chosen ||
          compareVector(impact, chosen.impact) < 0 ||
          (compareVector(impact, chosen.impact) === 0 && group[0] < chosen.lanes[0])
        )
          chosen = { lanes: group, impact };
      }
      if (chosen) {
        const risk = evaluateOrphanRisk({
          startMs,
          endMs,
          lanes: chosen.lanes,
          reservations,
          blocks,
          settings,
          channel,
          now,
          budgetRemainingClp,
          impact: chosen.impact,
        });
        const quote = calculateQuote({
          startMs,
          durationMinutes,
          laneCount,
          settings,
          channel,
          risk,
        });
        candidates.push({
          startMs,
          endMs,
          lanes: chosen.lanes,
          laneCount,
          minimumLanes: minLanes,
          grouped: isPhysicallyGrouped(chosen.lanes),
          impact: chosen.impact,
          quote,
          priceOpportunity: quote.dynamic?.applied === true,
          distanceMinutes: Math.abs(startMs - startTime) / 60_000,
        });
      }
    }
  }
  // Rank demand preservation before distance, then price as a tie-breaker. Alternatives remain explicit choices.
  const nearest = [...candidates]
    .sort((a, b) => a.distanceMinutes - b.distanceMinutes || a.startMs - b.startMs)
    .slice(0, Math.ceil(limit / 2));
  const optimizer = [...candidates]
    .sort(
      (a, b) =>
        compareVector(a.impact, b.impact) ||
        b.quote.totalClp - a.quote.totalClp ||
        a.distanceMinutes - b.distanceMinutes,
    )
    .slice(0, Math.floor(limit / 2));
  const discounted = [...candidates]
    .filter((candidate) => candidate.priceOpportunity)
    .sort(
      (a, b) =>
        a.quote.totalClp - b.quote.totalClp ||
        a.distanceMinutes - b.distanceMinutes ||
        a.startMs - b.startMs,
    )
    .slice(0, Math.max(1, Math.ceil(limit / 3)));
  let selected = [
    ...new Map(
      [...nearest, ...optimizer, ...discounted].map((candidate) => [candidate.startMs, candidate]),
    ).values(),
  ]
    .sort(
      (a, b) =>
        a.distanceMinutes - b.distanceMinutes ||
        compareVector(a.impact, b.impact) ||
        b.quote.totalClp - a.quote.totalClp ||
        a.startMs - b.startMs,
    )
    .slice(0, limit);
  if (discounted.length && !selected.some((candidate) => candidate.priceOpportunity)) {
    const replacement = discounted.find(
      (candidate) => !selected.some((chosen) => chosen.startMs === candidate.startMs),
    );
    if (replacement)
      selected = [...selected.slice(0, Math.max(0, limit - 1)), replacement].sort(
        (a, b) => a.distanceMinutes - b.distanceMinutes || a.startMs - b.startMs,
      );
  }
  return selected.map(({ impact, ...candidate }, index) => ({
    ...candidate,
    rank: index + 1,
    preservationScore: impact,
  }));
}

export function selectLaneSetAtTime({
  startMs,
  players,
  durationMinutes,
  lanes: contractedLanes,
  acceptSeparated = false,
  reservations,
  blocks,
  settings,
  channel = "web",
  preferredLaneId,
  now = Date.now(),
  budgetRemainingClp = Number.MAX_SAFE_INTEGER,
}) {
  const laneCount = contractedLanes ?? minimumLanes(players);
  const sets = laneSetsFor(players, laneCount, acceptSeparated).filter(
    (lanes) => preferredLaneId == null || lanes.includes(Number(preferredLaneId)),
  );
  const endMs = startMs + durationMinutes * 60_000;
  if (
    !sets.length ||
    !matchesHours(
      startMs,
      endMs + (settings.closingMarginMinutes ?? 0) * 60_000,
      settings.weeklyHours,
      settings.exceptions,
    )
  )
    return null;
  let chosen = null;
  for (const lanes of sets) {
    if (
      !isLaneSetFree({
        lanes,
        startMs,
        endMs,
        preparationMinutes: settings.preparationMinutes,
        reservations,
        blocks,
      })
    )
      continue;
    const impact = laneUseImpact({
      laneSet: lanes,
      startMs,
      endMs,
      reservations,
      blocks,
      settings,
    });
    const risk = evaluateOrphanRisk({
      startMs,
      endMs,
      lanes,
      reservations,
      blocks,
      settings,
      channel,
      now,
      budgetRemainingClp,
      impact,
    });
    const quote = calculateQuote({
      startMs,
      durationMinutes,
      laneCount,
      settings,
      channel,
      risk,
    });
    if (
      !chosen ||
      compareVector(impact, chosen.preservationScore) < 0 ||
      (compareVector(impact, chosen.preservationScore) === 0 &&
        quote.totalClp > chosen.quote.totalClp) ||
      (compareVector(impact, chosen.preservationScore) === 0 &&
        quote.totalClp === chosen.quote.totalClp &&
        lanes[0] < chosen.lanes[0])
    ) {
      chosen = {
        startMs,
        endMs,
        lanes,
        laneCount,
        minimumLanes: minimumLanes(players),
        grouped: isPhysicallyGrouped(lanes),
        quote,
        preservationScore: impact,
        priceOpportunity: quote.dynamic?.applied === true,
      };
    }
  }
  return chosen;
}

export function chooseFirstAvailable(options) {
  return [...options].sort((a, b) => a.startMs - b.startMs)[0] ?? null;
}
export function chooseClosest(options, preferredStartMs) {
  return (
    [...options].sort(
      (a, b) =>
        Math.abs(a.startMs - preferredStartMs) - Math.abs(b.startMs - preferredStartMs) ||
        a.startMs - b.startMs,
    )[0] ?? null
  );
}
export function chooseCompact(options) {
  return (
    [...options].sort(
      (a, b) => (a.startMs % 3_600_000) - (b.startMs % 3_600_000) || a.startMs - b.startMs,
    )[0] ?? null
  );
}
