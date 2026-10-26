import { availableLaneIntervals } from "./domain.mjs";

const cancelledStatuses = new Set(["cancelled", "rejected"]);

function clp(value) {
  const amount = Number(value);
  return Number.isSafeInteger(amount) ? Math.max(0, amount) : 0;
}

function quoteFromJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

function emptyTotals() {
  return {
    reservationCount: 0,
    confirmedCount: 0,
    pendingCount: 0,
    cancelledCount: 0,
    dynamicAppliedCount: 0,
    dynamicDiscountCommittedClp: 0,
    dynamicQuoteTotalClp: 0,
    dynamicPotentialNotAppliedCount: 0,
    dynamicPotentialNotAppliedClp: 0,
  };
}

function emptyChannel(channel) {
  return { channel, ...emptyTotals() };
}

function mergedIntervals(intervals) {
  const sorted = intervals
    .filter(
      (interval) => Number.isSafeInteger(interval.startMs) && interval.endMs > interval.startMs,
    )
    .sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
  const merged = [];
  for (const interval of sorted) {
    const previous = merged.at(-1);
    if (previous && interval.startMs <= previous.endMs)
      previous.endMs = Math.max(previous.endMs, interval.endMs);
    else merged.push({ startMs: interval.startMs, endMs: interval.endMs });
  }
  return merged;
}

function overlapMs(startMs, endMs, fromMs, toMs) {
  return Math.max(0, Math.min(endMs, toMs) - Math.max(startMs, fromMs));
}

function emptyInventoryPerformance(minimumSellableMinutes) {
  return {
    reservationCount: 0,
    availableLaneHours: 0,
    committedLaneHours: 0,
    occupancyPercent: null,
    unbookableGapLaneHours: 0,
    unbookableGapPercent: null,
    minimumSellableMinutes,
    configurationEstimated: true,
    assignmentEstimated: true,
  };
}

