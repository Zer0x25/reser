const pricingGroups = new Set(["dynamic_applied", "dynamic_potential", "standard"]);
const excludedCommercialStatuses = new Set(["cancelled", "rejected"]);

function emptyMetrics(pricingGroup = null) {
  return {
    ...(pricingGroup ? { pricingGroup } : {}),
    offeredCount: 0,
    selectedCount: 0,
    reservedCount: 0,
    confirmedCount: 0,
    paidCount: 0,
    verifiedRevenueClp: 0,
    contractedLaneHours: 0,
    revenuePerLaneHourClp: null,
  };
}

function clp(value) {
  const amount = Number(value);
  return Number.isSafeInteger(amount) ? Math.max(0, amount) : 0;
}

function contractedLaneHours(row) {
  const laneCount = Number(row.laneCount);
  const startMs = Number(row.startMs);
  const endMs = Number(row.endMs);
  if (
    !Number.isSafeInteger(laneCount) ||
    laneCount < 1 ||
    !Number.isSafeInteger(startMs) ||
    !Number.isSafeInteger(endMs) ||
    endMs <= startMs
  )
    return 0;
  return (laneCount * (endMs - startMs)) / 3_600_000;
}

function finalize(metrics) {
  metrics.contractedLaneHours = Number(metrics.contractedLaneHours.toFixed(2));
  metrics.revenuePerLaneHourClp =
    metrics.contractedLaneHours > 0
      ? Math.round(metrics.verifiedRevenueClp / metrics.contractedLaneHours)
      : null;
  return metrics;
}

export function summarizePricingFunnel(rows) {
  const totals = emptyMetrics();
  const groups = new Map();

  for (const row of rows) {
    const pricingGroup = pricingGroups.has(row.pricingGroup) ? row.pricingGroup : "standard";
    const group = groups.get(pricingGroup) ?? emptyMetrics(pricingGroup);
    const selected = row.selectedAt != null || row.reservedAt != null;
    const reserved = row.reservedAt != null;
    const confirmed = row.confirmedAt != null;
    const commercialStatus = String(row.commercialStatus ?? "unknown");
    const eligibleReservation =
      confirmed && row.reservationId != null && !excludedCommercialStatuses.has(commercialStatus);

    totals.offeredCount += 1;
    group.offeredCount += 1;
    if (selected) {
      totals.selectedCount += 1;
      group.selectedCount += 1;
    }
    if (reserved) {
      totals.reservedCount += 1;
      group.reservedCount += 1;
    }
    if (confirmed) {
      totals.confirmedCount += 1;
      group.confirmedCount += 1;
    }
    if (eligibleReservation) {
      if (row.financialStatus === "paid") {
        totals.paidCount += 1;
        group.paidCount += 1;
      }
      const revenue = clp(row.verifiedRevenueClp);
      const laneHours = contractedLaneHours(row);
      totals.verifiedRevenueClp += revenue;
      group.verifiedRevenueClp += revenue;
      totals.contractedLaneHours += laneHours;
      group.contractedLaneHours += laneHours;
    }
    groups.set(pricingGroup, group);
  }

  return {
    totals: finalize(totals),
    byPricingGroup: [...groups.values()]
      .map(finalize)
      .sort((a, b) => a.pricingGroup.localeCompare(b.pricingGroup)),
  };
}
