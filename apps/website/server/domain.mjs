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

export function matchesHours(startMs, endMs, weeklyHours, exceptions = {}) {
  const date = formatLocalDate(startMs);
  const rule = exceptions[date] ?? weeklyHours[String(santiagoWeekday(startMs))];
  if (!rule || rule.closed || !rule.open || !rule.close) return false;
  const open = localDateTimeToEpoch(`${date}T${rule.open}`);
  let close = localDateTimeToEpoch(`${date}T${rule.close}`);
  if (close <= open) {
    const [y, m, d] = date.split("-").map(Number);
    const next = new Date(Date.UTC(y, m - 1, d + 1));
    const nextDate = `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-${String(next.getUTCDate()).padStart(2, "0")}`;
    close = localDateTimeToEpoch(`${nextDate}T${rule.close}`);
  }
  return startMs >= open && endMs <= close;
}

export function calculateQuote({ startMs, durationMinutes, laneCount, settings, channel = "web" }) {
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
  let discountClp = 0;
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
    if (benefit > discountClp) {
      discountClp = benefit;
      promotionName = promotion.name;
    }
  }
  return {
    baseClp,
    discountClp,
    totalClp: Math.max(0, baseClp - discountClp),
    promotionName,
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

function laneUseImpact({ laneSet, startMs, endMs, date, reservations, blocks, settings }) {
  const endOfDayRule =
    settings.exceptions?.[date] ?? settings.weeklyHours[String(santiagoWeekday(startMs))];
  if (!endOfDayRule || endOfDayRule.closed || !endOfDayRule.close) return [0, 0, 0, 0];
  let closeMs = localDateTimeToEpoch(`${date}T${endOfDayRule.close}`);
  if (closeMs <= startMs) {
    const [y, m, d] = date.split("-").map(Number);
    const next = new Date(Date.UTC(y, m - 1, d + 1));
    closeMs = localDateTimeToEpoch(
      `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-${String(next.getUTCDate()).padStart(2, "0")}T${endOfDayRule.close}`,
    );
  }
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
}) {
  const minLanes = minimumLanes(players);
  const laneCount = contractedLanes ?? minLanes;
  const sets = laneSetsFor(players, laneCount, acceptSeparated);
  if (!sets.length)
    throw new Error("No existe una agrupación física válida para esta cantidad de pistas.");
  if (!Number.isInteger(durationMinutes) || durationMinutes < 60 || durationMinutes % 60 !== 0)
    throw new Error("La duración inicial debe ser de una o más horas completas.");
  const rule =
    settings.exceptions?.[date] ??
    settings.weeklyHours[String(new Date(`${date}T12:00:00Z`).getUTCDay())];
  if (!rule || rule.closed || !rule.open || !rule.close) return [];
  const openMs = localDateTimeToEpoch(`${date}T${rule.open}`);
  let closeMs = localDateTimeToEpoch(`${date}T${rule.close}`);
  if (closeMs <= openMs) {
    const [y, m, d] = date.split("-").map(Number);
    const next = new Date(Date.UTC(y, m - 1, d + 1));
    closeMs = localDateTimeToEpoch(
      `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-${String(next.getUTCDate()).padStart(2, "0")}T${rule.close}`,
    );
  }
  const stepMinutes = Number(settings.startIntervalMinutes ?? 10);
  const startTime = localDateTimeToEpoch(`${date}T${preferredTime}`);
  const candidates = [];
  for (
    let startMs = openMs;
    startMs + durationMinutes * 60_000 <= closeMs;
    startMs += stepMinutes * 60_000
  ) {
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
    const future = startMs - Date.now() < settings.minimumAdvanceMinutes * 60_000;
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
        date,
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
      const quote = calculateQuote({ startMs, durationMinutes, laneCount, settings, channel });
      candidates.push({
        startMs,
        endMs,
        lanes: chosen.lanes,
        laneCount,
        minimumLanes: minLanes,
        grouped: isPhysicallyGrouped(chosen.lanes),
        impact: chosen.impact,
        quote,
        distanceMinutes: Math.abs(startMs - startTime) / 60_000,
      });
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
  const selected = [
    ...new Map(
      [...nearest, ...optimizer].map((candidate) => [candidate.startMs, candidate]),
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
}) {
  const laneCount = contractedLanes ?? minimumLanes(players);
  const sets = laneSetsFor(players, laneCount, acceptSeparated);
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
      date: formatLocalDate(startMs),
      reservations,
      blocks,
      settings,
    });
    const quote = calculateQuote({ startMs, durationMinutes, laneCount, settings, channel });
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