function parsedJson(value, fallback) {
  if (value && typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

export function buildHistoricalCapacityIntervals({
  fromMs,
  toMs,
  reportFromMs = fromMs,
  reportToMs = toMs,
  history = [],
  maintenanceBlocks = [],
}) {
  if (!Number.isSafeInteger(fromMs) || !Number.isSafeInteger(toMs) || toMs <= fromMs)
    return { intervals: [], configurationEstimated: true };

  const snapshots = history
    .map((snapshot) => ({ ...snapshot, effectiveAt: Number(snapshot.effectiveAt) }))
    .filter((snapshot) => Number.isSafeInteger(snapshot.effectiveAt) && snapshot.effectiveAt < toMs)
    .sort((a, b) => a.effectiveAt - b.effectiveAt);
  if (snapshots.length === 0) return { intervals: [], configurationEstimated: true };

  let firstSnapshot = 0;
  for (let index = 0; index < snapshots.length; index += 1) {
    if (snapshots[index].effectiveAt <= fromMs) firstSnapshot = index;
    else break;
  }

  const intervals = [];
  let configurationEstimated = false;
  for (let index = firstSnapshot; index < snapshots.length; index += 1) {
    const snapshot = snapshots[index];
    const nextSnapshot = snapshots[index + 1];
    const sliceStartMs = Math.max(fromMs, snapshot.effectiveAt);
    const sliceEndMs = Math.min(toMs, nextSnapshot?.effectiveAt ?? toMs);
    if (sliceEndMs <= sliceStartMs) continue;

    const weeklyHours = parsedJson(snapshot.weeklyHoursJson ?? snapshot.weekly_hours_json, {});
    const exceptions = parsedJson(snapshot.exceptionsJson ?? snapshot.exceptions_json, {});
    const activeLaneIds = parsedJson(
      snapshot.activeLaneIdsJson ?? snapshot.active_lane_ids_json,
      [],
    );
    const preparationMinutes = Number(snapshot.preparationMinutes ?? snapshot.preparation_minutes);
    const safePreparationMinutes =
      Number.isSafeInteger(preparationMinutes) && preparationMinutes >= 0 ? preparationMinutes : 0;
    if (
      (snapshot.isBaseline === true || Number(snapshot.isBaseline ?? snapshot.is_baseline) === 1) &&
      overlapMs(sliceStartMs, sliceEndMs, reportFromMs, reportToMs) > 0
    )
      configurationEstimated = true;

    for (const interval of availableLaneIntervals({
      fromMs: sliceStartMs,
      toMs: sliceEndMs,
      weeklyHours,
      exceptions,
      activeLaneIds,
      maintenanceBlocks,
    }))
      intervals.push({
        ...interval,
        preparationMinutes: safePreparationMinutes,
        minimumSellableMinutes: 60 + safePreparationMinutes,
      });
  }

  intervals.sort((a, b) => a.laneId - b.laneId || a.startMs - b.startMs || a.endMs - b.endMs);
  const merged = [];
  for (const interval of intervals) {
    const previous = merged.at(-1);
    if (previous?.laneId === interval.laneId && interval.startMs === previous.endMs) {
      previous.endMs = interval.endMs;
      previous.segments.push({
        startMs: interval.startMs,
        endMs: interval.endMs,
        preparationMinutes: interval.preparationMinutes,
        minimumSellableMinutes: interval.minimumSellableMinutes,
      });
    } else {
      merged.push({
        ...interval,
        segments: [
          {
            startMs: interval.startMs,
            endMs: interval.endMs,
            preparationMinutes: interval.preparationMinutes,
            minimumSellableMinutes: interval.minimumSellableMinutes,
          },
        ],
      });
    }
  }
  return { intervals: merged, configurationEstimated };
}

export function summarizePricingPerformance(rows) {
  const totals = emptyTotals();
  const channels = new Map();

  for (const row of rows) {
    const channel = String(row.channel ?? "unknown");
    const status = String(row.commercialStatus ?? "unknown");
    const quote = quoteFromJson(row.quoteJson);
    const dynamic = quote.dynamic ?? {};
    const isCancelled = cancelledStatuses.has(status);
    const bucket = channels.get(channel) ?? emptyChannel(channel);
    const count = (target, key) => {
      target[key] += 1;
      totals[key] += 1;
    };

    count(bucket, "reservationCount");
    if (status === "confirmed") count(bucket, "confirmedCount");
    else if (status.startsWith("pending")) count(bucket, "pendingCount");
    else if (isCancelled) count(bucket, "cancelledCount");

    if (!isCancelled) {
      if (dynamic.applied === true && clp(dynamic.discountClp) > 0) {
        const discount = clp(dynamic.discountClp);
        count(bucket, "dynamicAppliedCount");
        bucket.dynamicDiscountCommittedClp += discount;
        totals.dynamicDiscountCommittedClp += discount;
        bucket.dynamicQuoteTotalClp += clp(row.quoteClp);
        totals.dynamicQuoteTotalClp += clp(row.quoteClp);
      } else if (clp(dynamic.potentialDiscountClp) > 0) {
        const potential = clp(dynamic.potentialDiscountClp);
        count(bucket, "dynamicPotentialNotAppliedCount");
        bucket.dynamicPotentialNotAppliedClp += potential;
        totals.dynamicPotentialNotAppliedClp += potential;
      }
    }

    channels.set(channel, bucket);
  }

  return {
    totals,
    byChannel: [...channels.values()].sort((a, b) => a.channel.localeCompare(b.channel)),
  };
}

export function summarizeOperationalPerformance({
  verifiedRevenueClp,
  availableLaneHours,
  activeLaneCount,
  inventory,
}) {
  const revenue = Number(verifiedRevenueClp);
  const hours = Number(availableLaneHours);
  const lanes = Number(activeLaneCount);
  const safeRevenue = Number.isSafeInteger(revenue) ? revenue : 0;
  const safeHours = Number.isFinite(hours) ? Math.max(0, hours) : 0;
  const safeLaneCount = Number.isSafeInteger(lanes) ? Math.max(0, lanes) : 0;

  const summary = {
    verifiedRevenueClp: safeRevenue,
    availableLaneHours: Number(safeHours.toFixed(2)),
    activeLaneCount: safeLaneCount,
    revenuePerAvailableLaneHourClp: safeHours > 0 ? Math.round(safeRevenue / safeHours) : null,
  };
  if (inventory) summary.inventory = inventory;
  return summary;
}

export function summarizeInventoryPerformance({
  fromMs,
  toMs,
  availableIntervals = [],
  reservations = [],
  minimumSellableMinutes = 70,
  configurationEstimated = false,
  assignmentHistoryEstimated = false,
}) {
  const minMinutes = Number.isSafeInteger(minimumSellableMinutes)
    ? Math.max(1, minimumSellableMinutes)
    : 70;
  const empty = emptyInventoryPerformance(minMinutes);
  if (!Number.isSafeInteger(fromMs) || !Number.isSafeInteger(toMs) || toMs <= fromMs) return empty;

  const reservationsByLane = new Map();
  for (const reservation of reservations) {
    const laneId = Number(reservation.laneId);
    if (!Number.isSafeInteger(laneId) || laneId < 1) continue;
    const laneReservations = reservationsByLane.get(laneId) ?? [];
    laneReservations.push(reservation);
    reservationsByLane.set(laneId, laneReservations);
  }

  let availableMs = 0;
  let committedMs = 0;
  let unbookableGapMs = 0;
  let assignmentEstimated = Boolean(assignmentHistoryEstimated);
  const countedReservations = new Set();
  const observedThresholds = new Set();

  for (const capacity of availableIntervals) {
    const laneId = Number(capacity.laneId);
    const capacityStartMs = Number(capacity.startMs);
    const capacityEndMs = Number(capacity.endMs);
    if (
      !Number.isSafeInteger(laneId) ||
      laneId < 1 ||
      !Number.isSafeInteger(capacityStartMs) ||
      !Number.isSafeInteger(capacityEndMs) ||
      capacityEndMs <= capacityStartMs
    )
      continue;

    availableMs += overlapMs(capacityStartMs, capacityEndMs, fromMs, toMs);
    const segments =
      Array.isArray(capacity.segments) && capacity.segments.length
        ? capacity.segments
        : [
            {
              startMs: capacityStartMs,
              endMs: capacityEndMs,
              minimumSellableMinutes: capacity.minimumSellableMinutes ?? minMinutes,
            },
          ];
    for (const segment of segments) {
      if (overlapMs(segment.startMs, segment.endMs, fromMs, toMs) <= 0) continue;
      const threshold = Number(segment.minimumSellableMinutes);
      observedThresholds.add(
        Number.isSafeInteger(threshold) && threshold > 0 ? threshold : minMinutes,
      );
    }
    const laneReservations = reservationsByLane.get(laneId) ?? [];
    const soldIntervals = [];
    const occupiedIntervals = [];
    for (const reservation of laneReservations) {
      const reservationStartMs = Number(reservation.reservationStartMs);
      const reservationEndMs = Number(reservation.reservationEndMs);
      const allocationStartMs = Number(reservation.allocationStartMs ?? reservationStartMs);
      const allocationEndMs = Number(reservation.allocationEndMs ?? reservationEndMs);
      const effectiveEndMs = Number(reservation.effectiveEndMs ?? reservationEndMs);
      const assignmentFromMs = Number(reservation.assignmentFromMs ?? reservationStartMs);
      const assignmentToMs = Number(reservation.assignmentToMs ?? Number.MAX_SAFE_INTEGER);
      if (
        !Number.isSafeInteger(reservationStartMs) ||
        !Number.isSafeInteger(reservationEndMs) ||
        !Number.isSafeInteger(allocationStartMs) ||
        !Number.isSafeInteger(allocationEndMs) ||
        !Number.isSafeInteger(effectiveEndMs) ||
        !Number.isSafeInteger(assignmentFromMs) ||
        !Number.isSafeInteger(assignmentToMs)
      )
        continue;
      if (
        Number(reservation.assignmentBaseline ?? reservation.assignment_baseline) === 1 &&
        Number(reservation.assignmentRecordedAt ?? reservation.assignment_recorded_at) >
          reservationStartMs &&
        overlapMs(
          Math.max(reservationStartMs, assignmentFromMs),
          Math.min(reservationEndMs, assignmentToMs),
          fromMs,
          toMs,
        ) > 0
      )
        assignmentEstimated = true;

      const soldStartMs = Math.max(
        capacityStartMs,
        reservationStartMs,
        allocationStartMs,
        assignmentFromMs,
      );
      const soldEndMs = Math.min(capacityEndMs, reservationEndMs, assignmentToMs);
      if (overlapMs(soldStartMs, soldEndMs, fromMs, toMs) > 0) {
        soldIntervals.push({ startMs: soldStartMs, endMs: soldEndMs });
        if (reservation.reservationId != null)
          countedReservations.add(String(reservation.reservationId));
      }

      for (const segment of segments) {
        const preparationMinutes = Number(
          segment.preparationMinutes ?? capacity.preparationMinutes,
        );
        const occupiedStartMs = Math.max(
          capacityStartMs,
          reservationStartMs,
          allocationStartMs,
          assignmentFromMs,
          Number(segment.startMs),
        );
        const occupiedEndMs = Math.min(
          capacityEndMs,
          Number(segment.endMs),
          allocationEndMs,
          assignmentToMs,
          Number.isSafeInteger(preparationMinutes)
            ? effectiveEndMs + preparationMinutes * 60_000
            : allocationEndMs,
        );
        if (occupiedEndMs > occupiedStartMs)
          occupiedIntervals.push({ startMs: occupiedStartMs, endMs: occupiedEndMs });
      }
    }

    for (const interval of mergedIntervals(soldIntervals))
      committedMs += overlapMs(interval.startMs, interval.endMs, fromMs, toMs);

    let cursor = capacityStartMs;
    for (const occupied of mergedIntervals(occupiedIntervals)) {
      const gapIsUnbookable = (gapStartMs, gapEndMs) =>
        !segments.some((segment) => {
          const threshold = Number(segment.minimumSellableMinutes ?? minMinutes) * 60_000;
          const candidateStartMs = Math.max(gapStartMs, Number(segment.startMs));
          const candidateEndMs = Math.min(gapEndMs, Number(segment.endMs));
          return candidateEndMs - candidateStartMs >= threshold;
        });
      if (occupied.startMs > cursor && gapIsUnbookable(cursor, occupied.startMs))
        unbookableGapMs += overlapMs(cursor, occupied.startMs, fromMs, toMs);
      cursor = Math.max(cursor, occupied.endMs);
    }
    if (
      capacityEndMs > cursor &&
      !segments.some((segment) => {
        const threshold = Number(segment.minimumSellableMinutes ?? minMinutes) * 60_000;
        const candidateStartMs = Math.max(cursor, Number(segment.startMs));
        const candidateEndMs = Math.min(capacityEndMs, Number(segment.endMs));
        return candidateEndMs - candidateStartMs >= threshold;
      })
    )
      unbookableGapMs += overlapMs(cursor, capacityEndMs, fromMs, toMs);
  }

  const thresholdValues = [...observedThresholds].sort((a, b) => a - b);

  return {
    reservationCount: countedReservations.size,
    availableLaneHours: Number((availableMs / 3_600_000).toFixed(2)),
    committedLaneHours: Number((committedMs / 3_600_000).toFixed(2)),
    occupancyPercent:
      availableMs > 0 ? Number(((committedMs / availableMs) * 100).toFixed(1)) : null,
    unbookableGapLaneHours: Number((unbookableGapMs / 3_600_000).toFixed(2)),
    unbookableGapPercent:
      availableMs > 0 ? Number(((unbookableGapMs / availableMs) * 100).toFixed(1)) : null,
    minimumSellableMinutes: thresholdValues.length === 1 ? thresholdValues[0] : null,
    configurationEstimated: Boolean(configurationEstimated),
    assignmentEstimated,
  };
}
